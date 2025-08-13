import os, uuid
import numpy as np
import soundfile as sf
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter()
OUT_DIR = "backend/data/outputs"
os.makedirs(OUT_DIR, exist_ok=True)

@router.get("/metronome")
def make_metronome(tempo: int = Query(120, ge=30, le=300), bars: int = Query(4, ge=1, le=200), beats_per_bar: int = Query(4, ge=1, le=12), sr: int = 44100):
    """
    Generuje prosty WAV z klikami metronomu (pierwszy mocniejszy).
    Zwraca URL do pliku.
    """
    seconds_per_beat = 60.0 / tempo
    total_beats = bars * beats_per_bar
    duration = total_beats * seconds_per_beat

    t = np.arange(int(duration * sr)) / sr
    audio = np.zeros_like(t, dtype=np.float32)

    def click(start_sample, loud=1.0):
        length = int(0.03 * sr)  # 30 ms klik
        freq = 1000.0 if loud > 0.9 else 800.0
        win = np.hanning(length)
        sig = (np.sin(2*np.pi*freq*np.arange(length)/sr) * win * loud).astype(np.float32)
        audio[start_sample:start_sample+length] += sig[:max(0, len(audio)-start_sample)]

    for b in range(total_beats):
        start = int(b * seconds_per_beat * sr)
        loud = 1.0 if (b % beats_per_bar == 0) else 0.6
        click(start, loud)

    # normalizacja
    peak = np.max(np.abs(audio)) or 1.0
    audio = (audio / peak * 0.8).astype(np.float32)

    fname = f"metronome_{tempo}bpm_{bars}x{beats_per_bar}_{uuid.uuid4().hex}.wav"
    path = os.path.join(OUT_DIR, fname)
    sf.write(path, audio, sr)
    url = f"/media/outputs/{fname}"
    return {"url": url, "tempo": tempo, "bars": bars, "beats_per_bar": beats_per_bar}
