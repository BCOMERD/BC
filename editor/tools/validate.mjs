// node tools/validate.mjs path/to/project.json
// Validates a project.json before opening it in the editor (useful for AI output).
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/validate.mjs <project.json>'); process.exit(2); }

const errors = [];
const err = (m) => errors.push(m);
let p;
try { p = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('Invalid JSON:', e.message); process.exit(1); }

if (p.version !== 1) err('version must be 1');
const m = p.meta || {};
for (const k of ['width', 'height', 'fps', 'duration']) if (!(m[k] > 0)) err(`meta.${k} is required (> 0)`);
const assets = p.assets || {};
const TYPES = { visual: ['image', 'video'], audio: ['audio', 'video'], text: [] };
for (const [id, a] of Object.entries(assets)) {
  if (!['image', 'video', 'audio'].includes(a.type)) err(`asset ${id}: invalid type`);
  if (!a.src) err(`asset ${id}: missing src`);
}
const ids = new Set();
for (const t of p.tracks || []) {
  if (!TYPES[t.type]) err(`track ${t.id}: invalid type (${t.type})`);
  for (const c of t.clips || []) {
    if (!c.id || ids.has(c.id)) err(`clip id missing or duplicated: ${c.id}`);
    ids.add(c.id);
    if (!(c.start >= 0)) err(`clip ${c.id}: invalid start`);
    if (!(c.duration > 0)) err(`clip ${c.id}: invalid duration`);
    if (t.type === 'text') { if (typeof c.text !== 'string') err(`clip ${c.id}: text is required`); }
    else {
      const a = assets[c.asset];
      if (!a) err(`clip ${c.id}: asset "${c.asset}" not found`);
      else if (!TYPES[t.type].includes(a.type)) err(`clip ${c.id}: asset type ${a.type} does not fit track type ${t.type}`);
    }
  }
  if (t.type !== 'visual') { // no overlaps on audio/text tracks
    const cs = [...(t.clips || [])].sort((a, b) => a.start - b.start);
    for (let i = 1; i < cs.length; i++) if (cs[i].start < cs[i - 1].start + cs[i - 1].duration - 1e-6) err(`track ${t.id}: overlap between ${cs[i - 1].id} and ${cs[i].id}`);
  }
}
if (errors.length) { console.error(errors.map((e) => '✗ ' + e).join('\n')); process.exit(1); }
console.log(`✓ ${file} valid (${(p.tracks || []).length} tracks, ${ids.size} clips)`);
