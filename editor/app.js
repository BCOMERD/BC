'use strict';
// محرر مشاريع متعدد المسارات — بدون اعتماديات.
// المشروع = project.json (مسارات + مقاطع + أصول). كل شيء قابل للتعديل.

const $ = (s) => document.querySelector(s);
const LABEL_W = 130;
let project = null;
let baseUrl = '';           // لحل مسارات الأصول النسبية
let pps = 70;               // بكسل لكل ثانية
let time = 0;
let playing = false;
let lastTs = 0;
let sel = null;             // {track, clip}
let audioCtx = null, recDest = null;
const mediaEls = new Map(); // clipId -> HTMLMediaElement
const imgCache = new Map(); // src -> HTMLImageElement
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');

/* ---------- أدوات ---------- */
const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8);
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const snap = (v) => Math.max(0, Math.round(v * 10) / 10);
const resolve = (src) => (/^(data:|blob:|https?:|\/)/.test(src) ? src : baseUrl + src);
const findClip = (id) => { for (const t of project.tracks) for (const c of t.clips) if (c.id === id) return { track: t, clip: c }; return null; };
const duration = () => Math.max(project.meta.duration || 0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)), 1);
const assetOf = (c) => project.assets[c.asset];

/* ---------- تحميل ---------- */
async function load(url) {
  const r = await fetch(url);
  baseUrl = url.replace(/[^/]*$/, '');
  setProject(await r.json());
}
function setProject(p) {
  stop();
  mediaEls.forEach((el) => { el.pause(); el.removeAttribute('src'); });
  mediaEls.clear();
  project = p;
  canvas.width = p.meta.width; canvas.height = p.meta.height;
  time = 0; sel = null;
  $('#title').textContent = p.meta.title || '';
  renderAll();
}

/* ---------- الرسم (المعاينة) ---------- */
function getImg(src) {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.onload = () => drawFrame(); im.src = resolve(src); imgCache.set(src, im); }
  return im;
}
function mediaEl(clip) {
  let el = mediaEls.get(clip.id);
  const a = assetOf(clip);
  if (!el) {
    el = document.createElement(a.type === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
    el.src = resolve(a.src);
    mediaEls.set(clip.id, el);
  }
  return el;
}
function drawFrame() {
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  // المسار الأعلى في القائمة = الأعلى بصرياً، لذا نرسم من الأسفل للأعلى
  for (const tr of [...project.tracks].reverse()) {
    if (tr.hidden) continue;
    for (const c of tr.clips) {
      if (time < c.start || time >= c.start + c.duration) continue;
      if (tr.type === 'visual') drawVisual(c, W, H);
      else if (tr.type === 'text') drawText(c, W, H);
    }
  }
  $('#timecode').textContent = `${fmt(time)} / ${fmt(duration())}`;
  $('#playhead').style.left = LABEL_W + time * pps + 'px';
}
function drawVisual(c, W, H) {
  const a = assetOf(c); if (!a) return;
  let src, sw, sh;
  if (a.type === 'image') { src = getImg(a.src); sw = src.naturalWidth; sh = src.naturalHeight; }
  else { src = mediaEl(c); sw = src.videoWidth; sh = src.videoHeight; }
  if (!sw || !sh) return;
  const tf = c.transform || { x: 0, y: 0, scale: 1 };
  const k = Math.max(W / sw, H / sh) * (tf.scale || 1); // cover
  const dw = sw * k, dh = sh * k;
  ctx.drawImage(src, W / 2 - dw / 2 + (tf.x || 0) * W, H / 2 - dh / 2 + (tf.y || 0) * H, dw, dh);
}
function drawText(c, W, H) {
  const s = c.style || {};
  const size = s.size || 48;
  ctx.font = `bold ${size}px system-ui, Tahoma, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  const maxW = W * 0.86;
  const lines = [];
  for (const para of String(c.text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
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

/* ---------- التشغيل والمزامنة ---------- */
function syncMedia() {
  for (const tr of project.tracks) {
    if (tr.type === 'text') continue;
    for (const c of tr.clips) {
      const a = assetOf(c); if (!a || (tr.type === 'visual' && a.type !== 'video')) continue;
      const el = mediaEl(c);
      const inside = playing && time >= c.start && time < c.start + c.duration && !tr.hidden;
      el.volume = Math.min(1, Math.max(0, (c.volume ?? 1) * (tr.volume ?? 1)));
      el.muted = !!tr.muted || (tr.type === 'visual');
      if (inside) {
        const want = (c.in || 0) + (time - c.start);
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) el.pause();
    }
  }
}
function seekMedia() { // بعد القفز في الزمن بدون تشغيل
  for (const tr of project.tracks) for (const c of tr.clips) {
    const a = assetOf(c);
    if (tr.type === 'visual' && a && a.type === 'video' && time >= c.start && time < c.start + c.duration) mediaEl(c).currentTime = (c.in || 0) + (time - c.start);
  }
}
function tick(ts) {
  if (!playing) return;
  time += (ts - lastTs) / 1000; lastTs = ts;
  if (time >= duration()) { time = duration(); stop(); drawFrame(); return; }
  syncMedia(); drawFrame();
  requestAnimationFrame(tick);
}
function play() {
  if (time >= duration()) time = 0;
  ensureAudioGraph();
  playing = true; lastTs = performance.now(); $('#btn-play').textContent = '⏸ إيقاف';
  requestAnimationFrame(tick);
}
function stop() {
  playing = false; $('#btn-play').textContent = '▶ تشغيل';
  mediaEls.forEach((el) => el.pause());
}
function seek(t) { time = Math.max(0, Math.min(duration(), t)); if (!playing) seekMedia(); drawFrame(); }

/* ---------- الصوت للتصدير ---------- */
const routed = new WeakSet();
function ensureAudioGraph() {
  if (!audioCtx) { audioCtx = new AudioContext(); recDest = audioCtx.createMediaStreamDestination(); }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  for (const tr of project.tracks) for (const c of tr.clips) {
    const a = assetOf(c); if (!a || a.type === 'image' || tr.type === 'visual' && a.type !== 'video') continue;
    const el = mediaEl(c);
    if (routed.has(el)) continue;
    routed.add(el);
    try { const s = audioCtx.createMediaElementSource(el); s.connect(audioCtx.destination); s.connect(recDest); } catch (e) { /* مصدر عبر نطاق آخر */ }
  }
}
async function exportVideo() {
  if (typeof MediaRecorder === 'undefined') return alert('المتصفح لا يدعم التسجيل.');
  stop(); seek(0); ensureAudioGraph();
  const stream = canvas.captureStream(project.meta.fps || 30);
  recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  const btn = $('#btn-export'); btn.disabled = true; btn.textContent = 'جارٍ التصدير… (بالزمن الحقيقي)';
  rec.start(); play();
  await new Promise((res) => { const iv = setInterval(() => { if (!playing) { clearInterval(iv); res(); } }, 100); });
  rec.stop(); await done;
  btn.disabled = false; btn.textContent = 'تصدير فيديو (WebM)';
  download(new Blob(chunks, { type: 'video/webm' }), (project.meta.title || 'video') + '.webm');
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- المسارات (واجهة) ---------- */
function renderAll() { renderRuler(); renderTracks(); renderInspector(); renderComments(); drawFrame(); }
function renderRuler() {
  const d = duration(), r = $('#ruler'); r.innerHTML = '';
  const step = pps >= 100 ? 1 : pps >= 50 ? 2 : 5;
  for (let t = 0; t <= d + 1; t += step) {
    const e = document.createElement('div'); e.className = 'tick'; e.style.left = t * pps + 'px'; e.textContent = fmt(t); r.appendChild(e);
  }
  $('#tl-inner').style.width = LABEL_W + (d + 2) * pps + 'px';
}
function renderTracks() {
  const root = $('#tracks'); root.innerHTML = '';
  const d = duration();
  const typeName = { visual: 'مرئي', audio: 'صوت', text: 'نص' };
  for (const tr of project.tracks) {
    const row = document.createElement('div'); row.className = 'track';
    const head = document.createElement('div'); head.className = 'track-head';
    head.innerHTML = `<b></b><span>${typeName[tr.type]}</span>`;
    head.firstChild.textContent = tr.name;
    const mute = document.createElement('button');
    if (tr.type === 'audio') { mute.textContent = tr.muted ? 'مكتوم' : 'كتم'; mute.onclick = () => { tr.muted = !tr.muted; renderTracks(); }; }
    else { mute.textContent = tr.hidden ? 'مخفي' : 'إخفاء'; mute.onclick = () => { tr.hidden = !tr.hidden; renderTracks(); drawFrame(); }; }
    head.appendChild(mute);
    const lane = document.createElement('div'); lane.className = 'lane'; lane.style.width = (d + 2) * pps + 'px';
    lane.onmousedown = (e) => { if (e.target === lane) { seek((e.offsetX) / pps); sel = null; renderTracks(); renderInspector(); } };
    for (const c of tr.clips) lane.appendChild(clipEl(tr, c));
    row.append(head, lane); root.appendChild(row);
  }
}
function clipEl(tr, c) {
  const el = document.createElement('div');
  el.className = `clip ${tr.type}` + (sel && sel.clip === c.id ? ' sel' : '');
  el.style.left = c.start * pps + 'px'; el.style.width = Math.max(8, c.duration * pps) + 'px';
  const a = assetOf(c);
  el.textContent = tr.type === 'text' ? c.text : (a ? a.name || c.asset : c.asset);
  if (c.comment) { const b = document.createElement('span'); b.className = 'bubble'; b.textContent = '💬'; el.appendChild(b); }
  const hl = Object.assign(document.createElement('div'), { className: 'h l' }), hr = Object.assign(document.createElement('div'), { className: 'h r' });
  el.append(hl, hr);
  el.onmousedown = (e) => {
    e.stopPropagation();
    select(tr.id, c.id);
    const mode = e.target === hl ? 'l' : e.target === hr ? 'r' : 'm';
    const x0 = e.clientX, s0 = c.start, d0 = c.duration, in0 = c.in || 0;
    const move = (ev) => {
      const dt = (ev.clientX - x0) / pps;
      if (mode === 'm') c.start = snap(s0 + dt);
      else if (mode === 'r') c.duration = Math.max(0.1, snap(d0 + dt));
      else { const ns = Math.min(snap(s0 + dt), s0 + d0 - 0.1); c.duration = d0 - (ns - s0); c.start = ns; if (c.in !== undefined) c.in = Math.max(0, in0 + (ns - s0)); }
      el.style.left = c.start * pps + 'px'; el.style.width = c.duration * pps + 'px';
      drawFrame();
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); renderAll(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };
  return el;
}
function select(trackId, clipId) { sel = { track: trackId, clip: clipId }; renderTracks(); renderInspector(); }

/* ---------- لوحة الخصائص ---------- */
function renderInspector() {
  const box = $('#inspector');
  if (!sel) { box.innerHTML = '<p class="muted">اختر مقطعاً من المسارات لتعديله.</p>'; return; }
  const f = findClip(sel.clip); if (!f) { sel = null; return renderInspector(); }
  const { track: tr, clip: c } = f, a = assetOf(c);
  box.innerHTML = '';
  const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; box.appendChild(d); return d; };
  const bind = (root, sel_, fn) => { const e = root.querySelector(sel_); if (e) e.oninput = () => { fn(e); drawFrame(); renderTracks(); renderComments(); }; };

  add(`<b>${tr.type === 'text' ? 'نص' : a ? a.name || c.asset : ''}</b> <span class="muted">(${c.source === 'user' ? 'من المستخدم' : 'من الذكاء الاصطناعي'})</span>`);
  if (tr.type === 'text') {
    const s = (c.style = c.style || {});
    const d = add(`<label>النص</label><textarea data-k="text"></textarea>
      <div class="row"><div><label>الحجم</label><input type="number" data-k="size" min="10" max="300"></div>
      <div><label>اللون</label><input type="color" data-k="color"></div></div>
      <label>الموضع العمودي</label><input type="range" data-k="y" min="0" max="1" step="0.01">
      <label>الخلفية (CSS، فارغ = بدون)</label><input data-k="bg">`);
    d.querySelector('[data-k=text]').value = c.text;
    d.querySelector('[data-k=size]').value = s.size || 48;
    d.querySelector('[data-k=color]').value = s.color || '#ffffff';
    d.querySelector('[data-k=y]').value = s.y ?? 0.5;
    d.querySelector('[data-k=bg]').value = s.bg || '';
    bind(d, '[data-k=text]', (e) => (c.text = e.value));
    bind(d, '[data-k=size]', (e) => (s.size = +e.value));
    bind(d, '[data-k=color]', (e) => (s.color = e.value));
    bind(d, '[data-k=y]', (e) => (s.y = +e.value));
    bind(d, '[data-k=bg]', (e) => (s.bg = e.value));
  }
  const t = add(`<div class="row"><div><label>البداية (ث)</label><input type="number" step="0.1" min="0" data-k="start"></div>
    <div><label>المدة (ث)</label><input type="number" step="0.1" min="0.1" data-k="dur"></div></div>`);
  t.querySelector('[data-k=start]').value = c.start; t.querySelector('[data-k=dur]').value = c.duration;
  bind(t, '[data-k=start]', (e) => (c.start = Math.max(0, +e.value)));
  bind(t, '[data-k=dur]', (e) => (c.duration = Math.max(0.1, +e.value)));

  if (tr.type === 'audio' || (a && a.type === 'video')) {
    const v = add(`<label>مستوى الصوت</label><input type="range" min="0" max="1" step="0.01" data-k="vol">`);
    v.querySelector('input').value = c.volume ?? 1;
    bind(v, 'input', (e) => (c.volume = +e.value));
  }
  if (tr.type === 'visual') {
    const tf = (c.transform = c.transform || { x: 0, y: 0, scale: 1 });
    const v = add(`<label>التكبير</label><input type="range" min="1" max="3" step="0.01" data-k="sc">
      <div class="row"><div><label>إزاحة أفقية</label><input type="range" min="-0.5" max="0.5" step="0.01" data-k="x"></div>
      <div><label>إزاحة عمودية</label><input type="range" min="-0.5" max="0.5" step="0.01" data-k="y"></div></div>`);
    v.querySelector('[data-k=sc]').value = tf.scale; v.querySelector('[data-k=x]').value = tf.x; v.querySelector('[data-k=y]').value = tf.y;
    bind(v, '[data-k=sc]', (e) => (tf.scale = +e.value)); bind(v, '[data-k=x]', (e) => (tf.x = +e.value)); bind(v, '[data-k=y]', (e) => (tf.y = +e.value));
  }
  const cm = add(`<label>تعليق على هذه اللقطة</label><textarea data-k="cm" placeholder="مثال: بدّل الصورة / اختصر الجملة"></textarea>`);
  cm.querySelector('textarea').value = c.comment || '';
  bind(cm, 'textarea', (e) => (c.comment = e.value));

  const btns = add('<div class="btns"></div>').firstChild;
  const mk = (txt, fn, cls) => { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; b.onclick = fn; btns.appendChild(b); };
  if (a) mk('استبدال الملف', () => pickFile(a.type, (asset) => { const id = uid('a'); project.assets[id] = asset; c.asset = id; c.source = 'user'; renderAll(); }));
  mk('نسخ طلب إعادة التوليد', () => {
    const req = { clip: c.id, track: tr.id, type: tr.type, prompt: (a && a.prompt) || c.text || '', comment: c.comment || '', start: c.start, duration: c.duration };
    navigator.clipboard.writeText(JSON.stringify(req, null, 2)).then(() => alert('تم النسخ — الصقه لكلود ليعيد توليد هذا العنصر فقط.'));
  });
  mk('حذف', () => { tr.clips = tr.clips.filter((x) => x !== c); sel = null; renderAll(); }, 'danger');
}
function renderComments() {
  const ul = $('#comments'); ul.innerHTML = '';
  const all = project.tracks.flatMap((t) => t.clips.filter((c) => c.comment).map((c) => ({ t, c })));
  if (!all.length) { ul.innerHTML = '<li class="muted">لا توجد تعليقات.</li>'; return; }
  for (const { t, c } of all.sort((x, y) => x.c.start - y.c.start)) {
    const li = document.createElement('li');
    li.innerHTML = `<small>${fmt(c.start)} — ${t.name}</small>`; li.append(c.comment);
    li.onclick = () => { seek(c.start); select(t.id, c.id); };
    ul.appendChild(li);
  }
}

/* ---------- إضافة / قصّ / ملفات ---------- */
function pickFile(type, cb) {
  const inp = $('#file-add'); inp.accept = type + '/*'; inp.value = '';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => cb({ type, src: r.result, name: f.name, source: 'user' });
    r.readAsDataURL(f);
  };
  inp.click();
}
function trackFor(type, name) {
  const want = type === 'image' || type === 'video' ? 'visual' : type;
  let tr = project.tracks.find((t) => t.type === want);
  if (!tr) { tr = { id: uid('t'), type: want, name, clips: [] }; project.tracks.push(tr); }
  return tr;
}
function addClip(kind) {
  if (kind === 'text') {
    const tr = trackFor('text', 'نص');
    const c = { id: uid('c'), start: snap(time), duration: 3, text: 'نص جديد', style: { size: 56, color: '#ffffff', y: 0.5, bg: '' }, source: 'user' };
    tr.clips.push(c); select(tr.id, c.id); renderAll(); return;
  }
  pickFile(kind, (asset) => {
    const id = uid('a'); project.assets[id] = asset;
    const tr = trackFor(kind, kind === 'audio' ? 'صوت' : 'صور / فيديو');
    const c = { id: uid('c'), asset: id, start: snap(time), duration: 4, source: 'user' };
    if (kind === 'audio') { c.in = 0; c.volume = 1; } else c.transform = { x: 0, y: 0, scale: 1 };
    const probe = document.createElement(kind === 'audio' ? 'audio' : 'video');
    if (kind === 'audio' || kind === 'video') {
      probe.preload = 'metadata'; probe.src = asset.src;
      probe.onloadedmetadata = () => { if (isFinite(probe.duration)) { c.duration = Math.round(probe.duration * 10) / 10; renderAll(); } };
    }
    tr.clips.push(c); select(tr.id, c.id); renderAll();
  });
}
function splitSelected() {
  if (!sel) return;
  const { track: tr, clip: c } = findClip(sel.clip);
  if (time <= c.start + 0.05 || time >= c.start + c.duration - 0.05) return;
  const first = time - c.start, n = JSON.parse(JSON.stringify(c));
  n.id = uid('c'); n.start = snap(time); n.duration = c.duration - first;
  if (n.in !== undefined) n.in = (c.in || 0) + first;
  c.duration = first; c.comment = c.comment || ''; n.comment = '';
  tr.clips.push(n); renderAll();
}

/* ---------- ربط الأحداث ---------- */
$('#btn-play').onclick = () => (playing ? stop() : play());
$('#btn-split').onclick = splitSelected;
$('#btn-export').onclick = exportVideo;
$('#btn-save').onclick = () => download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'project.json');
$('#btn-open').onclick = () => $('#file-open').click();
$('#file-open').onchange = async (e) => { const f = e.target.files[0]; if (f) { baseUrl = ''; setProject(JSON.parse(await f.text())); } };
document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => addClip(b.dataset.add)));
$('#zoom').oninput = (e) => { pps = +e.target.value; renderAll(); };
$('#ruler').onmousedown = (e) => seek(e.offsetX / pps);
addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); }
  if (e.code === 'Delete' && sel) { const f = findClip(sel.clip); f.track.clips = f.track.clips.filter((x) => x !== f.clip); sel = null; renderAll(); }
});

load('sample/project.json');
