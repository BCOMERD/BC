// ReCut local server: serves the editor, stores projects on disk, talks to Claude and ElevenLabs.
// Run: npm start  → http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const { planVideo, planEdits, describeError, resetClient } = await import('./ai.js');
import os from 'node:os';
const { speak, listVoices, hasVoice } = await import('./voice.js');

const PORT = +(process.env.PORT || 5173);
const PROJECTS = path.resolve(ROOT, process.env.RECUT_PROJECTS || (process.platform === 'darwin' ? path.join(os.homedir(), 'Movies', 'ReCut') : 'projects'));
await fsp.mkdir(PROJECTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const STATIC = new Set(['index.html', 'app.js', 'style.css']);

/* ---------- helpers ---------- */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'project';
const safeName = (n) => (/^[a-z0-9][a-z0-9-_]{0,80}$/i.test(n) ? n : null);
const projDir = (n) => path.join(PROJECTS, n);
const inside = (base, p) => { const r = path.resolve(base, p); return r.startsWith(base + path.sep) ? r : null; };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
async function body(req, limit = 2e9) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('Upload too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readProject(name) { return JSON.parse(await fsp.readFile(path.join(projDir(name), 'project.json'), 'utf8')); }
async function writeProject(name, p) {
  await fsp.mkdir(path.join(projDir(name), 'assets'), { recursive: true });
  await fsp.writeFile(path.join(projDir(name), 'project.json'), JSON.stringify(p, null, 2));
}
async function uniqueName(base) {
  let n = slug(base), i = 2;
  while (fs.existsSync(projDir(n))) n = `${slug(base)}-${i++}`;
  return n;
}
function stream(res) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
  return (obj) => res.write(JSON.stringify(obj) + '\n');
}
const ASPECTS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] };

function slotSvg(w, h, n, prompt) {
  const words = prompt.split(/\s+/), lines = []; let line = '';
  const max = Math.round(w / 34);
  for (const wd of words) { if ((line + ' ' + wd).trim().length > max) { lines.push(line); line = wd; } else line = (line + ' ' + wd).trim(); }
  if (line) lines.push(line);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fs1 = Math.round(w / 22), fs2 = Math.round(w / 30), y0 = h * 0.38 + fs1 * 1.4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2030"/><stop offset="1" stop-color="#0d1017"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<rect x="${w * 0.06}" y="${h * 0.06}" width="${w * 0.88}" height="${h * 0.88}" fill="none" stroke="#3a4258" stroke-width="4" stroke-dasharray="18 14" rx="24"/>
<text x="${w / 2}" y="${h * 0.38}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fs1}" font-weight="700" fill="#7b88a8">FOOTAGE · SCENE ${n}</text>
${lines.map((l, i) => `<text x="${w / 2}" y="${y0 + i * fs2 * 1.35}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fs2}" fill="#c9d1e4">${esc(l)}</text>`).join('\n')}
<text x="${w / 2}" y="${Math.min(h * 0.68, y0 + lines.length * fs2 * 1.35 + fs2)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${Math.round(fs2 * 0.8)}" fill="#5f6b88">Select this clip → Replace media</text>
</svg>`;
}

/* ---------- generate a project from an idea ---------- */
async function generate(req, res) {
  const { brief, seconds = 60, aspect = '9:16', voiceId, language = 'English', name } = JSON.parse((await body(req, 1e6)).toString() || '{}');
  if (!brief?.trim()) return json(res, 400, { error: 'Write a brief first.' });
  const send = stream(res);
  try {
    send({ step: 'script', msg: 'Writing the script with Claude…' });
    const plan = await planVideo({ brief, seconds: Math.max(10, Math.min(900, +seconds || 60)), language });
    const pname = await uniqueName(name || plan.title);
    const dir = projDir(pname); await fsp.mkdir(path.join(dir, 'assets'), { recursive: true });
    const [W, H] = ASPECTS[aspect] || ASPECTS['9:16'];
    const voiced = hasVoice() && voiceId;
    send({ step: 'script', msg: `Script ready: ${plan.scenes.length} scenes.`, done: true });

    const p = { version: 1, meta: { title: plan.title, width: W, height: H, fps: 30, duration: 0, status: 'draft', voiceId: voiced ? voiceId : null, brief },
      assets: {}, tracks: [
        { id: 't-titles', type: 'text', name: 'Titles', clips: [] },
        { id: 't-subs', type: 'text', name: 'Subtitles', clips: [] },
        { id: 't-visual', type: 'visual', name: 'Video / Images', clips: [] },
        { id: 't-voice', type: 'audio', name: 'Voiceover', clips: [] },
        { id: 't-music', type: 'audio', name: 'Music', clips: [] },
      ] };
    const T = Object.fromEntries(p.tracks.map((t) => [t.id, t]));
    const subSize = Math.round(W * 0.045), titleSize = Math.round(W * 0.075), GAP = 0.25;
    let t = 0;
    for (const [i, s] of plan.scenes.entries()) {
      const n = i + 1;
      let dur = Math.max(1.2, s.voiceover.split(/\s+/).length / 2.5);
      if (voiced) {
        send({ step: 'voice', msg: `Recording voiceover ${n}/${plan.scenes.length}…` });
        const v = await speak(s.voiceover, voiceId);
        dur = Math.round(v.duration * 100) / 100;
        await fsp.writeFile(path.join(dir, 'assets', `vo${n}.mp3`), v.mp3);
        p.assets[`vo${n}`] = { type: 'audio', src: `assets/vo${n}.mp3`, name: `Voice ${n}`, source: 'ai', prompt: s.voiceover, script: s.voiceover, voiceId };
        T['t-voice'].clips.push({ id: `c-vo${n}`, asset: `vo${n}`, start: t, duration: dur, in: 0, volume: 1, source: 'ai' });
      }
      await fsp.writeFile(path.join(dir, 'assets', `slot${n}.svg`), slotSvg(W, H, n, s.visual));
      p.assets[`slot${n}`] = { type: 'image', src: `assets/slot${n}.svg`, name: `Scene ${n} footage`, source: 'ai', prompt: s.visual, placeholder: true };
      T['t-visual'].clips.push({ id: `c-v${n}`, asset: `slot${n}`, start: t, duration: dur + GAP, transform: { x: 0, y: 0, scale: 1 }, source: 'ai' });
      T['t-subs'].clips.push({ id: `c-sub${n}`, start: t, duration: dur, text: s.voiceover, style: { size: subSize, color: '#ffffff', y: 0.8, bg: 'rgba(0,0,0,.55)' }, source: 'ai' });
      if (s.onscreen.trim()) T['t-titles'].clips.push({ id: `c-title${n}`, start: t, duration: dur, text: s.onscreen, style: { size: titleSize, color: '#ffffff', y: 0.2, bg: '' }, source: 'ai' });
      t = Math.round((t + dur + GAP) * 100) / 100;
    }
    p.meta.duration = t;
    await writeProject(pname, p);
    send({ step: 'voice', msg: voiced ? 'Voiceover recorded.' : 'No voice selected or no ElevenLabs key: voiceover track left empty.', done: true });
    send({ done: true, name: pname });
  } catch (e) { send({ error: describeError(e) }); }
  res.end();
}

/* ---------- apply open comments with Claude ---------- */
function ripple(p, skipId, oldStart, oldEnd, delta) {
  if (!delta) return;
  for (const t of p.tracks) for (const c of t.clips) {
    if (c.id === skipId) continue;
    if (c.start >= oldEnd - 0.05) c.start = Math.round((c.start + delta) * 100) / 100;
    else if (c.start < oldEnd && c.start + c.duration >= oldEnd - 0.3 && c.start + c.duration > oldStart + 0.05) c.duration = Math.max(0.1, Math.round((c.duration + delta) * 100) / 100);
  }
  p.meta.duration = Math.max(0, (p.meta.duration || 0) + delta);
}
async function apply(req, res, name) {
  const send = stream(res);
  try {
    const p = await readProject(name);
    const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ t, c })));
    const open = all.filter(({ c }) => c.comment && !c.commentDone);
    if (!open.length) { send({ error: 'No open comments.' }); return res.end(); }
    send({ step: 'plan', msg: `Reading ${open.length} comment${open.length > 1 ? 's' : ''} with Claude…` });
    const edits = await planEdits({ project: p, comments: open.map(({ t, c }) => ({ clip: c.id, track: t.name, comment: c.comment })) });
    send({ step: 'plan', msg: `${edits.length} edit${edits.length === 1 ? '' : 's'} planned.`, done: true });
    const byId = new Map(all.map((x) => [x.c.id, x]));
    const log = [];
    for (const e of edits) {
      const x = byId.get(e.clip); if (!x) continue;
      const { t, c } = x;
      if (e.action === 'set_text' && t.type === 'text') c.text = e.text;
      else if (e.action === 'set_voiceover' && t.type === 'audio') {
        const old = p.assets[c.asset] || {}, voiceId = old.voiceId || p.meta.voiceId;
        if (!voiceId || !hasVoice()) { c.aiReply = 'Cannot re-record: no ElevenLabs key or voice for this project.'; log.push(c.aiReply); continue; }
        send({ step: 'voice', msg: `Re-recording “${e.text.slice(0, 40)}…”` });
        const v = await speak(e.text, voiceId);
        const id = `vo-${c.id}-${Date.now().toString(36)}`;
        await fsp.writeFile(path.join(projDir(name), 'assets', `${id}.mp3`), v.mp3);
        p.assets[id] = { ...old, src: `assets/${id}.mp3`, prompt: e.text, script: e.text, source: 'ai' };
        const oldStart = c.start, oldEnd = c.start + c.duration, nd = Math.round(v.duration * 100) / 100;
        c.asset = id; c.in = 0; c.duration = nd;
        ripple(p, c.id, oldStart, oldEnd, nd - (oldEnd - oldStart));
      } else if (e.action === 'set_volume' && e.volume >= 0) c.volume = Math.min(1, e.volume);
      else if (e.action === 'set_timing') { if (e.start >= 0) c.start = e.start; if (e.duration > 0) c.duration = e.duration; }
      else if (e.action === 'delete_clip') t.clips = t.clips.filter((y) => y !== c);
      if (e.action !== 'needs_human' && c.comment) c.commentDone = true;
      c.aiReply = e.reply; log.push(`${e.action}: ${e.reply}`);
    }
    await writeProject(name, p);
    send({ done: true, project: p, log });
  } catch (e) { send({ error: describeError(e) }); }
  res.end();
}

/* ---------- router ---------- */
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'api') {
      if (parts[1] === 'settings' && req.method === 'POST') {
        const s = JSON.parse((await body(req, 1e5)).toString() || '{}');
        const set = { ANTHROPIC_API_KEY: s.anthropicKey, ELEVENLABS_API_KEY: s.elevenlabsKey };
        const envFile = path.join(ROOT, '.env');
        let lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : [];
        for (const [k, v] of Object.entries(set)) {
          if (typeof v !== 'string' || !v.trim()) continue;          // empty = keep the current key
          process.env[k] = v.trim();
          const i = lines.findIndex((l) => l.startsWith(k + '='));
          if (i >= 0) lines[i] = `${k}=${v.trim()}`; else lines.push(`${k}=${v.trim()}`);
        }
        fs.writeFileSync(envFile, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n', { mode: 0o600 });
        resetClient();
        return json(res, 200, { ok: true, anthropic: !!process.env.ANTHROPIC_API_KEY, elevenlabs: hasVoice() });
      }
      if (parts[1] === 'status') return json(res, 200, { server: true, anthropic: !!process.env.ANTHROPIC_API_KEY, elevenlabs: hasVoice(), projectsDir: PROJECTS });
      if (parts[1] === 'voices') { try { return json(res, 200, await listVoices()); } catch (e) { return json(res, 200, { error: e.message }); } }
      if (parts[1] === 'generate' && req.method === 'POST') return generate(req, res);
      if (parts[1] === 'projects' && !parts[2]) {
        const out = [];
        for (const d of await fsp.readdir(PROJECTS, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          try { const f = path.join(PROJECTS, d.name, 'project.json'); const st = await fsp.stat(f); const p = JSON.parse(await fsp.readFile(f, 'utf8'));
            out.push({ name: d.name, title: p.meta?.title || d.name, status: p.meta?.status || 'draft', updated: st.mtimeMs, width: p.meta?.width, height: p.meta?.height, duration: p.meta?.duration }); } catch {}
        }
        return json(res, 200, out.sort((a, b) => b.updated - a.updated));
      }
      const name = safeName(parts[2] || ''); if (!name) return json(res, 400, { error: 'Bad project name' });
      if (parts[1] === 'projects' && parts.length === 3) {
        if (req.method === 'GET') return json(res, 200, await readProject(name));
        if (req.method === 'PUT') { const p = JSON.parse((await body(req, 50e6)).toString()); await writeProject(name, p); return json(res, 200, { ok: true }); }
      }
      if (parts[1] === 'projects' && parts[3] === 'assets' && req.method === 'POST') {
        const fname = `${Date.now().toString(36)}-${String(url.searchParams.get('filename') || 'file').replace(/[^\w.\-]+/g, '_').slice(-80)}`;
        await fsp.mkdir(path.join(projDir(name), 'assets'), { recursive: true });
        await fsp.writeFile(path.join(projDir(name), 'assets', fname), await body(req));
        return json(res, 200, { src: `assets/${fname}` });
      }
      if (parts[1] === 'projects' && parts[3] === 'apply' && req.method === 'POST') return apply(req, res, name);
      return json(res, 404, { error: 'Not found' });
    }
    // project files: /projects/<name>/<path>
    let file;
    if (parts[0] === 'projects' && safeName(parts[1] || '')) file = inside(projDir(parts[1]), parts.slice(2).join('/'));
    else if (parts[0] === 'sample') file = inside(path.join(ROOT, 'sample'), parts.slice(1).join('/'));
    else if (!parts.length || STATIC.has(parts[0])) file = path.join(ROOT, parts[0] || 'index.html');
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
    const st = fs.statSync(file), type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) { // needed for seeking in audio/video
      const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : st.size - 1;
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); else res.end(); }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ReCut is running →  http://localhost:${PORT}\n`);
  console.log(`  Projects folder:    ${PROJECTS}`);
  console.log(`  Claude:             ${process.env.ANTHROPIC_API_KEY ? 'ready' : 'missing ANTHROPIC_API_KEY in .env'}`);
  console.log(`  ElevenLabs voice:   ${hasVoice() ? 'ready' : 'missing ELEVENLABS_API_KEY in .env'}\n`);
});
