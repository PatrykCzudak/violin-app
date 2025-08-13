import { useEffect, useState } from "react";
import { getDevices, startAudio, stopAudio } from "../api";
import type { AudioDevice } from "../types";

export default function AudioSourceSelector(props: {
  onStarted?: () => void; onStopped?: () => void;
}) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [deviceId, setDeviceId] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);

  useEffect(() => { getDevices().then(setDevices); }, []);

  const start = async () => {
    await startAudio({ device_id: deviceId, samplerate: 44100, blocksize: 1024, channels: 1 });
    setRunning(true); props.onStarted?.();
  };
  const stop = async () => {
    await stopAudio(); setRunning(false); props.onStopped?.();
  };

  return (
    <div className="card vstack">
      <h1>Wejście audio</h1>
      <label>Urządzenie</label>
      <select value={deviceId ?? ""} onChange={e => setDeviceId(Number(e.target.value))}>
        <option value="">Domyślne</option>
        {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <div className="hstack">
        {!running
          ? <button onClick={start}>Start analizy</button>
          : <button onClick={stop}>Stop</button>}
        <span className="badge">{running ? "działa" : "zatrzymane"}</span>
      </div>
    </div>
  );
}
