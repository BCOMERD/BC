'use strict';
/* ReCut — editor for AI-generated, multi-track video projects.
   A project is project.json (tracks → clips → assets). No build step, no dependencies. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const HEAD_W = 96;
let lib = 'media';                   // left panel tab
const COLORS = { visual: 'var(--visual)', audio: 'var(--audio)', text: 'var(--text)' };
const ICONS = { visual: 'video', audio: 'music', text: 'type', image: 'image', video: 'video' };

/* ---------- state ---------- */
let project = null;
let baseUrl = '';
let dirHandle = null;               // project folder (File System Access API)
const urlOverrides = new Map();     // relative src -> blob URL (folder projects)
const fileStore = new Map();        // assetId -> File (assets added in this session)
let pps = 70, time = 0, playing = false, lastTs = 0;
let sel = null;                     // {track, clip}
let tx = false;                     // inspector edit transaction open
let dirty = false;
let commentFilter = 'open';
let past = [], future = [];
let audioCtx = null, recDest = null, exporting = false;
let server = false, currentName = null; // server mode: projects live on the local ReCut server
const mediaEls = new Map();
const imgCache = new Map();
const peakCache = new Map();
const routed = new WeakSet();
const canvas = $('#canvas'), ctx = canvas.getContext('2d');

/* ---------- helpers ---------- */
const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8);
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const round1 = (v) => Math.round(v * 10) / 10;
const ico = (n, cls = 'i') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const resolve = (src) => urlOverrides.get(src) || (/^(data:|blob:|https?:|\/)/.test(src) ? src : baseUrl + src);
const assetOf = (c) => project.assets[c.asset];
const duration = () => Math.max(project.meta.duration || 0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)), 1);
const allClips = () => project.tracks.flatMap((t) => t.clips.map((c) => ({ t, c })));
const findClip = (id) => allClips().find((x) => x.c.id === id) || null;
const selected = () => (sel ? findClip(sel.clip) : null);
const clipName = (t, c) => (t.type === 'text' ? c.text.split('\n')[0] : (assetOf(c)?.name || c.asset));
const openComments = () => allClips().filter(({ c }) => c.comment && !c.commentDone);

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 5000 : 2600);
}
function showModal(title, msg, text) {
  $('#modal-title').textContent = title; $('#modal-msg').textContent = msg; $('#modal-text').value = text;
  $('#modal').hidden = false; $('#modal-text').select();
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/* ---------- history (undo / redo) ---------- */
const snap = () => JSON.stringify({ meta: project.meta, tracks: project.tracks });
function checkpoint() { past.push(snap()); if (past.length > 100) past.shift(); future = []; dirty = true; syncHistoryUI(); }
function restore(s) {
  const o = JSON.parse(s); project.meta = o.meta; project.tracks = o.tracks;
  canvas.width = project.meta.width; canvas.height = project.meta.height;
  if (sel && !findClip(sel.clip)) sel = null;
  dirty = true; renderAll(); syncHistoryUI();
}
function undo() { if (!past.length) return; future.push(snap()); restore(past.pop()); }
function redo() { if (!future.length) return; past.push(snap()); restore(future.pop()); }
function syncHistoryUI() { $('#btn-undo').disabled = !past.length; $('#btn-redo').disabled = !future.length; }

/* ---------- loading ---------- */
function setProject(p, base = '') {
  stop();
  mediaEls.forEach((el) => { el.pause(); el.removeAttribute('src'); el.load?.(); });
  mediaEls.clear(); peakCache.clear();
  project = p; baseUrl = base;
  project.meta = Object.assign({ status: 'draft', fps: 30 }, project.meta);
  canvas.width = project.meta.width || 1280; canvas.height = project.meta.height || 720;
  time = 0; sel = null; past = []; future = []; dirty = false; tx = false;
  $('#empty-state').hidden = true;
  renderAll(); syncHistoryUI(); fitTimeline();
}
async function loadSample() {
  currentName = null; dirHandle = null; urlOverrides.clear(); fileStore.clear();
  const r = await fetch('sample/project.json'); setProject(await r.json(), 'sample/');
}
function newProject() {
  currentName = null; dirHandle = null; urlOverrides.clear(); fileStore.clear();
  setProject({ version: 1, meta: { title: 'Untitled project', width: 1920, height: 1080, fps: 30, duration: 0, status: 'draft' }, assets: {}, tracks: [] });
}
async function openFolder() {
  if (!window.showDirectoryPicker) return toast('Folder access needs Chrome, Edge or another Chromium browser. Use “Project file…” instead.', true);
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
  let file;
  try { file = await (await dir.getFileHandle('project.json')).getFile(); } catch { return toast('No project.json found in that folder.', true); }
  let p; try { p = JSON.parse(await file.text()); } catch { return toast('project.json is not valid JSON.', true); }
  urlOverrides.clear(); fileStore.clear();
  const missing = [];
  for (const a of Object.values(p.assets || {})) {
    if (/^(data:|blob:|https?:)/.test(a.src)) continue;
    try {
      let h = dir; const parts = a.src.split('/').filter(Boolean);
      for (const d of parts.slice(0, -1)) h = await h.getDirectoryHandle(d);
      const f = await (await h.getFileHandle(parts.at(-1))).getFile();
      urlOverrides.set(a.src, URL.createObjectURL(f));
    } catch { missing.push(a.src); }
  }
  dirHandle = dir; setProject(p, '');
  toast(missing.length ? `Opened. Missing files: ${missing.join(', ')}` : `Opened “${p.meta?.title || dir.name}”`, !!missing.length);
}

/* ---------- saving ---------- */
const safeName = (s) => String(s).replace(/[^\w.\-]+/g, '_').slice(0, 60);
async function save(quiet = false) {
  if (server && currentName) {
    try {
      for (const [id, f] of [...fileStore]) {           // upload media added in this session
        const r = await fetch(`/api/projects/${currentName}/assets?filename=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        const { src, error } = await r.json(); if (error) throw new Error(error);
        urlOverrides.set(src, project.assets[id].src); project.assets[id].src = src; fileStore.delete(id);
      }
      const r = await fetch(`/api/projects/${currentName}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      dirty = false; if (!quiet) toast('Saved'); return true;
    } catch (e) { toast('Save failed: ' + e.message, true); return false; }
  }
  const out = JSON.parse(JSON.stringify(project));
  if (dirHandle) {
    try {
      const adir = await dirHandle.getDirectoryHandle('assets', { create: true });
      for (const [id, a] of Object.entries(out.assets)) {
        const f = fileStore.get(id);
        if (!f || !a.src.startsWith('blob:')) continue;
        const fname = `${id}-${safeName(a.name || f.name)}`;
        const w = await (await adir.getFileHandle(fname, { create: true })).createWritable(); await w.write(f); await w.close();
        const rel = 'assets/' + fname;
        urlOverrides.set(rel, project.assets[id].src); project.assets[id].src = rel; out.assets[id].src = rel; fileStore.delete(id);
      }
      const w = await (await dirHandle.getFileHandle('project.json', { create: true })).createWritable();
      await w.write(JSON.stringify(out, null, 2)); await w.close();
      dirty = false; return toast('Saved to project folder');
    } catch (e) { toast('Could not write to the folder: ' + e.message, true); }
  }
  let big = 0;
  for (const [id, a] of Object.entries(out.assets)) {
    const f = fileStore.get(id); if (!f || !a.src.startsWith('blob:')) continue;
    big += f.size;
    a.src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
  }
  downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), 'project.json');
  dirty = false; toast(big > 25e6 ? 'Saved — large media is embedded. Prefer “Open → Project folder” for big projects.' : 'Project downloaded');
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------- preview drawing ---------- */
function getImg(src) {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.onload = () => drawFrame(); im.src = resolve(src); imgCache.set(src, im); }
  return im;
}
function mediaEl(clip) {
  let el = mediaEls.get(clip.id);
  if (!el) {
    const a = assetOf(clip);
    el = document.createElement(a.type === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.playsInline = true; el.src = resolve(a.src);
    mediaEls.set(clip.id, el);
  }
  return el;
}
function drawFrame() {
  if (!project) return;
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  for (const tr of [...project.tracks].reverse()) {      // top track = on top
    if (tr.hidden) continue;
    for (const c of tr.clips) {
      if (time < c.start || time >= c.start + c.duration) continue;
      if (tr.type === 'visual') drawVisual(c, W, H); else if (tr.type === 'text') drawText(c, W, H);
    }
  }
  $('#tc-now').textContent = fmt(time); $('#tc-total').textContent = fmt(duration());
  $('#playhead').style.left = HEAD_W + time * pps + 'px';
}
function drawVisual(c, W, H) {
  const a = assetOf(c); if (!a) return;
  let src, sw, sh;
  if (a.type === 'image') { src = getImg(a.src); sw = src.naturalWidth; sh = src.naturalHeight; }
  else { src = mediaEl(c); sw = src.videoWidth; sh = src.videoHeight; }
  if (!sw || !sh) return;
  const tf = c.transform || { x: 0, y: 0, scale: 1 };
  const k = Math.max(W / sw, H / sh) * (tf.scale || 1), dw = sw * k, dh = sh * k;
  ctx.drawImage(src, W / 2 - dw / 2 + (tf.x || 0) * W, H / 2 - dh / 2 + (tf.y || 0) * H, dw, dh);
}
function drawText(c, W, H) {
  const s = c.style || {}, size = s.size || 48, text = String(c.text || '');
  ctx.font = `700 ${size}px Inter, system-ui, "Segoe UI", Tahoma, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.direction = /[֐-ࣿ]/.test(text) ? 'rtl' : 'ltr';
  const maxW = W * 0.86, lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
  }
  const lh = size * 1.3, y0 = (s.y ?? 0.5) * H - ((lines.length - 1) * lh) / 2;
  if (s.bg) {
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size, bh = lines.length * lh + size * 0.4;
    ctx.fillStyle = s.bg; ctx.fillRect(W / 2 - bw / 2, y0 - lh / 2 - size * 0.2, bw, bh);
  }
  ctx.fillStyle = s.color || '#fff';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
}

/* ---------- playback ---------- */
function syncMedia() {
  for (const tr of project.tracks) {
    if (tr.type === 'text') continue;
    for (const c of tr.clips) {
      const a = assetOf(c); if (!a || a.type === 'image') continue;
      const el = mediaEl(c);
      const inside = playing && time >= c.start && time < c.start + c.duration && !tr.hidden;
      el.volume = Math.min(1, Math.max(0, c.volume ?? 1));
      el.muted = !!tr.muted || !!tr.hidden;
      if (inside) {
        const want = (c.in || 0) + (time - c.start);
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) el.pause();
    }
  }
}
function seekVideos() {
  for (const { t, c } of allClips()) {
    const a = assetOf(c);
    if (t.type === 'visual' && a?.type === 'video' && time >= c.start && time < c.start + c.duration) mediaEl(c).currentTime = (c.in || 0) + (time - c.start);
  }
}
function tick(ts) {
  if (!playing) return;
  time += (ts - lastTs) / 1000; lastTs = ts;
  if (time >= duration()) { time = duration(); stop(); drawFrame(); return; }
  syncMedia(); drawFrame(); followPlayhead();
  requestAnimationFrame(tick);
}
function play() {
  if (!project) return;
  if (time >= duration() - 0.05) time = 0;
  ensureAudioGraph(); playing = true; lastTs = performance.now();
  $('#btn-play').innerHTML = ico('pause'); requestAnimationFrame(tick);
}
function stop() { playing = false; $('#btn-play').innerHTML = ico('play'); mediaEls.forEach((el) => el.pause()); }
function seek(t) { time = Math.max(0, Math.min(duration(), t)); if (!playing) seekVideos(); drawFrame(); }
function followPlayhead() {
  const sc = $('#tl-scroll'), x = HEAD_W + time * pps;
  if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - HEAD_W - 40;
}

/* ---------- export ---------- */
function ensureAudioGraph() {
  if (!audioCtx) { audioCtx = new AudioContext(); recDest = audioCtx.createMediaStreamDestination(); }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  for (const { c } of allClips()) {
    const a = assetOf(c); if (!a || a.type === 'image') continue;
    const el = mediaEl(c); if (routed.has(el)) continue; routed.add(el);
    try { const s = audioCtx.createMediaElementSource(el); s.connect(audioCtx.destination); s.connect(recDest); } catch { /* ignore */ }
  }
}
async function exportVideo() {
  if (exporting) return;
  if (typeof MediaRecorder === 'undefined') return toast('This browser cannot record video.', true);
  exporting = true; stop(); seek(0); ensureAudioGraph();
  const stream = canvas.captureStream(project.meta.fps || 30);
  recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  const btn = $('#btn-export'); btn.disabled = true;
  rec.start(); play();
  await new Promise((res) => { const iv = setInterval(() => {
    btn.lastChild.textContent = `Exporting ${Math.round((time / duration()) * 100)}%`;
    if (!playing) { clearInterval(iv); res(); } }, 150); });
  rec.stop(); await done;
  btn.disabled = false; btn.lastChild.textContent = 'Export'; exporting = false;
  downloadBlob(new Blob(chunks, { type: mime.split(';')[0] }), safeName(project.meta.title || 'video') + '.' + ext);
  toast(`Video exported (${ext.toUpperCase()})`);
}

/* ---------- waveform ---------- */
function getPeaks(src) {
  if (!peakCache.has(src)) {
    peakCache.set(src, null);
    (async () => {
      try {
        const buf = await (await fetch(resolve(src))).arrayBuffer();
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const ab = await ac.decodeAudioData(buf); ac.close?.();
        const d = ab.getChannelData(0), per = 20, n = Math.ceil(ab.duration * per), step = Math.floor(d.length / n) || 1, peaks = [];
        for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(d[j])); peaks.push(m); }
        peakCache.set(src, { peaks, per }); renderTimeline();
      } catch { peakCache.set(src, { peaks: [], per: 20 }); }
    })();
  }
  return peakCache.get(src);
}
function drawWave(cv, clip, a) {
  const p = getPeaks(a.src); if (!p || !p.peaks.length) return;
  const w = cv.width = Math.max(8, Math.floor(clip.duration * pps)), h = cv.height = 44, g = cv.getContext('2d');
  g.fillStyle = '#fff';
  for (let x = 0; x < w; x += 2) {
    const t = (clip.in || 0) + x / pps, v = p.peaks[Math.floor(t * p.per)] || 0, bh = Math.max(1, v * h * 0.9);
    g.fillRect(x, (h - bh) / 2, 1.2, bh);
  }
}

/* ---------- timeline ---------- */
function fitTimeline() { const w = $('#tl-scroll').clientWidth - HEAD_W - 30; pps = Math.max(20, Math.min(240, w / duration())); $('#zoom').value = pps; renderTimeline(); drawFrame(); }
function renderRuler() {
  const d = duration(), r = $('#ruler'); r.innerHTML = '';
  const step = pps >= 140 ? 1 : pps >= 70 ? 2 : pps >= 35 ? 5 : 10;
  for (let t = 0; t <= d + 2; t += step) { const e = document.createElement('div'); e.className = 'tick'; e.style.left = t * pps + 'px'; e.textContent = fmt(t); r.appendChild(e); }
  $('#tl-inner').style.width = HEAD_W + (d + 3) * pps + 'px';
}
function renderTimeline() {
  if (!project) return;
  renderRuler();
  const root = $('#tracks'); root.innerHTML = '';
  const width = (duration() + 3) * pps;
  const visible = project.tracks.filter((t) => t.clips.length);
  if (!visible.length) root.innerHTML = '<div class="tl-empty"><div><b>Your timeline is empty</b>Drag photos, videos or music here, or use Import on the left.</div></div>';
  for (const tr of visible) {
    const row = document.createElement('div'); row.className = 'track' + (tr.hidden ? ' hidden' : '') + (tr.muted ? ' muted' : '');
    const head = document.createElement('div'); head.className = 'thead';
    head.innerHTML = `<span class="ic" style="background:${COLORS[tr.type]}" title="${esc(tr.name)}">${ico(ICONS[tr.type])}</span>`;
    const tg = document.createElement('button');
    if (tr.type === 'audio') { tg.className = tr.muted ? 'off' : ''; tg.title = tr.muted ? 'Unmute track' : 'Mute track'; tg.innerHTML = ico(tr.muted ? 'volume-off' : 'volume'); tg.onclick = () => { checkpoint(); tr.muted = !tr.muted; renderTimeline(); }; }
    else { tg.className = tr.hidden ? 'off' : ''; tg.title = tr.hidden ? 'Show track' : 'Hide track'; tg.innerHTML = ico(tr.hidden ? 'eye-off' : 'eye'); tg.onclick = () => { checkpoint(); tr.hidden = !tr.hidden; renderTimeline(); drawFrame(); }; }
    head.appendChild(tg);
    const lane = document.createElement('div'); lane.className = 'lane'; lane.style.width = width + 'px';
    lane.onmousedown = (e) => { if (e.target === lane) { seek(e.offsetX / pps); sel = null; $$('.clip.sel').forEach((x) => x.classList.remove('sel')); renderInspector(); renderComments(); } };
    for (const c of tr.clips) lane.appendChild(clipEl(tr, c));
    row.append(head, lane); root.appendChild(row);
  }
  $('#playhead').style.left = HEAD_W + time * pps + 'px';
}
function clipEl(tr, c) {
  const el = document.createElement('div'), a = assetOf(c);
  el.className = `clip ${tr.type}` + (sel?.clip === c.id ? ' sel' : '') + (c.comment ? ' hascomment' : '') + (c.commentDone ? ' resolved' : '');
  el.style.left = c.start * pps + 'px'; el.style.width = Math.max(10, c.duration * pps) + 'px';
  if (tr.type === 'visual' && a?.type === 'image') el.style.backgroundImage = `url("${resolve(a.src)}")`;
  if (tr.type === 'audio' && a) { const cv = document.createElement('canvas'); cv.className = 'wave'; el.appendChild(cv); drawWave(cv, c, a); }
  const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = clipName(tr, c); el.appendChild(lbl);
  const hl = Object.assign(document.createElement('div'), { className: 'h l' }), hr = Object.assign(document.createElement('div'), { className: 'h r' });
  el.append(hl, hr);
  el.onmousedown = (e) => {
    e.stopPropagation(); if (e.button !== 0) return;
    select(tr.id, c.id);
    const mode = e.target === hl ? 'l' : e.target === hr ? 'r' : 'm';
    const x0 = e.clientX, s0 = c.start, d0 = c.duration, in0 = c.in || 0;
    const points = [time, ...allClips().filter((x) => x.c !== c).flatMap((x) => [x.c.start, x.c.start + x.c.duration])];
    const snapT = (t) => { const r = round1(t); const near = points.find((p) => Math.abs(p - t) * pps < 7); return Math.max(0, near ?? r); };
    let moved = false;
    const move = (ev) => {
      if (!moved) { if (Math.abs(ev.clientX - x0) < 3) return; moved = true; checkpoint(); }
      const dt = (ev.clientX - x0) / pps;
      if (mode === 'm') {
        const a1 = snapT(s0 + dt), a2 = snapT(s0 + dt + d0) - d0;
        c.start = Math.max(0, Math.abs(a1 - (s0 + dt)) <= Math.abs(a2 - (s0 + dt)) ? a1 : a2);
      } else if (mode === 'r') c.duration = Math.max(0.1, snapT(s0 + d0 + dt) - s0);
      else { const ns = Math.min(snapT(s0 + dt), s0 + d0 - 0.1); c.duration = d0 - (ns - s0); c.start = ns; if (c.in !== undefined) c.in = Math.max(0, in0 + (ns - s0)); }
      el.style.left = c.start * pps + 'px'; el.style.width = Math.max(10, c.duration * pps) + 'px'; drawFrame();
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (moved) { renderAll(); } };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };
  return el;
}
function select(trackId, clipId) { sel = { track: trackId, clip: clipId }; tx = false; $$('.clip').forEach((x) => x.classList.remove('sel')); renderTimeline(); renderInspector(); renderComments(); }

/* ---------- media library ---------- */
function renderMedia() {
  const box = $('#media-list'); box.innerHTML = '';
  $$('.rb').forEach((b) => b.classList.toggle('on', b.dataset.lib === lib));
  const used = new Set(allClips().map(({ c }) => c.asset));
  const del = (id) => (e) => {
    e.stopPropagation();
    if (used.has(id)) return toast('This file is on the timeline. Delete its clips first.', true);
    delete project.assets[id]; fileStore.delete(id); renderMedia();
  };
  if (lib === 'text') {
    box.innerHTML = '<div class="libhead">Add text</div>';
    const presets = [['plain', 'Default text', 'font-size:18px'], ['title', 'Title', 'font-size:26px;font-weight:800'], ['subtitle', 'Subtitle', 'font-size:15px;background:rgba(0,0,0,.6);padding:2px 8px;color:#ffe27a']];
    for (const [k, label, st] of presets) {
      const b = document.createElement('button'); b.className = 'tpreset'; b.innerHTML = `<span style="${st}">${label}</span>`;
      b.onclick = () => addText(k); box.appendChild(b);
    }
    return;
  }
  const isAudio = lib === 'audio';
  const imp = document.createElement('button'); imp.className = 'import';
  imp.innerHTML = `${ico('upload')}Import ${isAudio ? 'audio' : 'media'}<small>${isAudio ? 'Music, voiceover, sound effects' : 'Videos and photos'} · or drop files anywhere</small>`;
  imp.onclick = () => pickFiles(isAudio ? 'audio' : '', true, (files) => importFiles(files)); box.appendChild(imp);
  const entries = Object.entries(project.assets).filter(([, x]) => (isAudio ? x.type === 'audio' : x.type !== 'audio'));
  for (const [id, x] of entries) {
    if (isAudio) {
      const row = document.createElement('div'); row.className = 'arow'; row.title = 'Add at playhead';
      row.innerHTML = `${ico('music')}<span class="nm">${esc(x.name || id)}</span><button class="ib del2" title="Remove from library">${ico('trash')}</button>`;
      row.onclick = () => addAssetToTimeline(id); $('.del2', row).onclick = del(id); box.appendChild(row);
    } else {
      const card = document.createElement('div'); card.className = 'card'; card.title = 'Add at playhead';
      const th = x.type === 'image' ? `style="background-image:url('${resolve(x.src)}')"` : '';
      card.innerHTML = `<div class="thumb" ${th}>${x.type === 'image' ? '' : ico('video')}</div><div class="meta"><span class="nm">${esc(x.name || id)}</span></div>
        <button class="add" title="Add at playhead">${ico('plus')}</button><button class="del" title="Remove from library">${ico('trash')}</button>`;
      card.onclick = () => addAssetToTimeline(id); $('.del', card).onclick = del(id); box.appendChild(card);
    }
  }
}

/* ---------- inspector ---------- */
function renderInspector() {
  const box = $('#tab-props'); box.innerHTML = '';
  $('#btn-add-comment').disabled = !sel;
  $('#btn-split').disabled = $('#btn-del').disabled = $('#btn-dup').disabled = !sel;
  const f = selected();
  if (!f) {
    box.innerHTML = `<div class="empty">Select a clip on the timeline to edit it.</div>`;
    return;
  }
  const { t: tr, c } = f, a = assetOf(c);
  const sec = (title, html) => { const d = document.createElement('div'); d.className = 'sec'; d.innerHTML = (title ? `<h4>${title}</h4>` : '') + html; box.appendChild(d); return d; };
  const bind = (root, q, fn) => { const e = $(q, root); if (!e) return; e.addEventListener('input', () => { if (!tx) { checkpoint(); tx = true; } fn(e); refresh(); }); e.addEventListener('change', () => (tx = false)); };

  sec('', `<div class="sel-head"><span class="dotbox" style="background:${COLORS[tr.type]}">${ico(ICONS[tr.type])}</span>
    <div class="t"><b>${esc(clipName(tr, c))}</b><span class="muted">${tr.name} · ${c.source === 'user' ? 'added by you' : 'generated by AI'}</span></div></div>`);

  if (tr.type === 'text') {
    const s = (c.style = c.style || {});
    const d = sec('Text', `<textarea data-k="text" rows="3"></textarea>
      <div class="row"><label class="field"><span>Size</span><input type="number" data-k="size" min="10" max="300"></label>
      <label class="field"><span>Color</span><input type="color" data-k="color"></label></div>
      <label class="field"><span class="val">Vertical position</span><input type="range" data-k="y" min="0" max="1" step="0.01"></label>
      <label class="field"><span>Background (CSS color, empty = none)</span><input data-k="bg" placeholder="rgba(0,0,0,.55)"></label>`);
    $('[data-k=text]', d).value = c.text; $('[data-k=size]', d).value = s.size || 48; $('[data-k=color]', d).value = /^#/.test(s.color || '') ? s.color : '#ffffff';
    $('[data-k=y]', d).value = s.y ?? 0.5; $('[data-k=bg]', d).value = s.bg || '';
    bind(d, '[data-k=text]', (e) => (c.text = e.value)); bind(d, '[data-k=size]', (e) => (s.size = +e.value));
    bind(d, '[data-k=color]', (e) => (s.color = e.value)); bind(d, '[data-k=y]', (e) => (s.y = +e.value)); bind(d, '[data-k=bg]', (e) => (s.bg = e.value));
  }

  const tm = sec('Timing', `<div class="row"><label class="field"><span>Start (s)</span><input type="number" step="0.1" min="0" data-k="s"></label>
    <label class="field"><span>Duration (s)</span><input type="number" step="0.1" min="0.1" data-k="d"></label></div>`);
  $('[data-k=s]', tm).value = c.start; $('[data-k=d]', tm).value = c.duration;
  bind(tm, '[data-k=s]', (e) => (c.start = Math.max(0, +e.value))); bind(tm, '[data-k=d]', (e) => (c.duration = Math.max(0.1, +e.value)));

  if (tr.type === 'audio' || a?.type === 'video') {
    const v = sec('Audio', `<label class="field"><span class="val">Volume <b data-o>${Math.round((c.volume ?? 1) * 100)}%</b></span><input type="range" min="0" max="1" step="0.01" data-k="v"></label>`);
    $('[data-k=v]', v).value = c.volume ?? 1;
    bind(v, '[data-k=v]', (e) => { c.volume = +e.value; $('[data-o]', v).textContent = Math.round(c.volume * 100) + '%'; });
  }
  if (tr.type === 'visual') {
    const tf = (c.transform = c.transform || { x: 0, y: 0, scale: 1 });
    const v = sec('Transform', `<label class="field"><span class="val">Zoom</span><input type="range" min="1" max="3" step="0.01" data-k="sc"></label>
      <div class="row"><label class="field"><span>Shift X</span><input type="range" min="-0.5" max="0.5" step="0.01" data-k="x"></label>
      <label class="field"><span>Shift Y</span><input type="range" min="-0.5" max="0.5" step="0.01" data-k="y"></label></div>`);
    $('[data-k=sc]', v).value = tf.scale; $('[data-k=x]', v).value = tf.x; $('[data-k=y]', v).value = tf.y;
    bind(v, '[data-k=sc]', (e) => (tf.scale = +e.value)); bind(v, '[data-k=x]', (e) => (tf.x = +e.value)); bind(v, '[data-k=y]', (e) => (tf.y = +e.value));
  }

  const cm = sec('Comment', `<textarea data-k="cm" rows="3" placeholder="What should change here? e.g. “Remove the country name”"></textarea>
    <label class="check"><input type="checkbox" data-k="done"> Resolved</label>${c.aiReply ? `<div class="reply">AI: ${esc(c.aiReply)}</div>` : ''}`);
  $('[data-k=cm]', cm).value = c.comment || ''; $('[data-k=done]', cm).checked = !!c.commentDone;
  bind(cm, '[data-k=cm]', (e) => (c.comment = e.value));
  $('[data-k=done]', cm).onchange = (e) => { checkpoint(); c.commentDone = e.target.checked; refresh(); };

  const ac = sec('', '<div class="btnrow"></div>').firstChild;
  const mk = (icon, label, fn, cls = '') => { const b = document.createElement('button'); b.className = cls; b.innerHTML = ico(icon) + label; b.onclick = fn; ac.appendChild(b); };
  if (a) mk('swap', 'Replace media', () => pickFiles(a.type, false, (files) => { const id = createAsset(files[0]); checkpoint(); c.asset = id; c.source = 'user'; renderAll(); }));
  mk('sparkles', 'Copy AI request', () => copyAiRequest([f]));
  mk('trash', 'Delete', deleteSelected, 'danger');
}
function refresh() { renderTimeline(); renderComments(); updateCounts(); drawFrame(); }

/* ---------- comments & review ---------- */
function updateCounts() {
  const n = openComments().length;
  for (const id of ['#open-count', '#tab-count']) { const b = $(id); b.textContent = n; b.dataset.n = n; }
  $('#status').value = project.meta.status || 'draft';
  const asp = `${project.meta.width}x${project.meta.height}`, sel_ = $('#aspect');
  if (![...sel_.options].some((o) => o.value === asp)) sel_.add(new Option(`${project.meta.width}×${project.meta.height}`, asp));
  sel_.value = asp;
  $('#project-name').value = project.meta.title || '';
}
function renderComments() {
  const ul = $('#comments'); ul.innerHTML = '';
  let list = allClips().filter(({ c }) => c.comment);
  if (commentFilter === 'open') list = list.filter(({ c }) => !c.commentDone);
  if (commentFilter === 'done') list = list.filter(({ c }) => c.commentDone);
  list.sort((a, b) => a.c.start - b.c.start);
  if (!list.length) ul.innerHTML = `<li class="empty" style="display:block;cursor:default">${commentFilter === 'open' ? 'No open comments. Select a clip and add one.' : 'Nothing here.'}</li>`;
  for (const { t, c } of list) {
    const li = document.createElement('li'); li.className = (c.commentDone ? 'done ' : '') + (sel?.clip === c.id ? 'sel' : '');
    li.innerHTML = `<small><span class="dot" style="background:${COLORS[t.type]}"></span>${fmt(c.start)} · ${esc(t.name)} · ${esc(clipName(t, c).slice(0, 28))}</small>
      <span class="body">${esc(c.comment)}</span>${c.aiReply ? `<span class="reply">AI: ${esc(c.aiReply)}</span>` : ''}<button class="rs" title="${c.commentDone ? 'Reopen' : 'Mark resolved'}">${ico('check')}</button>`;
    li.onclick = () => { seek(c.start); select(t.id, c.id); };
    $('.rs', li).onclick = (e) => { e.stopPropagation(); checkpoint(); c.commentDone = !c.commentDone; renderAll(); };
    ul.appendChild(li);
  }
  updateCounts();
}
function aiRequestFor(items) {
  return JSON.stringify({
    project: project.meta.title,
    instruction: 'Apply each comment to the referenced clip only. Do not change any other clip, track or asset. Return the updated project.json (and any regenerated asset files).',
    requests: items.map(({ t, c }) => {
      const a = assetOf(c);
      return { clip: c.id, track: t.id, trackName: t.name, type: t.type, start: c.start, duration: c.duration,
        current: t.type === 'text' ? { text: c.text } : { asset: c.asset, name: a?.name, prompt: a?.prompt }, comment: c.comment || '' };
    })
  }, null, 2);
}
async function copyAiRequest(items) {
  items = items.filter(({ c }) => c.comment && !c.commentDone);
  if (!items.length) return toast('No open comments to send. Add a comment to a clip first.', true);
  const text = aiRequestFor(items);
  if (await copyText(text)) toast(`Copied ${items.length} request${items.length > 1 ? 's' : ''}. Paste into Claude.`);
  else showModal('AI revision request', 'Copy this and paste it into Claude.', text);
}

/* ---------- editing operations ---------- */
function probe(url, kind) {
  return new Promise((res) => {
    const m = document.createElement(kind === 'audio' ? 'audio' : 'video'); m.preload = 'metadata'; m.src = url;
    m.onloadedmetadata = () => res(isFinite(m.duration) ? round1(m.duration) : 4); m.onerror = () => res(4);
  });
}
function createAsset(file) {
  const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
  const id = uid('a'); fileStore.set(id, file);
  project.assets[id] = { type, src: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, ''), source: 'user' };
  return id;
}
const KIND = (type) => (type === 'text' ? 'text' : type === 'audio' ? 'audio' : 'visual');
const NAMES = { text: 'Text', audio: 'Audio', visual: 'Video' };
/** A track of this kind with room at [at, at+dur); creates one (CapCut-style) when every track is busy. */
function trackFor(type, at, dur) {
  const want = KIND(type);
  const free = (t) => t.type === want && !t.clips.some((c) => at < c.start + c.duration - 1e-6 && at + dur > c.start + 1e-6);
  let tr = project.tracks.find(free);
  if (!tr) {
    tr = { id: uid('t'), type: want, name: NAMES[want], clips: [] };
    const firstVisual = project.tracks.findIndex((t) => t.type === 'visual'), firstAudio = project.tracks.findIndex((t) => t.type === 'audio');
    const idx = want === 'text' ? 0 : want === 'visual' ? (firstVisual >= 0 ? firstVisual : firstAudio >= 0 ? firstAudio : project.tracks.length) : project.tracks.length;
    project.tracks.splice(idx, 0, tr);
  }
  return tr;
}
async function addAssetToTimeline(id, at = time) {
  const a = project.assets[id], dur = a.type === 'image' ? 4 : await probe(resolve(a.src), a.type);
  checkpoint();
  at = round1(at); const tr = trackFor(a.type, at, dur);
  const c = { id: uid('c'), asset: id, start: at, duration: dur, source: 'user' };
  if (a.type === 'audio') { c.in = 0; c.volume = 1; } else if (a.type === 'video') { c.in = 0; c.volume = 1; c.transform = { x: 0, y: 0, scale: 1 }; } else c.transform = { x: 0, y: 0, scale: 1 };
  tr.clips.push(c); select(tr.id, c.id); renderAll(); return c;
}
function addText(kind = 'plain') {
  checkpoint();
  const H = project.meta.height, at = round1(time), tr = trackFor('text', at, 3);
  const style = { plain: { size: Math.round(H * 0.06), color: '#ffffff', y: 0.5, bg: '' },
    title: { size: Math.round(H * 0.09), color: '#ffffff', y: 0.3, bg: '' },
    subtitle: { size: Math.round(H * 0.045), color: '#ffe27a', y: 0.85, bg: 'rgba(0,0,0,.55)' } }[kind];
  const c = { id: uid('c'), start: at, duration: 3, text: { plain: 'Your text', title: 'Title', subtitle: 'Subtitle' }[kind], style, source: 'user' };
  tr.clips.push(c); select(tr.id, c.id); renderAll();
}
function importFiles(files) {           // add to the library only
  const ok = files.filter((f) => /^(image|video|audio)\//.test(f.type));
  if (ok.length < files.length) toast('Some files were skipped: unsupported type', true);
  ok.forEach(createAsset); renderMedia(); if (ok.length) toast(`Imported ${ok.length} file${ok.length > 1 ? 's' : ''}. Click one to add it.`);
}
async function addFiles(files) {          // dropped files go straight onto the timeline
  let at = time;
  for (const f of files) {
    if (!/^(image|video|audio)\//.test(f.type)) { toast(`Skipped ${f.name}: unsupported type`, true); continue; }
    const c = await addAssetToTimeline(createAsset(f), at); at = c.start + c.duration;
  }
}
function pickFiles(type, multiple, cb) {
  const inp = $('#file-add'); inp.accept = type ? type + '/*' : 'image/*,video/*,audio/*'; inp.multiple = multiple; inp.value = '';
  inp.onchange = () => inp.files.length && cb([...inp.files]); inp.click();
}
function splitSelected() {
  const f = selected(); if (!f) return; const { t, c } = f;
  if (time <= c.start + 0.05 || time >= c.start + c.duration - 0.05) return toast('Move the playhead inside the clip to split it.', true);
  checkpoint();
  const first = time - c.start, n = JSON.parse(JSON.stringify(c));
  n.id = uid('c'); n.start = round1(time); n.duration = c.duration - first; delete n.comment; delete n.commentDone;
  if (n.in !== undefined) n.in = (c.in || 0) + first;
  c.duration = first; t.clips.push(n); renderAll();
}
function duplicateSelected() {
  const f = selected(); if (!f) return; const { t, c } = f; checkpoint();
  const n = JSON.parse(JSON.stringify(c)); n.id = uid('c'); delete n.comment; delete n.commentDone; n.source = 'user';
  n.start = round1(c.start + c.duration); const tr = trackFor(t.type, n.start, n.duration); tr.clips.push(n); select(tr.id, n.id); renderAll();
}
function deleteSelected() {
  const f = selected(); if (!f) return; checkpoint();
  f.t.clips = f.t.clips.filter((x) => x !== f.c); sel = null; renderAll();
}
function addCommentToSelected() {
  const f = selected(), ta = $('#new-comment'), v = ta.value.trim(); if (!f || !v) return;
  checkpoint(); f.c.comment = f.c.comment && !f.c.commentDone ? f.c.comment + '\n' + v : v; f.c.commentDone = false;
  ta.value = ''; renderAll(); toast('Comment added');
}

/* ---------- render all ---------- */
function renderAll() { renderMedia(); renderTimeline(); renderInspector(); renderComments(); drawFrame(); }

/* ---------- wiring ---------- */
$('#btn-play').onclick = () => (playing ? stop() : play());
$('#btn-start').onclick = () => seek(0);
$('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
$('#btn-split').onclick = splitSelected; $('#btn-dup').onclick = duplicateSelected; $('#btn-del').onclick = deleteSelected;
$('#btn-export').onclick = exportVideo;
$$('.rb').forEach((b) => (b.onclick = () => { lib = b.dataset.lib; renderMedia(); }));
$('#aspect').onchange = (e) => {
  const [w, h] = e.target.value.split('x').map(Number); checkpoint();
  project.meta.width = w; project.meta.height = h; canvas.width = w; canvas.height = h; drawFrame();
};
$('#btn-ai').onclick = () => (server && currentName ? applyAiChanges() : copyAiRequest(allClips()));
$('#btn-add-comment').onclick = addCommentToSelected;
$('#status').onchange = (e) => { checkpoint(); project.meta.status = e.target.value; toast(`Status: ${e.target.selectedOptions[0].text}`); };
$('#project-name').oninput = (e) => { project.meta.title = e.target.value; dirty = true; };
$('#zoom').oninput = (e) => { pps = +e.target.value; renderTimeline(); drawFrame(); };
$('#zoom-in').onclick = () => { pps = Math.min(240, pps * 1.3); $('#zoom').value = pps; renderTimeline(); drawFrame(); };
$('#zoom-out').onclick = () => { pps = Math.max(20, pps / 1.3); $('#zoom').value = pps; renderTimeline(); drawFrame(); };
$('#btn-fit').onclick = fitTimeline;
$('#modal-close').onclick = () => ($('#modal').hidden = true);
$('#modal-copy').onclick = async () => { if (await copyText($('#modal-text').value)) toast('Copied'); else { $('#modal-text').select(); toast('Press Ctrl+C to copy', true); } };
$$('.tab').forEach((b) => (b.onclick = () => {
  $$('.tab').forEach((x) => x.classList.toggle('on', x === b));
  $('#tab-props').hidden = b.dataset.tab !== 'props'; $('#tab-comments').hidden = b.dataset.tab !== 'comments';
}));
$$('#cfilter button').forEach((b) => (b.onclick = () => { commentFilter = b.dataset.f; $$('#cfilter button').forEach((x) => x.classList.toggle('on', x === b)); renderComments(); }));
$('#new-comment').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addCommentToSelected(); });

const menu = $('#open-menu');
$('#btn-open-menu').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
addEventListener('click', () => (menu.hidden = true));
menu.onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'save') return save();
  if (b.dataset.act === 'settings') return openSettings();
  if (dirty && !(menu._armed === b.dataset.act && Date.now() - menu._armedAt < 4000)) {
    menu._armed = b.dataset.act; menu._armedAt = Date.now(); e.stopPropagation();
    return toast('You have unsaved changes. Click again to continue without saving.', true);
  }
  menu._armed = null;
  ({ home: showHome, settings: openSettings, 'open-folder': openFolder, 'open-file': () => $('#file-open').click(), 'open-sample': loadSample, new: newProject })[b.dataset.act]();
};
$('#file-open').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { dirHandle = null; urlOverrides.clear(); fileStore.clear(); setProject(JSON.parse(await f.text()), ''); toast('Project opened. Relative media files will not load — use “Project folder…” for that.'); }
  catch { toast('That file is not a valid project.json', true); }
};

// ruler + playhead scrubbing
function scrub(e) {
  const r = $('#ruler').getBoundingClientRect(); seek((e.clientX - r.left) / pps);
  const mv = (ev) => seek((ev.clientX - r.left) / pps), up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}
$('#ruler').onmousedown = scrub;
$('#playhead span').onmousedown = (e) => { e.stopPropagation(); scrub(e); };
$('#tl-scroll').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); pps = Math.max(20, Math.min(240, pps * (e.deltaY < 0 ? 1.12 : 0.89))); $('#zoom').value = pps; renderTimeline(); drawFrame(); } }, { passive: false });

// drag & drop files
let dragN = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragN++; $('#dropzone').hidden = false; } });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#dropzone').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('#dropzone').hidden = true; if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

// keyboard
addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return save(); }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return duplicateSelected(); }
  if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); }
  else if (e.key.toLowerCase() === 's' && !mod) splitSelected();
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(time - (e.shiftKey ? 1 : 0.1)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(time + (e.shiftKey ? 1 : 0.1)); }
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'Escape') { sel = null; renderAll(); }
});
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('resize', () => renderTimeline());

/* ---------- server mode: home, generate, apply ---------- */
async function runStream(url, payload, title) {
  const box = $('#progress'), ul = $('#p-steps'), err = $('#p-err');
  $('#p-title').textContent = title; ul.innerHTML = ''; err.textContent = ''; $('#p-close').hidden = true; box.hidden = false;
  const steps = {};
  const mark = (ev) => {
    let li = steps[ev.step];
    if (!li) { ul.querySelectorAll('li.cur').forEach((x) => { x.className = 'ok'; }); li = steps[ev.step] = document.createElement('li'); ul.appendChild(li); }
    li.textContent = ev.msg; li.className = ev.done ? 'ok' : 'cur';
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
    if (!r.body) throw new Error('No response from server');
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', final = null;
    const handle = (line) => {
      if (!line.trim()) return;
      const ev = JSON.parse(line);
      if (ev.error) throw new Error(ev.error);
      if (ev.step) mark(ev); else if (ev.done) final = ev;
    };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); handle(line); }
    }
    handle(buf);
    if (!final) throw new Error('The server stopped before finishing.');
    box.hidden = true; return final;
  } catch (e) {
    ul.querySelectorAll('li.cur').forEach((x) => { x.className = ''; });
    err.textContent = e.message; $('#p-close').hidden = false; throw e;
  }
}
async function openServerProject(name) {
  const r = await fetch(`/api/projects/${name}`); if (!r.ok) return toast('Could not open project', true);
  dirHandle = null; urlOverrides.clear(); fileStore.clear();
  currentName = name; setProject(await r.json(), `/projects/${name}/`); $('#home').hidden = true;
}
async function showHome() {
  if (!server) return toast('All projects needs the ReCut server (npm start).', true);
  $('#home').hidden = false; $('#home-close').hidden = !project;
  try {
    const st = await (await fetch('/api/status')).json();
    if (!st.anthropic) setTimeout(openSettings, 300);
    $('#svc-status').innerHTML = `<span class="${st.anthropic ? 'ok' : 'bad'}">Claude ${st.anthropic ? 'connected' : 'key missing'}</span><span class="${st.elevenlabs ? 'ok' : 'bad'}">ElevenLabs ${st.elevenlabs ? 'connected' : 'key missing'}</span>`;
  } catch {}
  const list = await (await fetch('/api/projects')).json(), box = $('#proj-list');
  box.innerHTML = list.length ? '' : '<div class="empty" style="grid-column:1/-1">No projects yet. Generate your first one above.</div>';
  for (const p of list) {
    const b = document.createElement('button'); b.className = 'pcard';
    b.innerHTML = `<b>${esc(p.title)}</b><span class="meta"><span class="st ${esc(p.status)}">${{ draft: 'Draft', review: 'In review', approved: 'Approved' }[p.status] || esc(p.status)}</span>${p.width}×${p.height} · ${fmt(p.duration || 0)}</span><span class="meta">${new Date(p.updated).toLocaleString()}</span>`;
    b.onclick = () => openServerProject(p.name); box.appendChild(b);
  }
  const sel = $('#g-voice');
  if (sel.dataset.loaded) return;
  const v = await (await fetch('/api/voices')).json();
  if (v.error || !v.length) { sel.innerHTML = '<option value="">No voices (add ELEVENLABS_API_KEY)</option>'; return; }
  let last = ''; try { last = localStorage.getItem('recut.voice') || ''; } catch {}
  sel.innerHTML = '<option value="">No voiceover</option>' + v.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.labels?.accent ? ' · ' + esc(x.labels.accent) : ''}</option>`).join('');
  sel.value = v.some((x) => x.id === last) ? last : v[0].id; sel.dataset.loaded = '1';
}
async function generateProject() {
  const brief = $('#g-brief').value.trim(); if (!brief) return toast('Write a brief first.', true);
  try { localStorage.setItem('recut.voice', $('#g-voice').value); } catch {}
  try {
    const r = await runStream('/api/generate', { brief, seconds: +$('#g-len').value, aspect: $('#g-aspect').value, voiceId: $('#g-voice').value, language: $('#g-lang').value }, 'Generating your project');
    $('#g-brief').value = ''; await openServerProject(r.name); toast('Project ready. Review it, comment, then Apply AI changes.');
  } catch {}
}
async function applyAiChanges() {
  if (!openComments().length) return toast('No open comments. Add a comment to a clip first.', true);
  if (!(await save(true))) return;
  try {
    const r = await runStream(`/api/projects/${currentName}/apply`, {}, 'Applying your comments');
    checkpoint();
    stop(); mediaEls.forEach((el) => el.pause()); mediaEls.clear();
    project = r.project; dirty = false; if (sel && !findClip(sel.clip)) sel = null;
    renderAll(); toast(`Applied ${r.log.length} change${r.log.length === 1 ? '' : 's'}. Undo with Ctrl+Z.`);
  } catch {}
}
$('#btn-home').onclick = showHome;
function openSettings() { $('#s-anthropic').value = ''; $('#s-eleven').value = ''; $('#settings').hidden = false; }
$('#btn-settings').onclick = openSettings;
$('#s-cancel').onclick = () => ($('#settings').hidden = true);
$('#s-save').onclick = async () => {
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicKey: $('#s-anthropic').value, elevenlabsKey: $('#s-eleven').value }) });
  if (!r.ok) return toast('Could not save keys', true);
  $('#settings').hidden = true; $('#g-voice').dataset.loaded = ''; toast('Keys saved on this Mac'); showHome();
};
$('#home-close').onclick = () => ($('#home').hidden = true);
$('#g-go').onclick = generateProject;
$('#p-close').onclick = () => ($('#progress').hidden = true);

(async () => {
  try { const r = await fetch('/api/status'); server = r.ok && !!(await r.json()).server; } catch { server = false; }
  $$('[data-server]').forEach((el) => (el.hidden = !server));
  if (server) {
    $('#btn-ai').title = 'Let Claude apply every open comment (text, voiceover, volume, timing)';
    [...$('#btn-ai').childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()).textContent = 'Apply AI changes';
    showHome();
  } else newProject();
})();

