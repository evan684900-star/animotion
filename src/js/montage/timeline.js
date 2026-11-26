// Mode Montage : timeline multipiste (DOM)
import { M, displayTracks, clipsOn, clipEnd, clipById, trackById, mediaById, projectDuration, commit, emitChange, freeStart, kindFor, mediaLength, fmtTime } from './model.js';
import { seek } from './player.js';
import { el, escapeHtml } from '../util.js';
import { icon } from '../icons.js';
import { EFFECTS } from './engine.js';

const ROW_H = { line: 56 };
const rowH = (tr) => ROW_H[tr.kind] || 56;
const TYPE_ICON = { video: '🎬', image: '🖼️', gif: '🎞️', anim: '✏️', color: '🎨', shape: '🔷', text: '🔤', effect: '✨', audio: '🎵' };
let root, heads, scroll, content, ruler, playhead, drag = null;

export function initTimeline(container, toolbar) {
  root = container;
  root.innerHTML = '';
  root.append(toolbar);
  const body = el('div', 'mt-tl-body');
  heads = el('div', 'mt-tl-heads');
  scroll = el('div', 'mt-tl-scroll');
  content = el('div', 'mt-tl-content');
  ruler = el('canvas', 'mt-ruler');
  playhead = el('div', 'mt-playhead', '<span></span>');
  scroll.appendChild(content);
  body.append(heads, scroll);
  root.appendChild(body);
  scroll.addEventListener('scroll', () => {
    heads.scrollTop = scroll.scrollTop;
    drawRuler();
  });
  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = scroll.getBoundingClientRect();
    const t = (e.clientX - rect.left + scroll.scrollLeft) / M.zoom;
    setZoom(M.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), t, e.clientX - rect.left);
  }, { passive: false });
  content.addEventListener('pointerdown', onDown);
  content.addEventListener('dblclick', onDbl);
  // déposer un média de la bibliothèque sur une piste
  content.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/animotion-media')) e.preventDefault(); });
  content.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('text/animotion-media');
    if (!id) return;
    e.preventDefault();
    const { t, track } = posAt(e);
    import('./edit.js').then(({ addMediaClip }) => {
      const m = mediaById(id);
      if (m) addMediaClip(m, { track: track?.id, start: t });
    });
  });
  renderTimeline();
}

export function setZoom(z, anchorT = M.time, anchorPx = null) {
  M.zoom = Math.max(8, Math.min(600, z));
  renderTimeline();
  if (anchorPx !== null) scroll.scrollLeft = anchorT * M.zoom - anchorPx;
  emitChange('zoom');
}

function posAt(e) {
  const r = content.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top - 26;
  let acc = 0, track = null;
  for (const tr of displayTracks()) {
    const h = rowH(tr);
    if (y >= acc && y < acc + h) { track = tr; break; }
    acc += h;
  }
  return { t: Math.max(0, x / M.zoom), track, x, y };
}

// ---------------------------------------------------------- rendu
export function renderTimeline() {
  if (!root || !M.project) return;
  const tracks = displayTracks();
  const total = Math.max(projectDuration() + 10, 30, (scroll.clientWidth || 800) / M.zoom + 5);
  const width = Math.ceil(total * M.zoom);
  content.style.width = width + 'px';
  heads.innerHTML = '<div class="mt-head-ruler"></div>';
  content.innerHTML = '';
  ruler.width = Math.min(width, 32000);
  content.append(ruler, playhead);
  let y = 26;
  for (const tr of tracks) {
    const h = rowH(tr);
    // en-tête de piste
    const head = el('div', `mt-head k-${tr.kind}${tr.locked ? ' locked' : ''}`);
    head.style.height = h + 'px';
    const name = el('span', 'mt-head-name', escapeHtml(tr.name));
    name.title = 'Double-clic pour renommer';
    name.ondblclick = () => {
      const input = el('input', 'mt-head-input');
      input.value = tr.name;
      name.replaceWith(input);
      input.focus();
      input.select();
      const done = () => { tr.name = input.value.trim() || tr.name; commit(); };
      input.onblur = done;
      input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); ev.stopPropagation(); };
    };
    const btns = el('div', 'mt-head-btns');
    const b = (ic, title, on, fn) => {
      const x = el('button', 'mt-hbtn' + (on ? ' on' : ''), icon(ic, 14));
      x.title = title;
      x.onclick = (ev) => { ev.stopPropagation(); fn(); commit(); };
      btns.appendChild(x);
    };
    b(tr.muted ? 'speakerOff' : 'speaker', 'Couper le son de la ligne', tr.muted, () => (tr.muted = !tr.muted));
    b(tr.hidden ? 'eyeOff' : 'eye', 'Masquer la ligne', tr.hidden, () => (tr.hidden = !tr.hidden));
    b(tr.locked ? 'lock' : 'unlock', 'Verrouiller la ligne', tr.locked, () => (tr.locked = !tr.locked));
    b('trash', 'Supprimer la ligne', false, () => import('./edit.js').then(({ removeTrack }) => removeTrack(tr.id)));
    const used = M.project.clips.some((c) => c.track === tr.id);
    head.append(el('span', 'mt-head-ic' + (used ? '' : ' free'), String(M.project.tracks.indexOf(tr) + 1)), name, btns);
    heads.appendChild(head);
    // ligne de la piste et ses clips
    const row = el('div', `mt-row k-${tr.kind}${tr.locked ? ' locked' : ''}${tr.hidden ? ' hidden-track' : ''}`);
    row.style.top = y + 'px';
    row.style.height = h + 'px';
    row.style.width = width + 'px';
    row.dataset.track = tr.id;
    content.appendChild(row);
    for (const c of clipsOn(tr.id)) row.appendChild(clipEl(c, h));
    y += h;
  }
  content.style.height = y + 'px';
  for (const m of M.project.markers) {
    const mk = el('div', 'mt-marker');
    mk.style.left = m * M.zoom + 'px';
    mk.title = `Marqueur ${fmtTime(m)} (double-clic pour le retirer)`;
    mk.dataset.marker = m;
    content.appendChild(mk);
  }
  drawRuler();
  updatePlayhead();
}

function clipEl(c, h) {
  const m = c.media && mediaById(c.media);
  const missing = c.media && M.media.get(c.media)?.missing;
  const d = el('div', `mt-clip t-${c.type}${M.sel.has(c.id) ? ' sel' : ''}${missing ? ' missing' : ''}`);
  d.dataset.id = c.id;
  d.style.left = c.start * M.zoom + 'px';
  const w = Math.max(4, c.duration * M.zoom);
  d.style.width = w + 'px';
  const label = c.type === 'text' ? (c.text?.content || '').split('\n')[0] : c.type === 'effect' ? EFFECTS[c.effect?.type]?.[0] || 'Effet' : c.name || m?.name || c.type;
  const badges = [c.speed !== 1 ? `×${+c.speed.toFixed(2)}` : '', c.muted ? '🔇' : '', c.filter?.name !== 'none' ? '🎨' : '', c.chroma?.enabled ? '🟩' : '', c.motion?.enabled ? '🎥' : ''].filter(Boolean).join(' ');
  if (['video', 'image', 'gif', 'anim'].includes(c.type) && w > 6) d.appendChild(thumbStrip(c, w, h - 6));
  if ((c.type === 'audio' || (c.type === 'video' && m?.hasAudio)) && w > 6) d.appendChild(waveStrip(c, w, c.type === 'audio' ? h - 22 : 14));
  if (c.type === 'color' || c.type === 'shape') d.style.setProperty('--clip-color', c.color);
  d.appendChild(el('div', 'mt-clip-label', `${TYPE_ICON[c.type] || ''} ${escapeHtml(missing ? '⚠ Média introuvable' : label)}${badges ? ` <b>${badges}</b>` : ''}`));
  if (c.transition?.type && c.transition.type !== 'none') {
    const tr = el('div', 'mt-tr', '⇋');
    tr.style.width = Math.max(10, c.transition.duration * M.zoom) + 'px';
    tr.title = 'Transition d’entrée';
    d.appendChild(tr);
  }
  if (c.fadeIn > 0) { const f = el('div', 'mt-fade l'); f.style.width = c.fadeIn * M.zoom + 'px'; d.appendChild(f); }
  if (c.fadeOut > 0) { const f = el('div', 'mt-fade r'); f.style.width = c.fadeOut * M.zoom + 'px'; d.appendChild(f); }
  d.append(el('div', 'mt-h l'), el('div', 'mt-h r'));
  return d;
}

function thumbStrip(c, w, h) {
  const rt = M.media.get(c.media);
  const cv = el('canvas', 'mt-thumbs');
  cv.width = Math.min(Math.round(w), 6000);
  cv.height = h;
  const x = cv.getContext('2d');
  const thumbs = rt?.thumbs || [];
  if (!thumbs.length) return cv;
  const tw = Math.max(16, Math.round((thumbs[0].c.width / thumbs[0].c.height) * h));
  for (let px = 0; px < cv.width; px += tw) {
    const mt = c.in + (px / M.zoom) * c.speed;
    let best = thumbs[0];
    for (const th of thumbs) if (Math.abs(th.t - mt) < Math.abs(best.t - mt)) best = th;
    x.drawImage(best.c, px, 0, tw, h);
  }
  return cv;
}

function waveStrip(c, w, h) {
  const rt = M.media.get(c.media);
  const cv = el('canvas', 'mt-wave');
  cv.width = Math.min(Math.round(w), 6000);
  cv.height = Math.max(8, h);
  if (!rt?.peaks) return cv;
  const x = cv.getContext('2d');
  x.fillStyle = c.type === 'audio' ? 'rgba(120,220,170,.9)' : 'rgba(160,200,255,.75)';
  const { rate, data } = rt.peaks;
  const gain = c.muted ? 0.15 : Math.min(2, c.volume);
  for (let px = 0; px < cv.width; px += 2) {
    const mt = c.in + (px / M.zoom) * c.speed;
    const i = Math.floor(mt * rate);
    const v = data[i] || 0;
    const bh = Math.max(1, v * gain * cv.height);
    x.fillRect(px, (cv.height - bh) / 2, 1.5, bh);
  }
  return cv;
}

function drawRuler() {
  if (!ruler) return;
  const x = ruler.getContext('2d');
  ruler.height = 26;
  x.clearRect(0, 0, ruler.width, 26);
  x.fillStyle = '#0d1119';
  x.fillRect(0, 0, ruler.width, 26);
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * M.zoom >= 70) || 600;
  const sub = step / 5;
  x.strokeStyle = '#33405a';
  x.fillStyle = '#8b97b0';
  x.font = '10px Segoe UI, sans-serif';
  x.beginPath();
  for (let i = 0; i * sub * M.zoom < ruler.width; i++) {
    const t = Math.round(i * sub * 1000) / 1000;
    const px = Math.round(t * M.zoom) + 0.5;
    const major = i % 5 === 0;
    x.moveTo(px, 26);
    x.lineTo(px, major ? 12 : 20);
    if (major) x.fillText(fmtTime(t, step < 1), px + 3, 10);
  }
  x.stroke();
  x.fillStyle = 'rgba(47,140,255,.18)';
  x.fillRect(0, 22, projectDuration() * M.zoom, 4);
}

export function updatePlayhead() {
  if (!playhead) return;
  playhead.style.left = M.time * M.zoom + 'px';
  playhead.querySelector('span').textContent = fmtTime(M.time);
  // la timeline suit la tête de lecture pendant la lecture
  if (M.playing && scroll) {
    const px = M.time * M.zoom;
    if (px > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = px - 80;
    if (px < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, px - 40);
  }
}

// ---------------------------------------------------------- interactions
function snapCandidates(ignore) {
  const out = [0, M.time, ...M.project.markers];
  for (const c of M.project.clips) if (!ignore.has(c.id)) out.push(c.start, clipEnd(c));
  return out;
}
function snap(v, cands) {
  if (!M.snap) return v;
  let best = v, bd = 9 / M.zoom;
  for (const c of cands) if (Math.abs(c - v) < bd) { bd = Math.abs(c - v); best = c; }
  return best;
}

function onDown(e) {
  if (e.button !== 0) return;
  const target = e.target;
  const { t, track, y } = posAt(e);
  // règle (en haut) : déplacer la tête de lecture
  if (y < 0 || target === ruler || target.closest('.mt-playhead')) {
    content.setPointerCapture(e.pointerId);
    seek(t);
    drag = { kind: 'seek' };
    content.onpointermove = (ev) => drag?.kind === 'seek' && seek(snap(posAt(ev).t, snapCandidates(new Set())));
    content.onpointerup = () => { drag = null; content.onpointermove = null; };
    return;
  }
  const clipNode = target.closest('.mt-clip');
  if (!clipNode) {
    if (!e.shiftKey) M.sel.clear();
    emitChange('selection');
    renderTimeline();
    return;
  }
  const c = clipById(clipNode.dataset.id);
  if (!c) return;
  if (e.shiftKey || e.ctrlKey) {
    if (M.sel.has(c.id)) M.sel.delete(c.id);
    else M.sel.add(c.id);
  } else if (!M.sel.has(c.id)) M.sel = new Set([c.id]);
  emitChange('selection');
  renderTimeline();
  if (trackById(c.track)?.locked) return;
  const mode = target.classList.contains('mt-h') ? (target.classList.contains('l') ? 'trim-l' : 'trim-r') : 'move';
  const moving = mode === 'move' ? M.project.clips.filter((x) => M.sel.has(x.id) && !trackById(x.track)?.locked) : [c];
  drag = {
    kind: mode, c, x0: e.clientX, t0: t, moved: false,
    orig: moving.map((x) => ({ x, start: x.start, duration: x.duration, in: x.in, track: x.track })),
    cands: snapCandidates(new Set(moving.map((x) => x.id))),
  };
  content.setPointerCapture(e.pointerId);
  content.onpointermove = onMove;
  content.onpointerup = onUp;
}

function onMove(e) {
  if (!drag) return;
  const dt = (e.clientX - drag.x0) / M.zoom;
  if (Math.abs(e.clientX - drag.x0) > 2) drag.moved = true;
  if (!drag.moved) return;
  const o = drag.orig[0];
  if (drag.kind === 'move') {
    // aimantation sur le début ou la fin du clip principal
    const main = drag.orig.find((r) => r.x === drag.c) || o;
    let ns = Math.max(0, main.start + dt);
    const s1 = snap(ns, drag.cands), s2 = snap(ns + main.duration, drag.cands) - main.duration;
    ns = Math.abs(s1 - ns) <= Math.abs(s2 - ns) ? s1 : s2;
    const delta = ns - main.start;
    const minStart = Math.min(...drag.orig.map((r) => r.start));
    const d = Math.max(-minStart, delta);
    for (const r of drag.orig) r.x.start = r.start + d;
    // changement de piste (un seul clip)
    if (drag.orig.length === 1) {
      const tr = posAt(e).track;
      if (tr && !tr.locked) drag.c.track = tr.id;
    }
  } else if (drag.kind === 'trim-l') {
    const c = drag.c;
    let ns = snap(Math.max(0, o.start + dt), drag.cands);
    ns = Math.min(ns, o.start + o.duration - 0.05);
    const shift = ns - o.start;
    const limited = ['video', 'audio'].includes(c.type) || (['gif', 'anim'].includes(c.type) && !c.loop);
    if (limited && o.in + shift * c.speed < 0) ns = o.start - o.in / c.speed;
    c.start = ns;
    c.duration = o.duration - (ns - o.start);
    c.in = Math.max(0, o.in + (ns - o.start) * c.speed);
  } else if (drag.kind === 'trim-r') {
    const c = drag.c;
    let ne = snap(o.start + o.duration + dt, drag.cands);
    const max = (mediaLength(c) - c.in) / c.speed;
    c.duration = Math.max(0.05, Math.min(ne - c.start, max));
  }
  emitChange('drag');
  renderTimeline();
}

function onUp() {
  content.onpointermove = null;
  content.onpointerup = null;
  if (!drag) return;
  if (drag.moved) {
    if (drag.kind === 'move' && drag.orig.length === 1) drag.c.start = freeStart(drag.c.track, drag.c.start, drag.c.duration, drag.c.id);
    commit();
  }
  drag = null;
  renderTimeline();
}

function onDbl(e) {
  const mk = e.target.closest('.mt-marker');
  if (mk) {
    M.project.markers = M.project.markers.filter((m) => String(m) !== mk.dataset.marker);
    commit();
  }
}
