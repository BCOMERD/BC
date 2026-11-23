// ElevenLabs text-to-speech. Uses the "with-timestamps" endpoint so we get the exact duration back.
const BASE = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io') + '/v1';
const key = () => process.env.ELEVENLABS_API_KEY;
export const hasVoice = () => !!key();

async function call(path, init = {}) {
  if (!key()) throw new Error('ElevenLabs API key is missing (set ELEVENLABS_API_KEY in .env).');
  const r = await fetch(BASE + path, { ...init, headers: { 'xi-api-key': key(), 'content-type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) {
    let msg = r.statusText; try { msg = JSON.stringify((await r.json()).detail || msg); } catch {}
    throw new Error(`ElevenLabs ${r.status}: ${msg}`);
  }
  return r.json();
}

export async function listVoices() {
  const j = await call('/voices');
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category, preview: v.preview_url, labels: v.labels || {} }));
}

/** Returns { mp3: Buffer, duration: seconds } */
export async function speak(text, voiceId, modelId = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2') {
  const j = await call(`/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', body: JSON.stringify({ text, model_id: modelId }),
  });
  const ends = j.alignment?.character_end_times_seconds || [];
  return { mp3: Buffer.from(j.audio_base64, 'base64'), duration: ends.length ? ends[ends.length - 1] : Math.max(1, text.split(/\s+/).length / 2.5) };
}
