import "./styles/main.css"; // ⬅️ styles z folderu src/styles
import { useState } from "react";
import PracticeTab from "./components/PracticeTab";
import ScoreTab from "./components/ScoreTab";
import AudioSourceSelector from "./components/AudioSourceSelector";

export default function App() {
  const [mode, setMode] = useState<"practice" | "song">("practice");

  return (
    <div className="container vstack">
      <h1>🎻 Violin AI — tryb nauki gry na skrzypcach</h1>

      <div className="hstack" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
        <div className="tabs hstack">
          <button
            className={mode === "practice" ? "active" : ""}
            onClick={() => setMode("practice")}
          >
            Tryb Praktyki
          </button>
          <button
            className={mode === "song" ? "active" : ""}
            onClick={() => setMode("song")}
          >
            Tryb Utworu
          </button>
        </div>

        <div style={{ marginLeft: "auto" }}>
          <AudioSourceSelector />
        </div>
      </div>

      {mode === "practice" ? <PracticeTab /> : <ScoreTab />}
    </div>
  );
}
