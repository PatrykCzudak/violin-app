import { useEffect, useRef, useState } from "react";
import type { PitchFrame } from "../types";
import { connectAnalyze } from "../websocket";

function centsBar(cents: number) {
  const clamp = Math.max(-50, Math.min(50, cents));
  return { left: `${50 + clamp}%` };
}

export default function Tuner() {
  const [frame, setFrame] = useState<PitchFrame | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = connectAnalyze(setFrame);
    wsRef.current = ws;
    return () => { try { ws.close(); } catch {} };
  }, []);

  return (
    <div className="card vstack">
      <h1>Tuner & rytm</h1>
      <div className="hstack" style={{gap:24}}>
        <div className="vstack" style={{minWidth:220}}>
          <div style={{fontSize:36, fontWeight:700}}>{frame?.note ?? "-"}</div>
          <div className="mono" style={{opacity:.8}}>~ {frame?.pitch_hz?.toFixed(1) ?? 0} Hz</div>
          <div className="mono" style={{opacity:.8}}>BPM: {frame?.bpm ? frame.bpm.toFixed(1) : "-"}</div>
        </div>
        <div style={{flex:1}}>
          <div style={{position:"relative", height:16, background:"#0e1733", border:"1px solid #253a78", borderRadius:999}}>
            <div style={{
              position:"absolute", top:-4, width:2, height:24, background:"#9ad0ff", left:"50%"
            }}/>
            <div style={{
              position:"absolute", top:-4, width:10, height:24, background:"#59ffa0", borderRadius:2,
              transform:"translateX(-50%)", ...centsBar(frame?.cents ?? 0)
            }}/>
          </div>
          <div className="hstack" style={{justifyContent:"space-between", fontSize:12, opacity:.8}}>
            <span>-50¢</span><span>0¢</span><span>+50¢</span>
          </div>
        </div>
      </div>
    </div>
  );
}
