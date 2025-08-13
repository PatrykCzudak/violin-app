export type AudioDevice = { id: number; name: string };
export type PitchFrame = {
  t: number;
  pitch_hz: number;
  note: string;
  cents: number;
  onset: boolean;
  bpm: number;
};
export type UploadResponse = {
  filename: string; url: string; kind: "musicxml" | "midi";
  title: string; parts: number; measures: number;
};
