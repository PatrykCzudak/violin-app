from fastapi import APIRouter
import numpy as np
import wave
import uuid
import os

router = APIRouter()

ACCOMP_DIR = "backend/data/accomp"  # katalog do zapisu wygenerowanych podkładów/metronomu
os.makedirs(ACCOMP_DIR, exist_ok=True)

@router.get("/metronome")
def generate_metronome(tempo: int = 120, bars: int = 4, beats_per_bar: int = 4):
    """
    Generuje plik WAV z dźwiękiem metronomu o zadanym tempie, liczbie taktów i bitach na takt.
    Zwraca URL wygenerowanego pliku.
    """
    sr = 44100  # częstotliwość próbkowania
    # Ustawienia dźwięków metronomu
    accent_freq = 1000.0   # Hz (akcentowany takt)
    normal_freq = 1000.0   # Hz (normalne uderzenie - tu używamy tej samej częstotliwości, można zmienić)
    accent_vol = 1.0
    normal_vol = 0.5
    tick_duration = 0.1    # czas trwania kliknięcia w sekundach

    total_beats = bars * beats_per_bar
    beat_interval = 60.0 / tempo  # odstęp między uderzeniami (sekundy)
    total_duration = total_beats * beat_interval + tick_duration  # całkowity czas trwania nagrania
    total_samples = int(total_duration * sr)

    # Przygotuj tablicę na próbki audio (mono, 16-bit)
    audio = np.zeros(total_samples, dtype=np.int16)

    # Przygotuj próbkę dźwięku kliknięcia dla akcentu i normalnego uderzenia
    t = np.linspace(0, tick_duration, int(tick_duration * sr), endpoint=False)
    accent_wave = (np.sin(2 * np.pi * accent_freq * t) * (32767 * accent_vol)).astype(np.int16)
    normal_wave = (np.sin(2 * np.pi * normal_freq * t) * (32767 * normal_vol)).astype(np.int16)

    # Wstaw dźwięki do tablicy audio na odpowiednich pozycjach czasowych
    for beat in range(total_beats):
        start_index = int(round(beat * beat_interval * sr))
        if start_index >= total_samples:
            break
        wave_data = accent_wave if (beat % beats_per_bar == 0) else normal_wave
        end_index = start_index + len(wave_data)
        if end_index > total_samples:
            end_index = total_samples
            wave_data = wave_data[:(end_index - start_index)]
        audio[start_index:end_index] = wave_data

    # Zapisz dane do pliku WAV
    filename = f"metronome_{tempo}bpm_{beats_per_bar}beat_{bars}bars_{uuid.uuid4().hex[:8]}.wav"
    filepath = os.path.join(ACCOMP_DIR, filename)
    with wave.open(filepath, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sr)
        wf.writeframes(audio.tobytes())

    url = f"/media/accomp/{filename}"
    return {"url": url}
