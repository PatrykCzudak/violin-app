from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Body
from pydantic import BaseModel
import asyncio
import threading
import numpy as np
import aubio
import sounddevice as sd
import math
from typing import List, Optional, Dict

router = APIRouter()

# =============================
# Modele odpowiedzi
# =============================
class AudioDevice(BaseModel):
    id: int
    name: str
    default_samplerate: float | None = None
    max_input_channels: int | None = None

class NoiseConfig(BaseModel):
    enabled: bool = True
    gate_db: float = -50.0
    hp_enabled: bool = True
    hp_cut_hz: float = 70.0
    margin_db: float = 6.0
    adaptive: bool = True
    noise_floor_db: float = -60.0

class AudioStatus(BaseModel):
    running: bool
    device_id: Optional[int] = None
    device_name: Optional[str] = None
    samplerate: Optional[int] = None
    hop: Optional[int] = None

# =============================
# Stan globalny audio/WS
# =============================
_audio_stream: Optional[sd.RawInputStream] = None
_audio_thread: Optional[threading.Thread] = None
_run_audio: bool = False

_current_device: Optional[int] = None
_current_sr: Optional[int] = None
_current_hop: Optional[int] = None

_ws_connections: List[WebSocket] = []
_ws_lock = threading.Lock()
_main_loop: Optional[asyncio.AbstractEventLoop] = None  # ustawiany przy pierwszym WS

# Parametry analizy (inicjalne – zostaną ustawione przy starcie)
BUFFER_SIZE = 2048
HOP_SIZE = 1024
SAMPLERATE = 44100

_pitch_o: Optional[aubio.pitch] = None
_onset_o: Optional[aubio.onset] = None
_tempo_o: Optional[aubio.tempo] = None

def _init_aubio(samplerate: int, hop: int):
    global _pitch_o, _onset_o, _tempo_o
    _pitch_o = aubio.pitch("yin", 2048, hop, samplerate)
    _pitch_o.set_unit("Hz")
    _pitch_o.set_silence(-40)
    _onset_o = aubio.onset("default", 1024, hop, samplerate)
    _tempo_o = aubio.tempo("default", 1024, hop, samplerate)

# =============================
# Noise Reduction – stan + IIR HPF + bramka + kalibracja
# =============================
_noise_cfg = NoiseConfig()
_cfg_lock = threading.Lock()

# HPF state
_hpf_x1: float = 0.0
_hpf_y1: float = 0.0
_hpf_alpha: float = 0.0

def _update_hpf_alpha(samplerate: int):
    global _hpf_alpha
    with _cfg_lock:
        if not _noise_cfg.hp_enabled:
            _hpf_alpha = 0.0
            return
        fc = max(1.0, float(_noise_cfg.hp_cut_hz))
    rc = 1.0 / (2.0 * math.pi * fc)
    dt = 1.0 / float(samplerate)
    _hpf_alpha = rc / (rc + dt)

def _hpf_process(frame: np.ndarray) -> np.ndarray:
    global _hpf_x1, _hpf_y1, _hpf_alpha
    if _hpf_alpha == 0.0:
        return frame
    out = np.empty_like(frame)
    x1 = _hpf_x1
    y1 = _hpf_y1
    a = _hpf_alpha
    for i in range(frame.size):
        x = float(frame[i])
        y = a * (y1 + x - x1)
        out[i] = y
        x1 = x
        y1 = y
    _hpf_x1, _hpf_y1 = x1, y1
    return out

_calib_frames_left: int = 0
_calib_db_values: List[float] = []

def _start_calibration(seconds: float):
    global _calib_frames_left, _calib_db_values
    frames = int((seconds * SAMPLERATE) / HOP_SIZE) if HOP_SIZE > 0 else 0
    _calib_frames_left = max(1, frames)
    _calib_db_values = []

def _apply_noise_processing(samples: np.ndarray) -> Dict[str, float]:
    eps = 1e-12
    rms_pre = float(np.sqrt(np.mean(samples**2) + eps))
    db_pre = 20.0 * math.log10(rms_pre + eps)

    with _cfg_lock:
        cfg = _noise_cfg

    proc = samples
    if cfg.enabled and cfg.hp_enabled:
        proc = _hpf_process(proc)

    rms = float(np.sqrt(np.mean(proc**2) + eps))
    db = 20.0 * math.log10(rms + eps)

    global _calib_frames_left, _calib_db_values
    if _calib_frames_left > 0:
        _calib_db_values.append(db)
        _calib_frames_left -= 1
        if _calib_frames_left == 0 and len(_calib_db_values) > 0:
            floor = float(np.median(_calib_db_values))
            with _cfg_lock:
                _noise_cfg.noise_floor_db = floor
                if _noise_cfg.adaptive:
                    _noise_cfg.gate_db = floor + _noise_cfg.margin_db

    gated = False
    with _cfg_lock:
        gate_db = cfg.gate_db if not cfg.adaptive else (cfg.noise_floor_db + cfg.margin_db)
        use_gate = cfg.enabled

    if use_gate and db < gate_db:
        gated = True

    return {
        "rms": rms,
        "db": db,
        "db_pre": db_pre,
        "level": max(0.0, min(1.0, (db + 60.0) / 60.0)),
        "gated": 1.0 if gated else 0.0,
        "gate_db": gate_db
    }

# =============================
# Pomocnicze
# =============================
def _hz_to_note_and_cents(freq: float, a4: float = 440.0):
    if freq <= 0:
        return None, None
    midi = 69 + 12 * math.log2(freq / a4)
    midi_round = int(round(midi))
    cents = int(round((midi - midi_round) * 100.0))
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    name = f"{names[midi_round % 12]}{(midi_round // 12) - 1}"
    return name, cents

def _preview_wave(samples: np.ndarray, points: int = 128) -> List[float]:
    if samples.size == 0:
        return []
    step = max(1, samples.size // points)
    return samples[::step][:points].astype(float).tolist()

def _ws_broadcast_json(payload: dict):
    global _main_loop
    _ws_lock.acquire()
    conns = list(_ws_connections)
    _ws_lock.release()
    if not conns or _main_loop is None:
        return
    for ws in conns:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_json(payload), _main_loop)
        except Exception:
            _ws_lock.acquire()
            if ws in _ws_connections:
                _ws_connections.remove(ws)
            _ws_lock.release()

# =============================
# Główny wątek przechwytywania audio
# =============================
def _audio_capture_thread(device: Optional[int], samplerate: int, hop: int):
    global _audio_stream, _run_audio, _current_device, _current_sr, _current_hop
    try:
        _init_aubio(samplerate, hop)
        _update_hpf_alpha(samplerate)
        _audio_stream = sd.RawInputStream(
            device=device,
            samplerate=samplerate,
            channels=1,
            dtype="float32",
            blocksize=hop
        )
        _audio_stream.start()
        _current_device, _current_sr, _current_hop = device, samplerate, hop
    except Exception as e:
        print(f"[audio] Błąd otwarcia strumienia: {e}")
        _run_audio = False
        _current_device = None
        return

    preview_tick = 0
    while _run_audio:
        try:
            data, _ = _audio_stream.read(hop)
            samples = np.frombuffer(data, dtype=np.float32)
        except Exception as e:
            print(f"[audio] Błąd czytania: {e}")
            break

        nr = _apply_noise_processing(samples)

        pitch_hz = 0.0
        onset_flag = False
        bpm = 0.0

        if nr["gated"] < 0.5:
            pitch_hz = float(_pitch_o(samples)[0]) if _pitch_o else 0.0
            _ = _tempo_o(samples) if _tempo_o else False
            bpm = float(_tempo_o.get_bpm()) if _tempo_o else 0.0
            onset_flag = bool(_onset_o(samples)) if _onset_o else False

        note, cents = _hz_to_note_and_cents(pitch_hz)

        payload = {
            "pitch_hz": pitch_hz,
            "note": note,
            "cents": cents,
            "onset": onset_flag,
            "bpm": bpm,
            "rms": nr["rms"],
            "db": nr["db"],
            "level": nr["level"],
            "gated": bool(nr["gated"]),
            "gate_db": nr["gate_db"]
        }
        preview_tick = (preview_tick + 1) % 4
        if preview_tick == 0:
            payload["wave"] = _preview_wave(samples, 128)

        _ws_broadcast_json(payload)

    try:
        if _audio_stream:
            _audio_stream.stop()
            _audio_stream.close()
    except:
        pass
    _audio_stream = None

# =============================
# REST: urządzenia / start / stop / status
# =============================
@router.get("/devices", response_model=list[AudioDevice])
def list_audio_devices():
    devices = []
    for idx, dev in enumerate(sd.query_devices()):
        if dev.get("max_input_channels", 0) > 0:
            devices.append(AudioDevice(
                id=idx,
                name=dev["name"],
                default_samplerate=dev.get("default_samplerate"),
                max_input_channels=dev.get("max_input_channels")
            ))
    return devices

def _resolve_default_sr(device_id: Optional[int]) -> int:
    try:
        info = sd.query_devices(device_id) if device_id is not None else sd.query_devices(sd.default.device[0])
        return int(info.get("default_samplerate", 48000))
    except Exception:
        return 48000

@router.get("/status", response_model=AudioStatus)
def audio_status():
    name = None
    if _current_device is not None:
        try:
            name = sd.query_devices(_current_device)["name"]
        except Exception:
            name = None
    return AudioStatus(
        running=_run_audio,
        device_id=_current_device,
        device_name=name,
        samplerate=_current_sr,
        hop=_current_hop
    )

@router.post("/start", response_model=AudioStatus)
def start_audio(device_id: int | None = None, samplerate: int | None = None, hop: int | None = None):
    """Startuje lub PRZEŁĄCZA aktywne urządzenie, jeśli już działa."""
    global _audio_thread, _run_audio, SAMPLERATE, HOP_SIZE, _current_device, _current_sr, _current_hop
    dev = device_id if device_id is not None else (sd.default.device[0] if sd.default.device else None)
    sr = samplerate or _resolve_default_sr(dev)
    h = hop or 1024

    # jeśli już działa i konfiguracja jest ta sama -> nic nie rób
    if _run_audio and _current_device == dev and _current_sr == sr and _current_hop == h:
        return audio_status()

    # jeśli działa, zatrzymaj przed restartem
    if _run_audio:
        _run_audio = False
        if _audio_thread:
            _audio_thread.join(timeout=1.0)
        _audio_thread = None

    SAMPLERATE = sr
    HOP_SIZE = h
    _run_audio = True
    _audio_thread = threading.Thread(target=_audio_capture_thread, args=(dev, sr, h), daemon=True)
    _audio_thread.start()
    return audio_status()

@router.post("/stop", response_model=AudioStatus)
def stop_audio():
    global _run_audio, _audio_thread, _current_device, _current_sr, _current_hop
    _run_audio = False
    if _audio_thread:
        _audio_thread.join(timeout=1.0)
    _audio_thread = None
    _current_device = None
    _current_sr = None
    _current_hop = None
    return audio_status()

# =============================
# WebSocket: analiza
#  - nadal autostartuje, ale /start może przełączyć urządzenie w locie
# =============================
@router.websocket("/ws/analyze")
async def analyze_audio_ws(websocket: WebSocket):
    global _main_loop
    await websocket.accept()
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        _main_loop = None

    _ws_lock.acquire()
    _ws_connections.append(websocket)
    _ws_lock.release()

    # Autostart, jeśli nic nie działa — wystartuje na domyślnym,
    # ALE wybranie urządzenia przez /start przełączy strumień.
    if not _run_audio:
        try:
            start_audio(None, None, None)
        except Exception as e:
            print(f"[audio] autostart fail: {e}")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_lock.acquire()
        if websocket in _ws_connections:
            _ws_connections.remove(websocket)
        _ws_lock.release()

# =============================
# REST: konfiguracja redukcji szumów
# =============================
@router.get("/noise_config", response_model=NoiseConfig)
def get_noise_config():
    with _cfg_lock:
        return _noise_cfg

@router.post("/noise_config", response_model=NoiseConfig)
def set_noise_config(cfg: NoiseConfig):
    global _noise_cfg
    with _cfg_lock:
        _noise_cfg = cfg
    _update_hpf_alpha(SAMPLERATE)
    return _noise_cfg

@router.post("/noise_calibrate")
def noise_calibrate(seconds: float = 1.0):
    _start_calibration(max(0.25, min(5.0, seconds)))
    return {"status": "calibrating", "seconds": seconds}
