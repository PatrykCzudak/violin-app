import { useEffect, useState } from "react";

export default function Tuner() {
  const [note, setNote] = useState<string>("--");
  const [cents, setCents] = useState<number>(0);

  useEffect(() => {
    // Listener nasłuchujący globalnego eventu z danymi audio (wysyłany w PracticeTab).
    const handlePitch = (e: any) => {
      const data = e.detail;
      if (data.note) {
        setNote(data.note);         // np. "A4"
        setCents(data.cents || 0);  // odstrojenie w centach
      } else {
        // Brak dźwięku - np. cisza
        setNote("--");
        setCents(0);
      }
    };
    document.addEventListener("pitchData", handlePitch);
    return () => {
      document.removeEventListener("pitchData", handlePitch);
    };
  }, []);

  // Tekstowa reprezentacja stroika (nazwa nuty i ewentualne strojenie)
  let tuningInfo = "";
  if (note && note !== "--") {
    if (Math.abs(cents) < 5) {
      tuningInfo = " (czysto)";
    } else if (cents > 0) {
      tuningInfo = ` (+${cents} cent powyżej)`;
    } else if (cents < 0) {
      tuningInfo = ` (${cents} cent poniżej)`;
    }
  }

  return (
    <div className="card tuner">
      <h3>Stroik</h3>
      <div>
        <span>Obecna nuta: <strong>{note}</strong></span>
        <span>{tuningInfo}</span>
      </div>
    </div>
  );
}
