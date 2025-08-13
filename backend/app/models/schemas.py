from pydantic import BaseModel
from typing import List, Optional

class AudioDevice(BaseModel):
    id: int
    name: str

class StartAudioRequest(BaseModel):
    device_id: Optional[int] = None
    samplerate: Optional[int] = 44100
    blocksize: Optional[int] = 1024
    channels: Optional[int] = 1

class PitchFrame(BaseModel):
    t: float
    pitch_hz: float
    note: str
    cents: float
    onset: bool
    bpm: float

class UploadResponse(BaseModel):
    filename: str
    url: str
    kind: str  # "musicxml" | "midi"
    title: str
    parts: int
    measures: int
