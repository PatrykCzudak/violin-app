import numpy as np
import aubio
import math

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def hz_to_note_and_cents(freq: float, a4: float = 440.0):
    if freq <= 0:
        return ("-", 0.0)
    midi = 69 + 12 * math.log2(freq / a4)
    midi_round = int(round(midi))
    cents = (midi - midi_round) * 100.0
    name = NOTE_NAMES[midi_round % 12] + str(midi_round // 12 - 1)
    return name, cents

class AubioAnalyser:
    def __init__(self, samplerate: int, hop_size: int):
        self.pitch_o = aubio.pitch("yin", 2048, hop_size, samplerate)
        self.pitch_o.set_unit("Hz")
        self.pitch_o.set_silence(-40)  # dB
        self.onset_o = aubio.onset("default", 1024, hop_size, samplerate)
        self.tempo_o = aubio.tempo("default", 1024, hop_size, samplerate)

    def process(self, frame: np.ndarray):
        # aubio oczekuje kolumny float32
        vec = frame.astype(np.float32)
        pitch_hz = float(self.pitch_o(vec)[0])
        onset = bool(self.onset_o(vec))
        bpm = float(self.tempo_o.get_bpm()) if self.tempo_o(vec) else float(self.tempo_o.get_bpm())
        note, cents = hz_to_note_and_cents(pitch_hz)
        return pitch_hz, note, cents, onset, bpm or 0.0
