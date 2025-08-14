import { useEffect, useRef, useState } from "react";

/**
 * Prosty podgląd mikrofonu:
 * - VU meter (level/db)
 * - waveform (128 punktów)
 * Nasłuchuje na globalny event "pitchData" (emitowany w PracticeTab/ScoreTab).
 */
export default function MicMonitor() {
  const [db, setDb] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string>("--");
  const [hz, setHz] = useState<number>(0);

  const waveRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const onPitch = (e: any) => {
      const d = e.detail || {};
      if (typeof d.db === "number") setDb(d.db);
      if (typeof d.level === "number") setLevel(d.level);
      if (typeof d.pitch_hz === "number") setHz(d.pitch_hz);
      if (typeof d.note === "string" && d.note) setNote(d.note);
      if (Array.isArray(d.wave)) waveRef.current = d.wave as number[];
    };
    document.addEventListener("pitchData", onPitch);
    return () => document.removeEventListener("pitchData", onPitch);
  }, []);

  // rysowanie waveform
  useEffect(() => {
    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const W = cv.width, H = cv.height;

      ctx.clearRect(0, 0, W, H);
      // tło
      ctx.fillStyle = "#0e1733";
      ctx.fillRect(0, 0, W, H);

      // siatka środkowa
      ctx.strokeStyle = "#223060";
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      const wave = waveRef.current;
      if (wave && wave.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = "#59ffa0";
        const n = wave.length;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * W;
          const y = H / 2 - (wave[i] || 0) * (H * 0.4);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // VU bar
      const vuW = W, vuH = 8;
      const l = Math.max(0, Math.min(1, level));
      ctx.fillStyle = "#1d2a54";
      ctx.fillRect(0, H - vuH, vuW, vuH);
      ctx.fillStyle = "#59ffa0";
      ctx.fillRect(0, H - vuH, vuW * l, vuH);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [level]);

  return (
    <div className="card" style={{ width: "100%" }}>
      <h3>Podgląd mikrofonu</h3>
      <div className="hstack" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="mono">Note: <strong>{note}</strong> &nbsp; ~{hz ? hz.toFixed(1) : 0} Hz</div>
        <div className="mono">Level: {(db ?? -120).toFixed(1)} dBFS</div>
      </div>
      <canvas ref={canvasRef} width={600} height={120} style={{ width: "100%", height: 120, background: "#0e1733", border: "1px solid #223060", borderRadius: 8 }} />
    </div>
  );
}
