import { useEffect, useState } from "react";

type NoiseConfig = {
  enabled: boolean;
  gate_db: number;
  hp_enabled: boolean;
  hp_cut_hz: number;
  margin_db: number;
  adaptive: boolean;
  noise_floor_db: number;
};

const BASE = "http://localhost:8000";

export default function NoiseControls() {
  const [cfg, setCfg] = useState<NoiseConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const res = await fetch(`${BASE}/api/audio/noise_config`);
    const json = await res.json();
    setCfg(json);
  };

  useEffect(() => { load(); }, []);

  const save = async (next: Partial<NoiseConfig>) => {
    if (!cfg) return;
    setLoading(true);
    const body = { ...cfg, ...next };
    const res = await fetch(`${BASE}/api/audio/noise_config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setCfg(json);
    setLoading(false);
  };

  const calibrate = async () => {
    setLoading(true);
    await fetch(`${BASE}/api/audio/noise_calibrate`, { method: "POST" });
    setLoading(false);
  };

  if (!cfg) return <div className="card"><h3>Redukcja szumów</h3><div>Ładowanie…</div></div>;

  return (
    <div className="card">
      <h3>Redukcja szumów</h3>
      <div className="vstack" style={{ gap: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={e => save({ enabled: e.target.checked })}
          /> włącz
        </label>

        <label>
          <input
            type="checkbox"
            checked={cfg.hp_enabled}
            onChange={e => save({ hp_enabled: e.target.checked })}
          /> filtr górnoprzepustowy (HPF)
        </label>

        <div className="hstack">
          <label>HPF cut (Hz)</label>
          <input
            type="number" min={20} max={500} step={5}
            value={cfg.hp_cut_hz}
            onChange={e => save({ hp_cut_hz: Number(e.target.value) })}
            style={{ width: 90 }}
          />
        </div>

        <label>
          <input
            type="checkbox"
            checked={cfg.adaptive}
            onChange={e => save({ adaptive: e.target.checked })}
          /> próg adaptacyjny (gate = tło + margines)
        </label>

        {!cfg.adaptive && (
          <div className="hstack">
            <label>Gate (dBFS)</label>
            <input
              type="number" min={-90} max={0} step={1}
              value={cfg.gate_db}
              onChange={e => save({ gate_db: Number(e.target.value) })}
              style={{ width: 80 }}
            />
          </div>
        )}

        {cfg.adaptive && (
          <>
            <div className="hstack">
              <label>Margines (dB)</label>
              <input
                type="number" min={0} max={30} step={1}
                value={cfg.margin_db}
                onChange={e => save({ margin_db: Number(e.target.value) })}
                style={{ width: 80 }}
              />
              <span className="mono">tło: {cfg.noise_floor_db.toFixed(1)} dBFS</span>
            </div>
            <button onClick={calibrate} disabled={loading}>
              Kalibruj tło (~1s)
            </button>
          </>
        )}
        {loading && <span className="badge">zapisywanie…</span>}
      </div>
    </div>
  );
}
