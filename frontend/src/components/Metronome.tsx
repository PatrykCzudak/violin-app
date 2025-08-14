import { useEffect, useRef, useState } from "react";

export default function Metronome() {
  const [tempo, setTempo] = useState(60);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [isRunning, setIsRunning] = useState(false);
  const beatCounter = useRef(0);
  const intervalId = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Funkcja odtwarzająca jeden klik metronomu (akcentowany lub nie)
  const playClick = (accent: boolean) => {
    if (!audioCtxRef.current) return;
    const osc = audioCtxRef.current.createOscillator();
    const gainNode = audioCtxRef.current.createGain();
    // Ustaw częstotliwość i głośność w zależności od akcentu
    osc.frequency.value = accent ? 1000 : 1000;
    gainNode.gain.value = accent ? 1.0 : 0.5;
    osc.connect(gainNode).connect(audioCtxRef.current.destination);
    osc.start();
    osc.stop(audioCtxRef.current.currentTime + 0.1); // krótki dźwięk ~100ms
  };

  // Uruchomienie metronomu
  const startMetronome = () => {
    if (isRunning) return;
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    beatCounter.current = 0;
    setIsRunning(true);
    // Oblicz interwał w milisekundach na podstawie tempo
    const intervalMs = (60_000 / tempo);
    intervalId.current = window.setInterval(() => {
      const accent = beatCounter.current % beatsPerBar === 0;
      playClick(accent);
      beatCounter.current = beatCounter.current + 1;
    }, intervalMs);
  };

  // Zatrzymanie metronomu
  const stopMetronome = () => {
    if (intervalId.current) {
      clearInterval(intervalId.current);
      intervalId.current = null;
    }
    setIsRunning(false);
    beatCounter.current = 0;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  // Jeśli zmieniono tempo podczas działania, zresetuj interwał aby dostosować tempo
  useEffect(() => {
    if (isRunning) {
      // Restart z nowym tempem
      stopMetronome();
      startMetronome();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempo, beatsPerBar]);

  return (
    <div className="card metronome">
      <h3>Metronom</h3>
      <div className="hstack" style={{ alignItems: "center" }}>
        <label>Tempo (BPM): </label>
        <input 
          type="number" min={30} max={240} value={tempo} 
          onChange={(e) => setTempo(Number(e.target.value))} 
          style={{ width: "60px", marginRight: "1rem" }}
        />
        <label>Uderzeń na takt: </label>
        <input 
          type="number" min={1} max={12} value={beatsPerBar} 
          onChange={(e) => setBeatsPerBar(Number(e.target.value))} 
          style={{ width: "40px", marginRight: "1rem" }}
        />
        {!isRunning ? (
          <button onClick={startMetronome}>Start</button>
        ) : (
          <button onClick={stopMetronome}>Stop</button>
        )}
      </div>
    </div>
  );
}
