import { useEffect, useState } from "react";

type Device = { id: number; name: string; default_samplerate?: number; max_input_channels?: number };
type Status = { running: boolean; device_id: number | null; device_name: string | null; samplerate: number | null; hop: number | null };

const BASE = "http://localhost:8000";

export default function AudioSourceSelector() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<number | "default">("default");
  const [status, setStatus] = useState<Status | null>(null);
  const [hop, setHop] = useState(1024);
  const [samplerate, setSamplerate] = useState<number | "auto">("auto");
  const [loading, setLoading] = useState(false);

  const refreshDevices = async () => {
    const res = await fetch(`${BASE}/api/audio/devices`);
    const json = await res.json();
    setDevices(json);
  };

  const refreshStatus = async () => {
    const res = await fetch(`${BASE}/api/audio/status`);
    const json = await res.json();
    setStatus(json);
  };

  useEffect(() => {
    refreshDevices();
    refreshStatus();
  }, []);

  const start = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selected !== "default") params.append("device_id", String(selected));
    if (samplerate !== "auto") params.append("samplerate", String(samplerate));
    if (hop) params.append("hop", String(hop));
    const url = `${BASE}/api/audio/start${params.toString() ? "?" + params.toString() : ""}`;
    await fetch(url, { method: "POST" });
    await refreshStatus();
    setLoading(false);
  };

  const stop = async () => {
    setLoading(true);
    await fetch(`${BASE}/api/audio/stop`, { method: "POST" });
    await refreshStatus();
    setLoading(false);
  };

  const applyAndRestart = async () => {
    // wygodne: „Zastosuj” = po prostu POST /start ze wskazanym device_id (backend sam przełączy)
    await start();
  };

  const currentInfo = status?.running
    ? `ON: ${status.device_name ?? "domyślne"} @ ${status.samplerate ?? "-"} Hz (hop ${status.hop ?? "-"})`
    : "OFF";

  return (
    <div className="card">
      <div className="hstack" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Wejście audio</h3>
        <span className="badge">{currentInfo}</span>
      </div>

      <div className="vstack" style={{ gap: 8 }}>
        <div className="hstack" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="hstack" style={{ gap: 6 }}>
            Urządzenie:
            <select value={selected} onChange={(e) => setSelected(e.target.value === "default" ? "default" : Number(e.target.value))}>
              <option value="default">Domyślne (system)</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>
                  [{d.id}] {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="hstack" style={{ gap: 6 }}>
            Samplerate:
            <select value={samplerate} onChange={(e) => {
              const v = e.target.value;
              setSamplerate(v === "auto" ? "auto" : Number(v));
            }}>
              <option value="auto">Auto (domyślne urządzenia)</option>
              <option value="44100">44100</option>
              <option value="48000">48000</option>
            </select>
          </label>

          <label className="hstack" style={{ gap: 6 }}>
            Hop:
            <select value={hop} onChange={(e) => setHop(Number(e.target.value))}>
              <option value={512}>512 (niższa latencja)</option>
              <option value={1024}>1024 (domyślne)</option>
              <option value={2048}>2048 (stabilniej)</option>
            </select>
          </label>
        </div>

        <div className="hstack" style={{ gap: 8 }}>
          <button onClick={applyAndRestart} disabled={loading}>Zastosuj / Start</button>
          <button onClick={stop} disabled={loading || !status?.running}>Stop</button>
          <button onClick={refreshDevices}>Odśwież listę</button>
          <button onClick={refreshStatus}>Status</button>
        </div>
      </div>
    </div>
  );
}
