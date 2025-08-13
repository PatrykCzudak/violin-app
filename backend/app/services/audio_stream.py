import threading, time
import numpy as np
import sounddevice as sd
from typing import Callable, Optional
from .pitch import AubioAnalyser

class AudioStream:
    """
    Prosty strumień wejścia audio z analizą na żywo.
    Dostarcza callback(frame_info_dict) ~ co hop_size/samplerate sek.
    """
    def __init__(self, device: Optional[int], samplerate: int = 44100, blocksize: int = 1024, channels: int = 1):
        self.device = device
        self.samplerate = samplerate
        self.blocksize = blocksize
        self.channels = channels
        self._stream = None
        self._thread = None
        self._stop = threading.Event()
        self._analyser = AubioAnalyser(samplerate, blocksize)
        self._callback: Optional[Callable[[dict], None]] = None
        self._t0 = time.time()

    def start(self, callback: Callable[[dict], None]):
        self._callback = callback
        self._stop.clear()
        self._stream = sd.InputStream(
            device=self.device,
            channels=self.channels,
            samplerate=self.samplerate,
            blocksize=self.blocksize,
            dtype="float32",
            callback=self._audio_callback,
        )
        self._stream.start()

    def _audio_callback(self, indata, frames, time_info, status):
        if self._stop.is_set():
            return
        # mono: bierz kanał 0
        mono = indata[:, 0] if indata.ndim > 1 else indata
        pitch_hz, note, cents, onset, bpm = self._analyser.process(mono)
        if self._callback:
            self._callback({
                "t": time.time() - self._t0,
                "pitch_hz": pitch_hz,
                "note": note,
                "cents": cents,
                "onset": onset,
                "bpm": bpm
            })

    def stop(self):
        self._stop.set()
        try:
            if self._stream:
                self._stream.stop()
                self._stream.close()
        finally:
            self._stream = None
