import type { PitchFrame } from "./types";
import { wsUrlAnalyze } from "./api";

export function connectAnalyze(onFrame: (f: PitchFrame) => void) {
  const ws = new WebSocket(wsUrlAnalyze());
  ws.onopen = () => {
    // utrzymuj połączenie: wysyłaj keepalive co 5s
    const int = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 5000);
    (ws as any)._keepalive = int;
  };
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onFrame(data as PitchFrame);
    } catch {}
  };
  ws.onclose = () => {
    const int = (ws as any)._keepalive;
    if (int) clearInterval(int);
  };
  return ws;
}
