// يولّد أصول العيّنة: 3 صور SVG + صوت تجريبي (placeholder). بدون اعتماديات.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample', 'assets');

const scenes = [
  ['scene1.svg', '#0f2027', '#2c5364', '#f9d423', 'sun'],
  ['scene2.svg', '#42275a', '#734b6d', '#00e5ff', 'wave'],
  ['scene3.svg', '#134e5e', '#71b280', '#ffffff', 'peak'],
];
for (const [name, c1, c2, accent, kind] of scenes) {
  const shape =
    kind === 'sun' ? `<circle cx="640" cy="330" r="130" fill="${accent}" opacity=".9"/>` :
    kind === 'wave' ? `<path d="M0 420 Q160 330 320 420 T640 420 T960 420 T1280 420 V720 H0Z" fill="${accent}" opacity=".35"/><path d="M0 500 Q160 410 320 500 T640 500 T960 500 T1280 500 V720 H0Z" fill="${accent}" opacity=".6"/>` :
    `<path d="M0 720 L380 260 L560 480 L780 200 L1280 720Z" fill="${accent}" opacity=".85"/>`;
  writeFileSync(join(out, name),
`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/>${shape}</svg>`);
}

const SR = 11025;
function wav(name, seconds, fn) {
  const n = Math.floor(SR * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, fn(i / SR, seconds)));
    buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  writeFileSync(join(out, name), buf);
}
// "تعليق صوتي" تجريبي: نبضات تشبه إيقاع الكلام (استبدله بـ TTS حقيقي)
const voice = (base) => (t, d) => {
  const syll = Math.abs(Math.sin(t * 9.3)) * (0.5 + 0.5 * Math.sin(t * 2.1));
  const env = Math.min(1, t * 8, (d - t) * 8);
  return 0.35 * env * syll * (Math.sin(2 * Math.PI * base * t) + 0.4 * Math.sin(2 * Math.PI * base * 2.01 * t));
};
wav('voice1.wav', 4, voice(130));
wav('voice2.wav', 4, voice(150));
wav('voice3.wav', 4, voice(120));
// موسيقى خلفية تجريبية: أربيجيو بسيط
const notes = [220, 277.18, 329.63, 277.18];
wav('music.wav', 12, (t, d) => {
  const f = notes[Math.floor(t * 2) % 4];
  const local = (t * 2) % 1;
  const env = Math.exp(-local * 3) * Math.min(1, t * 2, (d - t) * 2);
  return 0.3 * env * Math.sin(2 * Math.PI * f * t);
});
console.log('done');
