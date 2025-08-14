const BASE = "http://localhost:8000";

export async function getDevices() {
  const res = await fetch(`${BASE}/api/audio/devices`);
  return res.json();
}

export async function startAudio(body: {
  device_id?: number; samplerate?: number; blocksize?: number; channels?: number;
}) {
  const res = await fetch(`${BASE}/api/audio/start`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function stopAudio() {
  const res = await fetch(`${BASE}/api/audio/stop`, { method: "POST" });
  return res.json();
}

export function wsUrlAnalyze() {
  return `ws://localhost:8000/api/audio/ws/analyze`;
}

export async function uploadScore(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch(`${BASE}/api/score/upload`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function makeMetronome(tempo: number, bars: number, beats: number) {
  const url = `${BASE}/api/accompaniment/metronome?tempo=${tempo}&bars=${bars}&beats_per_bar=${beats}`;
  const res = await fetch(url);
  return res.json();
}

export const MEDIA_BASE = `${BASE}/media`;
