import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { uploadScore } from "../api";
import MicMonitor from "./MicMonitor";

// --- mapowania na półtony (MIDI) ---
type Step = "A"|"B"|"C"|"D"|"E"|"F"|"G";
const STEP_TO_PC: Record<Step, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

function midiFromStepAlterOct(step: Step, alter: number | undefined, octave: number): number {
  const a = typeof alter === "number" ? alter : 0;
  return (octave + 1) * 12 + STEP_TO_PC[step] + a;
}
function midiFromBackendName(s: string | null | undefined): number | null {
  if (!s || s.length < 2) return null;
  const step = s[0]!.toUpperCase() as Step;
  let i = 1;
  let alter = 0;
  if (s[i] === "#") { alter = 1; i++; }
  else if (s[i] === "b" || s[i] === "♭") { alter = -1; i++; }
  const octave = parseInt(s.slice(i), 10);
  if (Number.isNaN(octave)) return null;
  return midiFromStepAlterOct(step, alter, octave);
}

// --- parametry rozpoznania / sterowania ---
const STABLE_FRAMES = 3;           // ile kolejnych ramek ma pasować
const BUFFER_SIZE = 8;             // ile ostatnich ramek trzymamy
const SILENCE_FRAMES_ARM = 2;      // ile ramek ciszy, by „uzbroić” kolejną decyzję
const MIN_INTER_DECISION_MS = 250; // min odstęp między decyzjami

type Mode = "tempo" | "event";     // tempo: kursorem steruje zegar; event: po poprawnej nucie

type WsState = "idle" | "connecting" | "connected" | "error";

export default function ScoreTab() {
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [scoreLoaded, setScoreLoaded] = useState(false);
  const [message, setMessage] = useState<string>("Wczytaj plik nut (MusicXML / MXL).");
  const [parts, setParts] = useState<{index:number; name:string}[]>([]);
  const [selectedPart, setSelectedPart] = useState<number>(0);

  // --- WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const [wsState, setWsState] = useState<WsState>("idle");
  const wsReconnectDelayRef = useRef<number>(1000); // backoff 1s -> 5s
  const pingTimerRef = useRef<number | null>(null);

  // --- stan rozpoznawania
  const [pausedUntilCorrect, setPausedUntilCorrect] = useState(false);
  const armedRef = useRef<boolean>(true);
  const silenceCountRef = useRef<number>(0);
  const lastDecisionTimeRef = useRef<number>(0);
  const midiBufRef = useRef<(number | null)[]>([]);
  const currentWasCorrectRef = useRef<boolean>(false); // czy bieżąca nuta została trafiona (dla trybu tempo)

  // --- transport (tempo)
  const [mode, setMode] = useState<Mode>("tempo");
  const [bpm, setBpm] = useState<number>(80);
  const transportTimerRef = useRef<number | null>(null);
  const [transportRunning, setTransportRunning] = useState<boolean>(false);
  const transportRunningRef = useRef<boolean>(false); // ref do logiki timera

  // pomocnicze: kolorowanie nut pod kursorem
  function colorCursorNotes(color: string) {
    const cursor = osmdRef.current?.cursor;
    if (!cursor) return;
    const gNotes = cursor.GNotesUnderCursor();
    gNotes.forEach((g) => {
      const el = g.getSVGGElement();
      if (el) el.querySelectorAll("path").forEach((p) => p.setAttribute("fill", color));
    });
  }
  function highlightCurrent() { colorCursorNotes("#66AAFF"); }

  // pobranie informacji o elemencie pod kursorem (nuta/pauza)
  function getCursorElementInfo(): { isRest: boolean; expectedMidi: number | null; wholeFrac: number } {
    const cursor = osmdRef.current?.cursor;
    if (!cursor) return { isRest: false, expectedMidi: null, wholeFrac: 0.25 };
    const notes: any[] | undefined = cursor.NotesUnderCursor() as any;
    const first = notes && notes[0];

    // długość (whole = 1, quarter = 0.25, eighth = 0.125)
    const frac =
      first?.sourceNote?.Length?.RealValue ??
      first?.sourceNote?.Length?.realValue ??
      first?.sourceNote?.length?.realValue ??
      0.25;

    // pauza?
    if (!first || first.sourceNote?.isRest()) {
      return { isRest: true, expectedMidi: null, wholeFrac: typeof frac === "number" && frac > 0 ? frac : 0.25 };
    }

    // nuta
    const pitch = first.sourceNote?.pitch;
    const step = (pitch?.step as Step) ?? "C";
    const alter = (pitch?.alter as number | undefined) ?? 0;
    const octave = (pitch?.octave as number) ?? 4;
    return {
      isRest: false,
      expectedMidi: midiFromStepAlterOct(step, alter, octave),
      wholeFrac: typeof frac === "number" && frac > 0 ? frac : 0.25
    };
  }

  // przesuń kursor o 1 element (nuta lub pauza)
  function advanceCursorOneStep() {
    const cursor = osmdRef.current?.cursor;
    if (!cursor || cursor.Iterator.EndReached) return;
    cursor.next();
  }

  // przesuń do następnej *gralnej* nuty (pomijaj pauzy)
  function advanceToNextPlayable() {
    const cursor = osmdRef.current?.cursor;
    if (!cursor) return;
    if (cursor.Iterator.EndReached) return;
    let guard = 0;
    do {
      cursor.next();
      const info = getCursorElementInfo();
      if (!info.isRest) break;
      guard++;
    } while (!cursor.Iterator.EndReached && guard < 256);
    highlightCurrent();
  }

  function stableMatch(expectedMidi: number): boolean {
    const buf = midiBufRef.current.filter((x) => x !== null) as number[];
    if (buf.length < STABLE_FRAMES) return false;
    const last = buf.slice(-STABLE_FRAMES);
    return last.every((m) => m === expectedMidi);
  }

  // --- Transport (tempo) ---
  function clearTransportTimer() {
    if (transportTimerRef.current) {
      window.clearTimeout(transportTimerRef.current);
      transportTimerRef.current = null;
    }
  }

  function scheduleNextTick() {
    clearTransportTimer();
    const { wholeFrac } = getCursorElementInfo();         // np. 0.25 dla ćwierćnuty / pauzy
    const wholeMs = (4 * 60_000) / bpm;                   // czas całej nuty przy BPM
    const delayMs = Math.max(50, Math.round(wholeFrac * wholeMs));

    transportTimerRef.current = window.setTimeout(() => {
      if (!transportRunningRef.current) return;

      const info = getCursorElementInfo();

      // 1) Pauza: odlicz i przejdź dalej bez czekania na granie
      if (info.isRest) {
        advanceCursorOneStep();
        highlightCurrent();
        scheduleNextTick();
        return;
      }

      // 2) Nuta: jeśli NIE trafiona do końca czasu -> PAUZA
      if (!currentWasCorrectRef.current) {
        colorCursorNotes("#dd0000");
        setPausedUntilCorrect(true);
        transportRunningRef.current = false;
        setTransportRunning(false);
        return;
      }

      // 3) Trafiona – zaznacz i dalej
      colorCursorNotes("#00aa00");
      currentWasCorrectRef.current = false; // reset pod kolejną nutę
      advanceCursorOneStep();
      highlightCurrent();
      scheduleNextTick();
    }, delayMs);
  }

  function startTransport() {
    if (!scoreLoaded || wsState !== "connected") return;
    setPausedUntilCorrect(false);
    currentWasCorrectRef.current = false;
    transportRunningRef.current = true;
    setTransportRunning(true);
    highlightCurrent();
    scheduleNextTick();
  }

  function stopTransport() {
    transportRunningRef.current = false;
    setTransportRunning(false);
    clearTransportTimer();
  }

  // inicjalizacja OSMD
  useEffect(() => {
    if (containerRef.current && !osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, { autoResize: true });
    }
  }, []);

  // --- WebSocket: solidne łączenie + autoreconnect ---
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (wsRef.current) return; // już jest
      setWsState("connecting");
      try {
        const ws = new WebSocket("ws://localhost:8000/api/audio/ws/analyze");
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setWsState("connected");
          wsReconnectDelayRef.current = 1000; // reset backoff
          // ping co 5s
          if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try { ws.send("ping"); } catch {}
            }
          }, 5000) as unknown as number;
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          // tuner/monitor
          document.dispatchEvent(new CustomEvent("pitchData", { detail: data }));

          const now = performance.now();

          // uzbrajanie po ciszy
          if (data.gated) {
            silenceCountRef.current = Math.min(silenceCountRef.current + 1, 1000);
            if (silenceCountRef.current >= SILENCE_FRAMES_ARM) armedRef.current = true;
          } else {
            silenceCountRef.current = 0;
          }

          // bufor MIDI
          const playedMidi = midiFromBackendName(data.note);
          if (playedMidi !== null && !data.gated) {
            midiBufRef.current = [...midiBufRef.current.slice(-BUFFER_SIZE + 1), playedMidi];
          }

          const cursor = osmdRef.current?.cursor;
          if (!cursor || cursor.Iterator.EndReached) return;

          const info = getCursorElementInfo();

          // === TRYB TEMPO ===
          if (mode === "tempo") {
            // pauza po błędzie – czekamy aż zagrasz właściwą nutę
            if (pausedUntilCorrect) {
              if (!info.isRest && info.expectedMidi !== null && stableMatch(info.expectedMidi)) {
                colorCursorNotes("#00aa00");
                setPausedUntilCorrect(false);
                currentWasCorrectRef.current = false; // nowa nuta od następnego ticka
                startTransport(); // wznowienie
              }
              return;
            }

            // w normalnym biegu: zapamiętaj trafienie (timer wykorzysta)
            if (!info.isRest && info.expectedMidi !== null) {
              if (stableMatch(info.expectedMidi) || (playedMidi !== null && playedMidi === info.expectedMidi)) {
                currentWasCorrectRef.current = true;
              }
            }

            // jeśli onset i ewidentnie zła nuta – zatrzymaj natychmiast
            const enoughTime = now - lastDecisionTimeRef.current > MIN_INTER_DECISION_MS;
            if (data.onset && armedRef.current && enoughTime) {
              lastDecisionTimeRef.current = now;
              armedRef.current = false;
              if (!info.isRest && info.expectedMidi !== null) {
                const ok = stableMatch(info.expectedMidi) || (playedMidi !== null && playedMidi === info.expectedMidi);
                if (!ok) {
                  colorCursorNotes("#dd0000");
                  setPausedUntilCorrect(true);
                  stopTransport();
                }
              }
            }
            return;
          }

          // === TRYB EVENT (po poprawnej nucie) ===
          if (pausedUntilCorrect) {
            if (!info.isRest && info.expectedMidi !== null && stableMatch(info.expectedMidi)) {
              colorCursorNotes("#00aa00");
              setPausedUntilCorrect(false);
              lastDecisionTimeRef.current = now;
              armedRef.current = false;
              midiBufRef.current = [];
              advanceToNextPlayable();
            }
            return;
          }

          const enoughTime = now - lastDecisionTimeRef.current > MIN_INTER_DECISION_MS;
          if (data.onset && armedRef.current && enoughTime) {
            if (!info.isRest && info.expectedMidi !== null &&
                (stableMatch(info.expectedMidi) || (playedMidi !== null && playedMidi === info.expectedMidi))) {
              colorCursorNotes("#00aa00");
              lastDecisionTimeRef.current = now;
              armedRef.current = false;
              midiBufRef.current = [];
              advanceToNextPlayable();
            } else if (!info.isRest) {
              colorCursorNotes("#dd0000");
              setPausedUntilCorrect(true);
              lastDecisionTimeRef.current = now;
              armedRef.current = false;
            } else {
              // onset „na pauzie” – przeskocz pauzę
              advanceToNextPlayable();
            }
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setWsState("error");
        };

        ws.onclose = () => {
          if (cancelled) return;
          setWsState("error");
          wsRef.current = null;
          if (pingTimerRef.current) {
            window.clearInterval(pingTimerRef.current);
            pingTimerRef.current = null;
          }
          // spróbuj ponownie z backoffem
          const delay = Math.min(wsReconnectDelayRef.current, 5000);
          wsReconnectDelayRef.current = delay * 1.6;
          setTimeout(() => {
            if (!cancelled) connect();
          }, delay);
        };
      } catch (_e) {
        if (cancelled) return;
        setWsState("error");
        setTimeout(() => { if (!cancelled) connect(); }, Math.min(wsReconnectDelayRef.current, 5000));
        wsReconnectDelayRef.current *= 1.6;
      }
    }

    // łączymy tylko gdy partytura jest wczytana – wtedy od razu mamy kursor
    if (scoreLoaded) connect();

    return () => {
      cancelled = true;
      if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      setWsState("idle");
    };
  }, [scoreLoaded, mode]); // zmiana trybu nie niszczy WS, ale odświeżamy onmessage zachowanie

  // wczytanie partytury (.xml/.musicxml/.mxl) + wybór części
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !osmdRef.current) return;

    setMessage("Wysyłanie pliku…");
    try {
      const res = await uploadScore(file); // { url: "/media/scores/..." }
      setMessage("Ładowanie i renderowanie…");
      await osmdRef.current.load(`http://localhost:8000${res.url}`);
      await osmdRef.current.render();

      // wykryj części/instrumenty i zostaw domyślnie pierwszą
      const sheet: any = (osmdRef.current as any).sheet;
      const instruments: any[] = sheet?.Instruments || sheet?.instruments || [];
      if (instruments.length > 0) {
        const found = instruments.map((inst: any, idx: number) => ({
          index: idx,
          name: inst?.Name || inst?.name || `Part ${idx + 1}`
        }));
        setParts(found);
        setSelectedPart(0);
        instruments.forEach((inst: any, i: number) => (inst.Visible = i === 0));
        await osmdRef.current.render();
      } else {
        setParts([]);
      }

      osmdRef.current.cursor.show();
      // podświetl pierwszy element (może to być pauza – ok)
      highlightCurrent();

      setScoreLoaded(true);
      setMessage("Partytura gotowa. Połącz audio (WS) i kliknij Start.");

      // reset stanów
      setPausedUntilCorrect(false);
      armedRef.current = true;
      silenceCountRef.current = 0;
      midiBufRef.current = [];
      currentWasCorrectRef.current = false;
      lastDecisionTimeRef.current = performance.now();
      stopTransport();
    } catch (err) {
      console.error(err);
      setMessage("Błąd podczas wczytywania nut.");
      setScoreLoaded(false);
    }
  };

  // zmiana wybranej partii
  const handlePartChange = async (partIndex: number) => {
    if (!osmdRef.current) return;
    const sheet: any = (osmdRef.current as any).sheet;
    const instruments: any[] = sheet?.Instruments || sheet?.instruments || [];
    if (!instruments.length) return;

    instruments.forEach((inst: any, i: number) => (inst.Visible = i === partIndex));
    await osmdRef.current.render();

    osmdRef.current.cursor.show();
    setSelectedPart(partIndex);

    // reset rozpoznawania/transportu
    setPausedUntilCorrect(false);
    armedRef.current = true;
    silenceCountRef.current = 0;
    midiBufRef.current = [];
    currentWasCorrectRef.current = false;
    lastDecisionTimeRef.current = performance.now();

    highlightCurrent();
    stopTransport();
  };

  const wsBadge =
    wsState === "connected" ? "WS: connected" :
    wsState === "connecting" ? "WS: connecting…" :
    wsState === "error" ? "WS: error — retrying…" : "WS: idle";

  const canStart = scoreLoaded && wsState === "connected" && !transportRunning;

  return (
    <div className="vstack">
      <h2>Tryb Utworu</h2>
      <div className="grid">
        <div className="vstack">
          <div className="card">
            <h3>Wczytaj utwór (MusicXML / MXL)</h3>
            <input
              type="file"
              accept=".xml,.musicxml,.mxl"
              onChange={handleFileUpload}
            />
            <p>{message}</p>

            {parts.length > 1 && (
              <div className="hstack" style={{ gap: 8, flexWrap: "wrap" }}>
                <label>Partia:</label>
                <select value={selectedPart} onChange={(e) => handlePartChange(parseInt(e.target.value, 10))}>
                  {parts.map(p => <option key={p.index} value={p.index}>{p.name}</option>)}
                </select>
              </div>
            )}
            <span className="badge">{wsBadge}</span>
          </div>

          <div className="card">
            <h3>Sterowanie</h3>
            <div className="hstack" style={{ gap: 12, flexWrap: "wrap" }}>
              <label className="hstack" style={{ gap: 6 }}>
                Tryb:
                <select value={mode} onChange={e => { setMode(e.target.value as Mode); stopTransport(); }}>
                  <option value="tempo">Tempo-synchro (linia z BPM)</option>
                  <option value="event">Na dźwięk (po poprawnej nucie)</option>
                </select>
              </label>

              {mode === "tempo" && (
                <>
                  <label className="hstack" style={{ gap: 6 }}>
                    Tempo (BPM):
                    <input
                      type="number" min={30} max={240} value={bpm}
                      onChange={e => {
                        const v = Math.max(30, Math.min(240, Number(e.target.value)));
                        setBpm(v);
                        if (transportRunningRef.current) scheduleNextTick();
                      }}
                      style={{ width: 80 }}
                    />
                  </label>
                  {!transportRunning ? (
                    <button onClick={startTransport} disabled={!canStart}>▶️ Start</button>
                  ) : (
                    <button onClick={stopTransport}>⏸ Stop</button>
                  )}
                </>
              )}

              {pausedUntilCorrect && (
                <span className="badge">⏸ Zatrzymano — zagraj właściwą nutę</span>
              )}
            </div>
            <p style={{opacity:.8, fontSize:12, marginTop:8}}>
              Tempo-synchro: linia idzie zgodnie z BPM i <b>pauzuje</b>, jeśli zagrasz źle lub wcale.
              Pauzy w zapisie są odliczane automatycznie — nie musisz ich „grać”.
            </p>
          </div>

          <div ref={containerRef} style={{ width: "100%", minHeight: 420 }} />
        </div>

        <div className="vstack">
          <MicMonitor />
        </div>
      </div>
    </div>
  );
}
