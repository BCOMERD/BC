// node tools/validate.mjs path/to/project.json
// يتحقق من صحة ملف المشروع قبل فتحه في المحرر (مفيد لمخرجات كلود).
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/validate.mjs <project.json>'); process.exit(2); }

const errors = [];
const err = (m) => errors.push(m);
let p;
try { p = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('JSON غير صالح:', e.message); process.exit(1); }

if (p.version !== 1) err('version يجب أن يكون 1');
const m = p.meta || {};
for (const k of ['width', 'height', 'fps', 'duration']) if (!(m[k] > 0)) err(`meta.${k} مطلوب (>0)`);
const assets = p.assets || {};
const TYPES = { visual: ['image', 'video'], audio: ['audio', 'video'], text: [] };
for (const [id, a] of Object.entries(assets)) {
  if (!['image', 'video', 'audio'].includes(a.type)) err(`asset ${id}: type غير صالح`);
  if (!a.src) err(`asset ${id}: src مفقود`);
}
const ids = new Set();
for (const t of p.tracks || []) {
  if (!TYPES[t.type]) err(`track ${t.id}: type غير صالح (${t.type})`);
  for (const c of t.clips || []) {
    if (!c.id || ids.has(c.id)) err(`clip id مفقود أو مكرر: ${c.id}`);
    ids.add(c.id);
    if (!(c.start >= 0)) err(`clip ${c.id}: start غير صالح`);
    if (!(c.duration > 0)) err(`clip ${c.id}: duration غير صالح`);
    if (t.type === 'text') { if (typeof c.text !== 'string') err(`clip ${c.id}: text مطلوب`); }
    else {
      const a = assets[c.asset];
      if (!a) err(`clip ${c.id}: asset "${c.asset}" غير موجود`);
      else if (!TYPES[t.type].includes(a.type)) err(`clip ${c.id}: نوع الأصل ${a.type} لا يناسب مسار ${t.type}`);
    }
  }
  if (t.type !== 'visual') { // لا تداخل على مسارات الصوت/النص
    const cs = [...(t.clips || [])].sort((a, b) => a.start - b.start);
    for (let i = 1; i < cs.length; i++) if (cs[i].start < cs[i - 1].start + cs[i - 1].duration - 1e-6) err(`track ${t.id}: تداخل بين ${cs[i - 1].id} و ${cs[i].id}`);
  }
}
if (errors.length) { console.error(errors.map((e) => '✗ ' + e).join('\n')); process.exit(1); }
console.log(`✓ ${file} صالح (${(p.tracks || []).length} مسارات، ${ids.size} مقطع)`);
