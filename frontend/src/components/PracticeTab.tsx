import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import Tuner from "./Tuner";
import Metronome from "./Metronome";
import MicMonitor from "./MicMonitor";
import NoiseControls from "./NoiseControls";

type NoteType = "whole" | "half" | "quarter" | "eighth";
type Step = "A"|"B"|"C"|"D"|"E"|"F"|"G";       // nazwa stopnia
type Alter = -1 | 0 | 1;                        // ♭, natural, ♯

type NoteItem = {
  step: Step;
  alter: Alter;
  octave: number;
  type: NoteType;
  status?: "pending" | "correct" | "wrong" | "current";
};

const DIVISIONS = 8; // whole=8, half=4, quarter=2, eighth=1
const VIOLIN_MIN_MIDI = 55; // G3
const VIOLIN_MAX_MIDI = 88; // E6

// ===== Pomocnicze mapowania / konwersje =====
const STEP_TO_PC: Record<Step, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
const PC_TO_NAME_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;
const PC_TO_NAME_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const;

function midiFromStepAlterOct(step: Step, alter: Alter, octave: number): number {
  return (octave + 1) * 12 + STEP_TO_PC[step] + alter;
}
function preferSharpsForFifths(fifths: number) { return fifths >= 0; }

function spelledFromMidi(midi: number, preferSharps = true): {step: Step; alter: Alter; octave: number} {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = preferSharps ? PC_TO_NAME_SHARP[pc] : PC_TO_NAME_FLAT[pc];
  const step = (name[0] as Step);
  const alter: Alter = name.length > 1 ? (name[1] === "#" ? 1 : -1) : 0;
  return { step, alter, octave };
}

// parsuje string z backendu (np. "C#4" albo "Bb5") do MIDI
function midiFromBackendName(s: string | null | undefined): number | null {
  if (!s || s.length < 2) return null;
  const step = s[0]!.toUpperCase() as Step;
  let i = 1;
  let alter: Alter = 0;
  if (s[i] === "#") { alter = 1; i++; }
  else if (s[i] === "b" || s[i] === "♭") { alter = -1; i++; }
  const octave = parseInt(s.slice(i), 10);
  if (Number.isNaN(octave)) return null;
  return midiFromStepAlterOct(step, alter, octave);
}

function prettyName(step: Step, alter: Alter, octave: number) {
  return `${step}${alter === 1 ? "#" : alter === -1 ? "b" : ""}${octave}`;
}

function typeToBeats(t: NoteType): number {
  switch (t) {
    case "whole": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
  }
}
function typeToDuration(t: NoteType): number {
  switch (t) {
    case "whole": return 8;
    case "half": return 4;
    case "quarter": return 2;
    case "eighth": return 1;
  }
}

// ===== Tonacje (dur) i pitch-classy diatoniczne =====
type MajorKey =
  | "C" | "G" | "D" | "A" | "E"
  | "F" | "Bb" | "Eb" | "Ab" | "Db" | "Gb" | "Cb";
const KEY_TO_FIFTHS: Record<MajorKey, number> = {
  C:0, G:1, D:2, A:3, E:4, B:5, "F#":6 as any, "C#":7 as any, // nie używamy skrajnych, ale mapka dla pełności
  F:-1, Bb:-2, Eb:-3, Ab:-4, Db:-5, Gb:-6, Cb:-7
};
// ekspozycja tylko „skrzypcowo przyjaznych”:
const MAJOR_OPTIONS: Array<{label:string, key: MajorKey, fifths:number}> = [
  {label:"G-dur (1♯)", key:"G", fifths:1},
  {label:"D-dur (2♯)", key:"D", fifths:2},
  {label:"A-dur (3♯)", key:"A", fifths:3},
  {label:"E-dur (4♯)", key:"E", fifths:4},
  {label:"C-dur (0)",  key:"C", fifths:0},
  {label:"F-dur (1♭)", key:"F", fifths:-1},
  {label:"B♭-dur (2♭)", key:"Bb", fifths:-2},
];

function tonicPcForKey(key: MajorKey): number {
  // użyj mapy nazw do pc (z preferencją krzyżyków/bemoli)
  const map: Record<string, number> = { C:0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, F:5, "F#":6, Gb:6, G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11, Cb:11 };
  return map[key];
}
function diatonicPitchClassSetForMajor(tonicPc: number): Set<number> {
  // interwały skali durowej od toniki: 0,2,4,5,7,9,11
  const deg = [0,2,4,5,7,9,11];
  return new Set(deg.map(d => (tonicPc + d) % 12));
}

// ===== Budowanie sekwencji =====
function packToMeasures(seq: NoteItem[], beatsPerBar = 4): NoteItem[][] {
  const measures: NoteItem[][] = [];
  let cur: NoteItem[] = [];
  let sum = 0;
  for (const n of seq) {
    const b = typeToBeats(n.type);
    if (sum + b > beatsPerBar + 1e-6) {
      measures.push(cur);
      cur = [];
      sum = 0;
    }
    cur.push(n);
    sum += b;
    if (Math.abs(sum - beatsPerBar) < 1e-6) {
      measures.push(cur); cur = []; sum = 0;
    }
  }
  if (cur.length) measures.push(cur);
  return measures;
}

function sequenceToMusicXML(seq: NoteItem[], beatsPerBar: number, keyFifths: number): string {
  const measures = packToMeasures(seq, beatsPerBar);
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
 "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Practice</part-name></score-part></part-list>
  <part id="P1">`;
  const attrs = `<attributes>
    <divisions>${DIVISIONS}</divisions>
    <key><fifths>${keyFifths}</fifths></key>
    <time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>
    <clef><sign>G</sign><line>2</line></clef>
  </attributes>`;

  let mm = "";
  let mnum = 1;
  for (const m of measures) {
    mm += `<measure number="${mnum}">` + (mnum === 1 ? attrs : "");
    for (const n of m) {
      const dur = typeToDuration(n.type);
      const color =
        n.status === "correct" ? ` color="#00FF00"` :
        n.status === "wrong"   ? ` color="#FF0000"` :
        n.status === "current" ? ` color="#66AAFF"` :
        "";
      const alterXml = n.alter !== 0 ? `<alter>${n.alter}</alter>` : "";
      mm += `<note${color}>
        <pitch><step>${n.step}</step>${alterXml}<octave>${n.octave}</octave></pitch>
        <duration>${dur}</duration><type>${n.type}</type>
      </note>`;
    }
    mm += `</measure>`;
    mnum++;
  }

  const footer = `</part></score-partwise>`;
  return header + mm + footer;
}

function makeInitialSequence(
  measures: number,
  mode: "diatonic" | "chromatic",
  keyFifths: number,
  beatsPerBar = 4
): NoteItem[] {
  const preferSharps = preferSharpsForFifths(keyFifths);
  const tonicPc = tonicPcForKey(MAJOR_OPTIONS.find(k => k.fifths === keyFifths)!.key);
  const diatonicSet = diatonicPitchClassSetForMajor(tonicPc);

  // zbuduj pulę do losowania (MIDI z zakresem skrzypiec)
  const pool: number[] = [];
  for (let m = VIOLIN_MIN_MIDI; m <= VIOLIN_MAX_MIDI; m++) {
    const pc = ((m % 12) + 12) % 12;
    if (mode === "diatonic") {
      if (diatonicSet.has(pc)) pool.push(m);
    } else {
      pool.push(m);
    }
  }

  const out: NoteItem[] = [];
  for (let meas = 0; meas < measures; meas++) {
    let remaining = beatsPerBar;
    while (remaining > 0) {
      const maxSmall = remaining < 1;
      const t: NoteType = maxSmall ? "eighth" : (["quarter","quarter","half","eighth"] as NoteType[])[Math.floor(Math.random()*4)];
      const beats = typeToBeats(t);
      if (beats > remaining + 1e-6) continue;

      const midi = pool[Math.floor(Math.random() * pool.length)];
      const spelled = spelledFromMidi(midi, preferSharps);
      out.push({ step: spelled.step, alter: spelled.alter, octave: spelled.octave, type: t, status: "pending" });
      remaining = +(remaining - beats).toFixed(4);
    }
  }
  if (out[0]) out[0].status = "current";
  return out;
}

// ===== Komponent =====
export default function PracticeTab() {
  const [running, setRunning] = useState(false);
  const [seq, setSeq] = useState<NoteItem[]>([]);
  const [idx, setIdx] = useState(0);

  const [mode, setMode] = useState<"diatonic"|"chromatic">("diatonic");
  const [keyFifths, setKeyFifths] = useState<number>(2); // domyślnie D-dur (2♯)
  const [beatsPerBar, setBeatsPerBar] = useState<number>(4);

  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (containerRef.current && !osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, { autoResize: true });
    }
  }, []);

  useEffect(() => {
    if (wsRef.current) return;
    const ws = new WebSocket("ws://localhost:8000/api/audio/ws/analyze");
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      document.dispatchEvent(new CustomEvent("pitchData", { detail: data }));
      if (!running) return;
      if (data.gated) return;

      if (data.onset && seq.length > 0 && idx < seq.length) {
        const expected = seq[idx];
        const expectedMidi = midiFromStepAlterOct(expected.step, expected.alter, expected.octave);
        const playedMidi = midiFromBackendName(data.note);

        const next = seq.slice();
        if (playedMidi !== null && playedMidi === expectedMidi) {
          // trafione
          next[idx] = { ...expected, status: "correct" };
          const nextIdx = idx + 1;
          if (nextIdx < next.length) next[nextIdx] = { ...next[nextIdx], status: "current" };
          setSeq(next);
          setIdx(nextIdx);

          // koniec puli -> dokładamy jeden takt nowej sekwencji
          if (nextIdx >= next.length) {
            const more = makeInitialSequence(1, mode, keyFifths, beatsPerBar);
            const extended = next.concat(more);
            setSeq(extended);
            const xml = sequenceToMusicXML(extended, beatsPerBar, keyFifths);
            await osmdRef.current?.load(xml);
            await osmdRef.current?.render();
            return;
          }
        } else {
          // błąd – zaznacz na czerwono
          next[idx] = { ...expected, status: "wrong" };
          setSeq(next);
        }
        const xml = sequenceToMusicXML(next, beatsPerBar, keyFifths);
        await osmdRef.current?.load(xml);
        await osmdRef.current?.render();
      }
    };

    const keep = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 5000);

    return () => {
      clearInterval(keep);
      try { ws.close(); } catch {}
      wsRef.current = null;
    };
  }, [running, seq, idx, mode, keyFifths, beatsPerBar]);

  const startPractice = async () => {
    const initial = makeInitialSequence(2, mode, keyFifths, beatsPerBar);
    setSeq(initial);
    setIdx(0);
    setRunning(true);
    const xml = sequenceToMusicXML(initial, beatsPerBar, keyFifths);
    await osmdRef.current?.load(xml);
    await osmdRef.current?.render();
  };

  const stopPractice = async () => {
    setRunning(false);
    setSeq([]);
    setIdx(0);
    const xml = sequenceToMusicXML([], beatsPerBar, keyFifths);
    await osmdRef.current?.load(xml);
    await osmdRef.current?.render();
  };

  return (
    <div className="vstack">
      <h2>Tryb Praktyki</h2>

      <div className="card">
        <div className="hstack" style={{ gap: 16, flexWrap: "wrap" }}>
          <label className="hstack" style={{ gap: 8 }}>
            Tryb:
            <select value={mode} onChange={e => setMode(e.target.value as any)}>
              <option value="diatonic">Diatoniczny (wg tonacji)</option>
              <option value="chromatic">Chromatyczny (wszystkie półtony)</option>
            </select>
          </label>

          <label className="hstack" style={{ gap: 8 }}>
            Tonacja (dur):
            <select
              value={keyFifths}
              onChange={(e) => setKeyFifths(parseInt(e.target.value, 10))}
            >
              {MAJOR_OPTIONS.map(opt => (
                <option key={opt.label} value={opt.fifths}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="hstack" style={{ gap: 8 }}>
            Metrum:
            <select value={beatsPerBar} onChange={e => setBeatsPerBar(parseInt(e.target.value,10))}>
              <option value={4}>4/4</option>
              <option value={3}>3/4</option>
            </select>
          </label>

          <div style={{ marginLeft: "auto" }} className="hstack" >
            {!running ? (
              <button onClick={startPractice}>▶️ Start ćwiczenia</button>
            ) : (
              <button onClick={stopPractice}>⏹ Stop</button>
            )}
            <span className="badge">
              Aktualna: {seq[idx] ? prettyName(seq[idx].step, seq[idx].alter, seq[idx].octave) : "-"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="vstack">
          <Tuner />
          <Metronome />

          <div className="card">
            <h3>Sekwencja ćwiczeniowa (zakres skrzypiec, z ♯/♭)</h3>
            <div ref={containerRef} style={{ width: "100%", minHeight: 200 }} />
            <p style={{opacity:.8, fontSize:12}}>
              Kolory: <span style={{color:"#66AAFF"}}>bieżąca</span> • <span style={{color:"#00FF00"}}>poprawnie</span> • <span style={{color:"#FF0000"}}>błędnie</span>
            </p>
          </div>
        </div>

        <div className="vstack">
          <MicMonitor />
          <NoiseControls />
        </div>
      </div>
    </div>
  );
}
