import { useEffect, useRef, useState } from "react";
import { uploadScore, MEDIA_BASE } from "../api";
import type { UploadResponse } from "../types";
import * as OSMD from "opensheetmusicdisplay";


export default function ScoreView() {
  const [info, setInfo] = useState<UploadResponse | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<any>(null); // prosto: any (brak typów dla UMD)

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const res = await uploadScore(f);
    setInfo(res);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    if (!osmdRef.current) {
      osmdRef.current = new (OSMD as any).OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true, drawTitle: true, followCursor: true,
        backend: 'svg',
      });
    }
    (async () => {
      if (info?.url && info.kind !== "midi") {
        await osmdRef.current.load(MEDIA_BASE + "/scores/" + info.filename);
        await osmdRef.current.render();
      }
    })();
  }, [info]);

  return (
    <div className="card vstack">
      <h1>Partytura (MusicXML)</h1>
      <input type="file" accept=".xml,.mxl,.musicxml,.mid,.midi" onChange={onUpload} />
      <div ref={containerRef} style={{ background:"#0e1733", border:"1px solid #223060", borderRadius:8, padding:8 }}/>
    </div>
  );
}
