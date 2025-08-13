import { useRef, useState } from "react";
import { makeMetronome, MEDIA_BASE } from "../api";

export default function AccompanimentControls() {
  const [tempo, setTempo] = useState(120);
  const [bars, setBars] = useState(8);
  const [beats, setBeats] = useState(4);
  const [url, setUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const generate = async () => {
    const res = await makeMetronome(tempo, bars, beats);
    setUrl(res.url);
  };

  return (
    <div className="card vstack">
      <h1>Akompaniament – metronom (WAV)</h1>
      <div className="hstack">
        <label>Tempo</label>
        <input type="number" value={tempo} onChange={e=>setTempo(+e.target.value)} style={{width:80}}/>
        <label>Takty</label>
        <input type="number" value={bars} onChange={e=>setBars(+e.target.value)} style={{width:80}}/>
        <label>Na takt</label>
        <input type="number" value={beats} onChange={e=>setBeats(+e.target.value)} style={{width:80}}/>
        <button onClick={generate}>Generuj</button>
        {url && <a className="badge" href={MEDIA_BASE + url.replace("/media","")} target="_blank">pobierz</a>}
      </div>
      <audio ref={audioRef} src={url ? (`http://localhost:8000${url}`) : undefined} controls />
    </div>
  );
}
