from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import HTTPException
from ..models.schemas import AudioDevice, StartAudioRequest
import sounddevice as sd
from typing import List
from ..services.audio_stream import AudioStream

router = APIRouter()

# Jeden globalny strumień (na start wystarczy)
_stream: AudioStream | None = None

class WSManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        to_remove = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.disconnect(ws)

ws_manager = WSManager()

@router.get("/devices", response_model=List[AudioDevice])
def list_devices():
    devices = sd.query_devices()
    res = []
    for idx, d in enumerate(devices):
        if d.get("max_input_channels", 0) > 0:
            name = f"{d['name']} ({d.get('hostapi', '')})"
            res.append(AudioDevice(id=idx, name=name))
    return res

@router.post("/start")
def start_audio(cfg: StartAudioRequest):
    global _stream
    if _stream:
        _stream.stop()
    _stream = AudioStream(device=cfg.device_id, samplerate=cfg.samplerate, blocksize=cfg.blocksize, channels=cfg.channels)
    try:
        _stream.start(lambda frame: 
            # „fire-and-forget” – wysyłamy do wszystkich podłączonych WS
            asyncio_run_safe(ws_manager.broadcast(frame))
        )
    except Exception as e:
        _stream = None
        raise HTTPException(400, f"Cannot start audio stream: {e}")
    return {"started": True}

@router.post("/stop")
def stop_audio():
    global _stream
    if _stream:
        _stream.stop()
        _stream = None
    return {"stopped": True}

@router.websocket("/ws/analyze")
async def ws_analyze(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            # keepalive: odbieraj puste wiadomości/komendy jeśli chcesz
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

# mały helper do wywołań async z wątku audio
import asyncio
def asyncio_run_safe(coro):
    loop = None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        pass
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, loop)
    else:
        asyncio.run(coro)
