import "./styles/reset.css";
import "./styles/main.css";
import AudioSourceSelector from "./components/AudioSourceSelector";
import Tuner from "./components/Tuner";
import ScoreView from "./components/ScoreView";
import AccompanimentControls from "./components/AccompanimentControls";

export default function App() {
  return (
    <div className="container vstack">
      <h1 style={{fontSize:28, marginBottom:4}}>🎻 Violin AI — tuner, nuty i akompaniament</h1>
      <span className="badge">alpha starter</span>
      <div className="grid">
        <div className="vstack">
          <AudioSourceSelector />
          <Tuner />
          <AccompanimentControls />
        </div>
        <div className="vstack">
          <ScoreView />
        </div>
      </div>
    </div>
  );
}
