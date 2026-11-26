// Mode Montage : l'espace de travail (aperçu interactif, contrôles de lecture, timeline, bibliothèque, réglages)
import {
  M, FORMATS, createProject, makeClip, TEXT_DEFAULT, onChange, emitChange, undo, redo, resetHistory, commit,
  fmtTime, projectDuration, clipById, trackById,
} from './model.js';
import { renderFrame, hooks as engineHooks, disposeAll, pruneElements } from './engine.js';
import { player, play, pause, toggle, seek, setPreviewMuted } from './player.js';
import { initTimeline, renderTimeline, updatePlayhead, setZoom } from './timeline.js';
import { initInspector, render as renderInspector } from './inspector.js';
import { initLibrary, render as renderLibrary, importMediaFiles, pickAndImport } from './library.js';
import * as E from './edit.js';
import { loadProjectMedia, serializeProject, addAnimation } from './media.js';
import { showMontageExport } from './exporter.js';
import { app, hooks, emit, store } from '../state.js';
import { el, escapeHtml, baseName } from '../util.js';
import { icon } from '../icons.js';
import { modal, toast, progress, isModalOpen } from '../dialogs.js';
import { saveFile, setWindowTitle, isTauri } from '../platform.js';
import { showStart, hideStart } from '../start.js';
import { clearRecovery } from '../recovery.js';
import { confirmLoseChanges, addRecent, openProject } from '../actions.js';
import { updateDiscord } from '../discord.js';

let root = null, cv, ctx, ov, octx, frameBox, stageBox, controls, nameInput, fmtBtn, dirtyDot, undoBtn, redoBtn;
let bounds = [], drag = null, guides = {}, showThirds = false, showSafe = false;
const LAY = { lib: 300, insp: 310, tl: 290, ...(store('montageLayout') || {}) };
const LIM = { lib: [200, 560], insp: [230, 560], tl: [150, () => Math.round(window.innerHeight * 0.65)] };

export const isMontageOpen = () => !!root && !root.classList.contains('hidden') && !!M.project;
const clampLay = (k, v) => Math.round(Math.max(LIM[k][0], Math.min(typeof LIM[k][1] === 'function' ? LIM[k][1]() : LIM[k][1], v)));

// ---------------------------------------------------------- construction de l'interface (une seule fois)
function ensure() {
  if (root) return;
  root = el('div', 'mt hidden');
  root.id = 'montage';
  root.innerHTML = `
    <header class="mt-top">
      <button class="btn small ghost mt-home" title="Fermer le montage et revenir à l’accueil">${icon('home', 16)} Accueil</button>
      <div class="mt-brand">${icon('clap', 18)}<span>MONTAGE</span></div>
      <input class="mt-name" spellcheck="false" title="Nom du montage (utilisé pour enregistrer et exporter)">
      <span class="mt-dirty" title="Modifications non enregistrées">●</span>
      <button class="mt-fmt" title="Format de la vidéo : clique pour le changer"></button>
      <div class="grow"></div>
      <button class="icon-btn mt-undo" title="Annuler (Ctrl+Z)">${icon('undo', 18)}</button>
      <button class="icon-btn mt-redo" title="Rétablir (Ctrl+Y)">${icon('redo', 18)}</button>
      <button class="icon-btn mt-keys" title="Raccourcis clavier du montage (F1)">${icon('keyboard', 18)}</button>
      <button class="btn small mt-open" title="Ouvrir un projet (Ctrl+O)">${icon('open', 15)} Ouvrir</button>
      <button class="btn small mt-save" title="Enregistrer le montage (Ctrl+S) — Maj+clic : enregistrer sous">${icon('save', 15)} Enregistrer</button>
      <button class="export-top mt-export" title="Exporter en MP4, WebM, GIF ou image (Ctrl+E)">${icon('export', 15)} Exporter</button>
    </header>
    <div class="mt-main">
      <aside class="mt-lib"></aside>
      <div class="mt-rz v" data-k="lib"></div>
      <section class="mt-center">
        <div class="mt-stage"><div class="mt-frame"><canvas class="mt-canvas"></canvas><canvas class="mt-over"></canvas></div><div class="mt-stage-empty hidden"></div></div>
        <div class="mt-controls"></div>
      </section>
      <div class="mt-rz v" data-k="insp"></div>
      <aside class="mt-insp"></aside>
    </div>
    <div class="mt-rz h" data-k="tl"></div>
    <section class="mt-tl"></section>`;
  document.body.insertBefore(root, document.getElementById('startScreen'));
  const $ = (s) => root.querySelector(s);
  cv = $('.mt-canvas');
  ctx = cv.getContext('2d', { willReadFrequently: false });
  ov = $('.mt-over');
  octx = ov.getContext('2d');
  frameBox = $('.mt-frame');
  stageBox = $('.mt-stage');
  controls = $('.mt-controls');
  nameInput = $('.mt-name');
  fmtBtn = $('.mt-fmt');
  dirtyDot = $('.mt-dirty');
  undoBtn = $('.mt-undo');
  redoBtn = $('.mt-redo');

  $('.mt-home').onclick = goHome;
  $('.mt-open').onclick = () => openProject();
  $('.mt-save').onclick = (e) => saveMontage(e.shiftKey);
  $('.mt-export').onclick = () => showMontageExport();
  $('.mt-keys').onclick = showMontageHelp;
  undoBtn.onclick = doUndo;
  redoBtn.onclick = doRedo;
  fmtBtn.onclick = () => {
    M.sel.clear();
    emitChange('selection');
    renderTimeline();
    toast('Choisis le format dans le panneau de droite ➡️');
  };
  nameInput.onchange = () => {
    M.name = nameInput.value.trim().replace(/[\\/:*?"<>|]/g, '') || 'Mon montage';
    nameInput.value = M.name;
    updateTop();
  };
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') nameInput.blur();
    e.stopPropagation();
  };

  initLibrary($('.mt-lib'));
  initInspector($('.mt-insp'));
  initTimeline($('.mt-tl'), timelineToolbar());
  buildControls();
  setupOverlay();
  for (const rz of root.querySelectorAll('.mt-rz')) resizer(rz);
  applyLayout();
  new ResizeObserver(() => layoutStage()).observe(stageBox);
  // pendant la lecture : image + tête de lecture à chaque image
  player.onFrame = () => {
    draw();
    updatePlayhead();
  };
  player.onState = () => {
    renderControls();
    updateDiscord();
  };
  engineHooks.redraw = requestDraw;
}

function applyLayout(save = false) {
  for (const k of Object.keys(LIM)) LAY[k] = clampLay(k, LAY[k]);
  root.style.setProperty('--mt-lib', LAY.lib + 'px');
  root.style.setProperty('--mt-insp', LAY.insp + 'px');
  root.style.setProperty('--mt-tl', LAY.tl + 'px');
  if (save) store('montageLayout', LAY);
}
function resizer(h) {
  const k = h.dataset.k, axis = h.classList.contains('v') ? 'x' : 'y', dir = k === 'lib' ? 1 : -1;
  h.title = 'Glisser pour redimensionner — double-clic : taille par défaut';
  h.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const s0 = axis === 'x' ? e.clientX : e.clientY, v0 = LAY[k];
    h.classList.add('drag');
    h.onpointermove = (ev) => {
      LAY[k] = clampLay(k, v0 + ((axis === 'x' ? ev.clientX : ev.clientY) - s0) * dir);
      applyLayout();
      renderTimeline();
    };
    h.onpointerup = () => {
      h.onpointermove = h.onpointerup = null;
      h.classList.remove('drag');
      applyLayout(true);
    };
  };
  h.ondblclick = () => {
    LAY[k] = { lib: 300, insp: 310, tl: 290 }[k];
    applyLayout(true);
    renderTimeline();
  };
}

// ---------------------------------------------------------- barre d'outils de la timeline
function timelineToolbar() {
  const bar = el('div', 'mt-tl-bar');
  const btn = (ic, label, title, fn, cls = '') => {
    const b = el('button', 'mt-tbtn ' + cls, icon(ic, 16) + (label ? `<span>${label}</span>` : ''));
    b.title = title;
    b.onclick = () => { fn(); b.blur(); };
    bar.appendChild(b);
    return b;
  };
  const sep = () => bar.appendChild(el('span', 'mt-sep'));
  btn('undo', '', 'Annuler (Ctrl+Z)', doUndo);
  btn('redo', '', 'Rétablir (Ctrl+Y)', doRedo);
  sep();
  btn('cut', 'Couper', 'Couper le clip à la tête de lecture (S)', () => E.split());
  btn('trash', 'Supprimer', 'Supprimer la sélection (Suppr) — Maj+Suppr : supprimer et resserrer', () => E.removeSelected(false));
  btn('dup', 'Dupliquer', 'Dupliquer la sélection (Ctrl+D)', () => E.duplicateSelected());
  btn('freeze', 'Figer', 'Figer l’image : insère 2 s d’image fixe à la tête de lecture', () => E.freezeFrame());
  btn('music', 'Extraire l’audio', 'Sépare le son de la vidéo sélectionnée sur une piste audio', () => E.extractAudio());
  sep();
  const snapB = btn('magnet', '', 'Aimantation des clips (bords, tête de lecture, marqueurs)', () => {
    M.snap = !M.snap;
    snapB.classList.toggle('on', M.snap);
    toast(M.snap ? 'Aimantation activée 🧲' : 'Aimantation désactivée');
  });
  snapB.classList.toggle('on', M.snap);
  btn('flag', '', 'Ajouter / retirer un marqueur à la tête de lecture (M)', () => E.toggleMarker());
  bar.appendChild(el('div', 'grow'));
  btn('zoomOut', '', 'Dézoomer la timeline (−)', () => setZoom(M.zoom / 1.3));
  const zr = el('input', 'mt-zoom');
  Object.assign(zr, { type: 'range', min: 0, max: 100, step: 1 });
  zr.title = 'Zoom de la timeline (Ctrl + molette)';
  const toR = (z) => Math.round((Math.log(z / 8) / Math.log(600 / 8)) * 100);
  zr.value = toR(M.zoom);
  zr.oninput = () => setZoom(8 * Math.pow(600 / 8, zr.value / 100));
  onChange((w) => w === 'zoom' && (zr.value = toR(M.zoom)));
  bar.appendChild(zr);
  btn('zoomIn', '', 'Zoomer la timeline (+)', () => setZoom(M.zoom * 1.3));
  btn('fit', '', 'Voir tout le montage', fitZoom);
  sep();
  btn('plus', 'Piste vidéo', 'Ajouter une piste vidéo (superposition)', () => E.addTrack('visual'));
  btn('plus', 'Piste audio', 'Ajouter une piste audio', () => E.addTrack('audio'));
  btn('plus', 'Piste effets', 'Ajouter une piste d’effets', () => E.addTrack('effect'));
  return bar;
}

function fitZoom() {
  const w = root.querySelector('.mt-tl-scroll')?.clientWidth || 800;
  setZoom((w - 40) / Math.max(5, projectDuration() * 1.05), 0, 0);
}

// ---------------------------------------------------------- contrôles de lecture
function buildControls() {
  controls.innerHTML = '';
  const b = (cls, ic, title, fn) => {
    const x = el('button', 'icon-btn ' + cls, icon(ic, 18));
    x.title = title;
    x.onclick = () => { fn(); x.blur(); };
    controls.appendChild(x);
    return x;
  };
  b('', 'first', 'Début (Origine)', () => seek(0));
  b('', 'chevL', 'Image précédente (←) — Maj : 1 seconde', () => step(-1));
  b('play mt-play', 'play', 'Lecture / pause (Espace)', toggle);
  b('', 'chevR', 'Image suivante (→) — Maj : 1 seconde', () => step(1));
  b('', 'last', 'Fin (Fin)', () => seek(projectDuration()));
  controls.appendChild(el('span', 'mt-time'));
  controls.appendChild(el('div', 'grow'));
  b('mt-loop', 'loop', 'Lecture en boucle (L)', () => { M.loop = !M.loop; renderControls(); });
  b('mt-mute', 'speaker', 'Couper le son de l’aperçu', () => { setPreviewMuted(!M.previewMuted); renderControls(); });
  b('mt-thirds', 'thirds', 'Grille des tiers (aide au cadrage)', () => { showThirds = !showThirds; renderControls(); drawOverlay(); });
  b('mt-safe', 'safe', 'Zones de sécurité (titres et action)', () => { showSafe = !showSafe; renderControls(); drawOverlay(); });
  b('', 'full', 'Aperçu en plein écran', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stageBox.requestFullscreen?.().catch(() => toast('Plein écran indisponible'));
  });
  renderControls();
}
function renderControls() {
  if (!controls) return;
  const q = (s) => controls.querySelector(s);
  q('.mt-play').innerHTML = icon(M.playing ? 'pause' : 'play', 18);
  q('.mt-loop').classList.toggle('on', !!M.loop);
  q('.mt-mute').innerHTML = icon(M.previewMuted ? 'speakerOff' : 'speaker', 18);
  q('.mt-mute').classList.toggle('on', !!M.previewMuted);
  q('.mt-thirds').classList.toggle('on', showThirds);
  q('.mt-safe').classList.toggle('on', showSafe);
  updateTime();
}
function updateTime() {
  const t = controls?.querySelector('.mt-time');
  if (t && M.project) t.innerHTML = `<b>${fmtTime(M.time)}</b> / ${fmtTime(projectDuration())}`;
}
function step(dir, big = false) {
  const fps = M.project.fps;
  const f = Math.round(M.time * fps) + dir * (big ? fps : 1);
  seek(Math.max(0, f / fps));
}

// ---------------------------------------------------------- aperçu (canevas)
function layoutStage() {
  if (!isMontageOpen()) return;
  const p = M.project;
  const pad = 14;
  const aw = Math.max(40, stageBox.clientWidth - pad * 2), ah = Math.max(40, stageBox.clientHeight - pad * 2);
  const k = Math.min(aw / p.width, ah / p.height);
  const w = Math.max(16, Math.floor(p.width * k)), h = Math.max(16, Math.floor(p.height * k));
  frameBox.style.width = w + 'px';
  frameBox.style.height = h + 'px';
  // pixels réels (écran HD) mais plafonnés pour garder une lecture fluide
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cap = Math.min(1, 1920 / Math.max(w * dpr, h * dpr));
  const bw = Math.max(16, Math.round(w * dpr * cap)), bh = Math.max(16, Math.round(h * dpr * cap));
  if (cv.width !== bw || cv.height !== bh) {
    cv.width = ov.width = bw;
    cv.height = ov.height = bh;
  }
  draw();
}

let pending = false;
function requestDraw() {
  if (pending || !isMontageOpen()) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    draw();
  });
}
function draw() {
  if (!isMontageOpen()) return;
  bounds = renderFrame(ctx, M.time, cv.width, cv.height);
  drawOverlay();
  updateTime();
  const empty = root.querySelector('.mt-stage-empty');
  const isEmpty = !M.project.clips.length;
  empty.classList.toggle('hidden', !isEmpty);
  if (isEmpty && !empty.firstChild) {
    empty.innerHTML = `<div>${icon('clap', 40, 1.4)}</div><b>Ton montage est vide</b><span>Importe des vidéos, images, GIF, musiques ou tes animations Animotion — ou glisse-les directement sur la fenêtre.</span>`;
    const go = el('button', 'btn primary', icon('import', 16) + ' Importer des médias');
    go.onclick = () => pickAndImport();
    empty.appendChild(go);
  }
}

// contour, poignées et guides par-dessus l'aperçu
const px = () => cv.width / Math.max(1, cv.clientWidth); // pixels du canevas par pixel d'écran
function corners(b) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const x = (i * b.w) / 2, y = (j * b.h) / 2;
    return [b.cx + x * c - y * s, b.cy + x * s + y * c];
  });
}
function rotHandle(b) {
  const d = b.h / 2 + 26 * px();
  return [b.cx + Math.sin(b.rot) * d, b.cy - Math.cos(b.rot) * d];
}
function drawOverlay() {
  if (!octx) return;
  const W = ov.width, H = ov.height, k = px();
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, W, H);
  octx.lineWidth = Math.max(1, k);
  if (showThirds) {
    octx.strokeStyle = 'rgba(255,255,255,.35)';
    octx.setLineDash([6 * k, 6 * k]);
    octx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      octx.moveTo(W * f, 0); octx.lineTo(W * f, H);
      octx.moveTo(0, H * f); octx.lineTo(W, H * f);
    }
    octx.stroke();
    octx.setLineDash([]);
  }
  if (showSafe) {
    octx.strokeStyle = 'rgba(255,236,39,.55)';
    octx.setLineDash([4 * k, 4 * k]);
    octx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    octx.strokeStyle = 'rgba(255,119,168,.55)';
    octx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
    octx.setLineDash([]);
  }
  if (guides.x != null || guides.y != null) {
    octx.strokeStyle = '#ff4fd8';
    octx.lineWidth = 1.5 * k;
    octx.beginPath();
    if (guides.x != null) { octx.moveTo(guides.x, 0); octx.lineTo(guides.x, H); }
    if (guides.y != null) { octx.moveTo(0, guides.y); octx.lineTo(W, guides.y); }
    octx.stroke();
  }
  if (M.playing && !drag) return;
  for (const b of bounds) {
    if (!M.sel.has(b.id)) continue;
    const pts = corners(b);
    octx.strokeStyle = '#2f8cff';
    octx.lineWidth = 1.6 * k;
    octx.beginPath();
    pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
    octx.closePath();
    octx.stroke();
    // poignée de rotation
    const [rx, ry] = rotHandle(b);
    const top = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    octx.beginPath();
    octx.moveTo(top[0], top[1]);
    octx.lineTo(rx, ry);
    octx.stroke();
    octx.fillStyle = '#fff';
    octx.beginPath();
    octx.arc(rx, ry, 5.5 * k, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    // poignées de taille (coins)
    const s = 9 * k;
    for (const [x, y] of pts) {
      octx.fillRect(x - s / 2, y - s / 2, s, s);
      octx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }
}

function toCanvas(e) {
  const r = ov.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * ov.width) / r.width, y: ((e.clientY - r.top) * ov.height) / r.height };
}
function toLocal(b, p) {
  const dx = p.x - b.cx, dy = p.y - b.cy, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
const inside = (b, p) => {
  const l = toLocal(b, p);
  return Math.abs(l.x) <= b.w / 2 && Math.abs(l.y) <= b.h / 2;
};
function hitAt(p) {
  const k = px(), r = 10 * k;
  const list = [...bounds].reverse(); // du dessus vers le dessous
  for (const b of list) {
    if (!M.sel.has(b.id)) continue;
    const [rx, ry] = rotHandle(b);
    if (Math.hypot(p.x - rx, p.y - ry) < r) return { b, mode: 'rot' };
    for (const [x, y] of corners(b)) if (Math.hypot(p.x - x, p.y - y) < r) return { b, mode: 'scale' };
  }
  for (const b of list) if (M.sel.has(b.id) && inside(b, p)) return { b, mode: 'move' };
  for (const b of list) if (inside(b, p)) return { b, mode: 'move' };
  return null;
}
/** Réglages modifiés à la souris : position de départ, ou d'arrivée si on est dans la 2e moitié d'un mouvement de caméra */
function editTarget(c) {
  if (c.motion?.enabled && M.time - c.start > c.duration / 2) return c.motion.to;
  return c.transform;
}

function setupOverlay() {
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (M.playing) pause();
    const p = toCanvas(e);
    const hit = hitAt(p);
    if (!hit) {
      if (M.sel.size && !e.shiftKey) {
        M.sel.clear();
        emitChange('selection');
        renderTimeline();
      }
      return;
    }
    const c = clipById(hit.b.id);
    if (!c) return;
    if (e.shiftKey) M.sel.add(c.id);
    else if (!M.sel.has(c.id)) M.sel = new Set([c.id]);
    emitChange('selection');
    renderTimeline();
    if (trackById(c.track)?.locked) return toast('Cette piste est verrouillée 🔒');
    const tf = editTarget(c);
    drag = { c, tf, mode: hit.mode, p0: p, b: hit.b, start: { x: tf.x, y: tf.y, scale: tf.scale, rotation: tf.rotation }, moved: false };
    ov.setPointerCapture(e.pointerId);
  });
  ov.addEventListener('pointermove', (e) => {
    const p = toCanvas(e);
    if (!drag) {
      const h = hitAt(p);
      ov.style.cursor = !h ? '' : h.mode === 'rot' ? 'grab' : h.mode === 'scale' ? 'nwse-resize' : 'move';
      return;
    }
    const W = ov.width, H = ov.height, { b, tf, start } = drag;
    if (Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) > 2 * px()) drag.moved = true;
    if (!drag.moved) return;
    guides = {};
    if (drag.mode === 'move') {
      let x = start.x + (p.x - drag.p0.x) / W, y = start.y + (p.y - drag.p0.y) / H;
      if (!e.altKey) {
        // aimantation : centre et bords du cadre
        // le centre affiché (b.cx) peut être décalé par une animation : on aimante ce qu'on voit
        const th = 8 * px();
        const snapAxis = (v, size, half, offset) => {
          let best = th, out = v, line = null;
          for (const [target, l] of [[size / 2, size / 2], [half, 1], [size - half, size - 1]]) {
            const d = Math.abs(v * size + offset - target);
            if (d < best) { best = d; out = (target - offset) / size; line = l; }
          }
          return [out, line];
        };
        [x, guides.x] = snapAxis(x, W, b.w / 2, b.cx - start.x * W);
        [y, guides.y] = snapAxis(y, H, b.h / 2, b.cy - start.y * H);
      }
      tf.x = x;
      tf.y = y;
    } else if (drag.mode === 'scale') {
      const d0 = Math.hypot(drag.p0.x - b.cx, drag.p0.y - b.cy), d1 = Math.hypot(p.x - b.cx, p.y - b.cy);
      tf.scale = Math.max(0.02, Math.min(20, (start.scale * d1) / Math.max(1, d0)));
    } else if (drag.mode === 'rot') {
      const a0 = Math.atan2(drag.p0.y - b.cy, drag.p0.x - b.cx), a1 = Math.atan2(p.y - b.cy, p.x - b.cx);
      let r = start.rotation + ((a1 - a0) * 180) / Math.PI;
      r = ((((r + 180) % 360) + 360) % 360) - 180;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      else if (Math.abs(r - Math.round(r / 90) * 90) < 3) r = Math.round(r / 90) * 90;
      tf.rotation = Math.round(r * 10) / 10;
    }
    draw();
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    guides = {};
    if (moved) commit();
    else draw();
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);
  ov.addEventListener('dblclick', (e) => {
    const h = hitAt(toCanvas(e));
    const c = h && clipById(h.b.id);
    if (c?.type === 'text') {
      const ta = root.querySelector('.mt-insp textarea');
      ta?.focus();
      ta?.select();
    }
  });
  // Ctrl + molette sur un clip sélectionné : taille
  ov.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !M.sel.size) return;
    e.preventDefault();
    for (const id of M.sel) {
      const c = clipById(id);
      if (!c || c.type === 'audio' || c.type === 'effect' || trackById(c.track)?.locked) continue;
      const tf = editTarget(c);
      tf.scale = Math.max(0.02, Math.min(20, tf.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    }
    draw();
    clearTimeout(ov._wheel);
    ov._wheel = setTimeout(commit, 300);
  }, { passive: false });
}

// ---------------------------------------------------------- réactions aux changements du projet
let tlPending = false;
function renderTimelineSoon() {
  if (tlPending) return;
  tlPending = true;
  requestAnimationFrame(() => {
    tlPending = false;
    if (isMontageOpen()) renderTimeline();
  });
}
onChange((what) => {
  if (!isMontageOpen()) return;
  switch (what) {
    case 'drag':
    case 'zoom':
      requestDraw();
      updateTime();
      return;
    case 'props':
      requestDraw();
      renderTimelineSoon();
      return;
    case 'selection':
      renderInspector();
      requestDraw();
      return;
    case 'media':
      renderLibrary();
      renderTimelineSoon();
      requestDraw();
      return;
    case 'format':
      layoutStage();
      updateTop();
      return;
  }
  // 'commit', 'history', 'tracks', 'all'
  if (what === 'commit' || what === 'history') setDirty(true);
  if (what === 'history') M.sel.forEach((id) => !clipById(id) && M.sel.delete(id));
  pruneElements();
  if (M.time > projectDuration()) M.time = projectDuration();
  renderTimeline();
  renderInspector();
  if (what !== 'commit') renderLibrary();
  layoutStage();
  updateTop();
});

function setDirty(v) {
  M.dirty = v;
  updateTop();
  if (v) emit('changed'); // copie de secours automatique
  updateDiscord();
}
function updateTop() {
  if (!root || !M.project) return;
  const p = M.project;
  if (document.activeElement !== nameInput) nameInput.value = M.name;
  const f = FORMATS.find(([, w, h]) => w === p.width && h === p.height);
  fmtBtn.innerHTML = `${icon('film', 14)} <b>${f ? f[0] : 'Personnalisé'}</b> ${p.width} × ${p.height} · ${p.fps} i/s`;
  dirtyDot.classList.toggle('hidden', !M.dirty);
  undoBtn.disabled = !M.undo.length;
  redoBtn.disabled = !M.redo.length;
  setWindowTitle(`${M.name}${M.dirty ? ' •' : ''} — Montage — Animotion`);
}

function doUndo() {
  if (!undo()) toast('Rien à annuler');
}
function doRedo() {
  if (!redo()) toast('Rien à rétablir');
}

// ---------------------------------------------------------- ouverture / fermeture / enregistrement
/** Complète un projet chargé avec les réglages ajoutés depuis (fichiers d'anciennes versions) */
function normalize(o) {
  const base = createProject(o.width || 1920, o.height || 1080, o.fps || 30);
  const p = { ...base, ...o, background: { ...base.background, ...(o.background || {}) } };
  p.media = Array.isArray(o.media) ? o.media : [];
  p.tracks = Array.isArray(o.tracks) && o.tracks.length ? o.tracks : base.tracks;
  p.markers = Array.isArray(o.markers) ? o.markers : [];
  p.clips = (o.clips || []).filter((c) => c && c.type && p.tracks.some((t) => t.id === c.track)).map((c) => {
    const d = makeClip(c.type, c.track);
    const n = { ...d, ...c };
    for (const k of ['transform', 'crop', 'adjust', 'filter', 'chroma', 'animIn', 'animOut', 'transition']) n[k] = { ...d[k], ...(c[k] || {}) };
    n.motion = { ...d.motion, ...(c.motion || {}), to: { ...d.motion.to, ...(c.motion?.to || {}) } };
    if (c.type === 'text') n.text = { ...TEXT_DEFAULT(), ...(c.text || {}) };
    return n;
  });
  return p;
}

/** Ouvre le mode montage : obj = projet chargé (ou null pour un nouveau), meta = { width, height, fps, path, name } */
export async function openMontage(obj = null, meta = {}) {
  if (app.doc && app.dirty && !(await confirmLoseChanges())) return false;
  if (isMontageOpen() && !(await closeMontage())) return false;
  let project;
  try {
    project = obj ? normalize(obj) : createProject(meta.width || 1920, meta.height || 1080, meta.fps || 30);
  } catch (e) {
    toast('Montage illisible : ' + (e.message || e), 'error', 6000);
    return false;
  }
  M.project = project;
  ensure();
  M.media.clear();
  M.sel.clear();
  M.path = meta.path || null;
  M.name = meta.name || 'Mon montage';
  M.time = 0;
  M.playing = false;
  M.dirty = false;
  M.zoom = 80;
  resetHistory();
  hideStart();
  root.classList.remove('hidden');
  document.body.classList.add('montage-on');
  emitChange('all');
  if (project.media.length) {
    const pr = progress('Ouverture du montage');
    await loadProjectMedia(project, (q, name) => pr.set(q, `Chargement de ${name}…`), meta.path || null);
    pr.close();
    const missing = project.media.filter((m) => M.media.get(m.id)?.missing);
    if (missing.length) toast(`⚠ ${missing.length} média${missing.length > 1 ? 's' : ''} introuvable${missing.length > 1 ? 's' : ''} (fichier déplacé ou supprimé) : ${missing.slice(0, 3).map((m) => m.name).join(', ')}`, 'error', 8000);
    emitChange('all');
  }
  requestAnimationFrame(() => {
    layoutStage();
    if (project.clips.length) fitZoom();
    else renderTimeline();
  });
  updateDiscord();
  return true;
}

async function confirmClose() {
  if (!M.dirty) return true;
  const c = await modal({
    title: 'Montage non enregistré',
    content: `<p>Le montage <b>${escapeHtml(M.name)}</b> a des modifications non enregistrées.</p>`,
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Ne pas enregistrer', value: 'discard', danger: true },
      { label: 'Enregistrer', value: 'save', primary: true },
    ],
  });
  if (c === 'save') return saveMontage();
  if (c === 'discard') {
    await clearRecovery();
    return true;
  }
  return false;
}

/** Ferme le montage (demande d'enregistrer si besoin, sauf force = true) */
export async function closeMontage(force = false) {
  if (!isMontageOpen()) return true;
  if (!force && !(await confirmClose())) return false;
  pause();
  disposeAll();
  for (const rt of M.media.values()) if (rt.url) URL.revokeObjectURL(rt.url);
  M.media.clear();
  M.sel.clear();
  M.project = null;
  M.dirty = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  root.classList.add('hidden');
  document.body.classList.remove('montage-on');
  emit('title');
  emit('ui');
  return true;
}

async function goHome() {
  if (!(await closeMontage())) return;
  showStart(true);
  emit('ui');
}

const safeName = () => (M.name || 'montage').replace(/[\\/:*?"<>|]/g, '_');
export async function saveMontage(as = false) {
  if (!isMontageOpen()) return false;
  pause();
  try {
    const obj = await serializeProject();
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const path = await saveFile(bytes, safeName() + '.animo', [{ name: 'Projet Animotion', extensions: ['animo'] }], as ? null : M.path);
    if (!path) return false;
    if (isTauri) {
      M.path = path;
      addRecent(path);
    }
    M.name = baseName(path).replace(/\.animo$/i, '');
    await clearRecovery();
    setDirty(false);
    toast('Montage enregistré 💾', 'ok');
    return true;
  } catch (err) {
    toast('Échec de l’enregistrement : ' + (err.message || err), 'error', 5000);
    return false;
  }
}

/** Ajoute l'animation ouverte dans le mode dessin / pixel à un montage (nouveau, ou celui déjà ouvert) */
export async function sendToMontage() {
  if (!app.doc) return toast('Ouvre d’abord une animation ✏️');
  const obj = app.doc.serialize();
  const name = app.fileName && app.fileName !== 'Sans titre' ? app.fileName : 'Animation';
  const ratio = app.doc.width / app.doc.height;
  const [, w, h] = FORMATS.reduce((best, f) => (Math.abs(f[1] / f[2] - ratio) < Math.abs(best[1] / best[2] - ratio) ? f : best));
  if (!(await openMontage(null, { width: w, height: h, fps: 30 }))) return;
  try {
    const m = await addAnimation(obj, name);
    E.addMediaClip(m);
    setDirty(true);
    toast(`« ${name} » est dans ton montage ! Ajoute de la musique, des textes, des transitions… 🎬`, 'ok', 5000);
  } catch (e) {
    toast('Impossible d’ajouter l’animation : ' + (e.message || e), 'error');
  }
}

/** Fichiers glissés sur la fenêtre pendant le montage */
export async function dropFiles(list) {
  const files = [];
  for (const f of list) files.push({ path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  await importMediaFiles(files);
}

// ---------------------------------------------------------- clavier
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
window.addEventListener('keydown', (e) => {
  if (!isMontageOpen() || isModalOpen() || typing(e.target)) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  let done = true;
  if (mod && e.shiftKey && ['+', '=', '-', '_', '0', ')'].includes(e.key)) return; // taille de l'interface (main.js)
  if (mod) {
    switch (k) {
      case 'z': e.shiftKey ? doRedo() : doUndo(); break;
      case 'y': doRedo(); break;
      case 's': saveMontage(e.shiftKey); break;
      case 'e': showMontageExport(); break;
      case 'o': openProject(); break;
      case 'i': pickAndImport(); break;
      case 'd': E.duplicateSelected(); break;
      case 'c': E.copySelected(); break;
      case 'x': E.copySelected(); E.removeSelected(false); break;
      case 'v': E.paste(); break;
      case 'b': E.split(); break;
      case 'a':
        M.sel = new Set(M.project.clips.map((c) => c.id));
        emitChange('selection');
        renderTimeline();
        break;
      default: done = false;
    }
  } else if (!e.altKey) {
    switch (e.key) {
      case ' ': case 'k': case 'K': toggle(); break;
      case 's': case 'S': E.split(); break;
      case 'Delete': case 'Backspace': E.removeSelected(e.shiftKey); break;
      case 'ArrowLeft': step(-1, e.shiftKey); break;
      case 'ArrowRight': step(1, e.shiftKey); break;
      case 'Home': seek(0); break;
      case 'End': seek(projectDuration()); break;
      case 'm': case 'M': E.toggleMarker(); break;
      case 'l': case 'L': M.loop = !M.loop; renderControls(); toast(M.loop ? 'Lecture en boucle 🔁' : 'Boucle désactivée'); break;
      case 't': case 'T': E.addText('titre'); break;
      case '+': case '=': setZoom(M.zoom * 1.3); break;
      case '-': setZoom(M.zoom / 1.3); break;
      case 'Escape':
        M.sel.clear();
        emitChange('selection');
        renderTimeline();
        break;
      case 'F1': showMontageHelp(); break;
      default: done = false;
    }
  } else done = false;
  if (done) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
  }
}, true);

function showMontageHelp() {
  const rows = [
    ['Espace / K', 'Lecture / pause'], ['← / →', 'Image précédente / suivante (Maj : 1 s)'], ['Origine / Fin', 'Début / fin du montage'],
    ['S ou Ctrl+B', 'Couper à la tête de lecture'], ['Suppr', 'Supprimer (Maj+Suppr : supprimer et resserrer)'],
    ['Ctrl+D', 'Dupliquer'], ['Ctrl+C / X / V', 'Copier / couper / coller'], ['Ctrl+A', 'Tout sélectionner'], ['Échap', 'Désélectionner'],
    ['M', 'Marqueur'], ['L', 'Lecture en boucle'], ['T', 'Ajouter un titre'], ['+ / −', 'Zoom de la timeline (ou Ctrl + molette)'],
    ['Ctrl+I', 'Importer des médias'], ['Ctrl+S', 'Enregistrer (Ctrl+Maj+S : sous)'], ['Ctrl+E', 'Exporter'], ['Ctrl+Z / Y', 'Annuler / rétablir'],
    ['Aperçu', 'Glisse un clip pour le déplacer, les coins pour la taille, le rond pour tourner (Maj : par 15°, Alt : sans aimant)'],
    ['Ctrl + molette', 'Sur l’aperçu : taille du clip sélectionné'], ['Timeline', 'Glisse les bords d’un clip pour le raccourcir, Maj+clic pour en sélectionner plusieurs'],
  ];
  modal({
    title: 'Raccourcis du montage ⌨️',
    wide: true,
    content: `<div class="mt-keys-list">${rows.map(([a, b]) => `<div class="sc-row"><kbd>${escapeHtml(a)}</kbd><span>${escapeHtml(b)}</span></div>`).join('')}</div>`,
  });
}

// ---------------------------------------------------------- pipette (couleur du fond vert)
/** Attend un clic sur l'aperçu et renvoie la couleur à cet endroit, le clip étant affiché sans incrustation */
function pickColor(c) {
  if (!isMontageOpen()) return Promise.resolve(null);
  pause();
  const was = c.chroma.enabled;
  c.chroma.enabled = false;
  draw();
  ov.classList.add('picking');
  toast('🎯 Clique sur la couleur du fond à retirer dans l’aperçu (Échap pour annuler)', 'info', 4000);
  return new Promise((resolve) => {
    const finish = (hex) => {
      ov.classList.remove('picking');
      ov.removeEventListener('pointerdown', onPick, true);
      window.removeEventListener('keydown', onKey, true);
      c.chroma.enabled = was;
      draw();
      resolve(hex);
    };
    const onPick = (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      const p = toCanvas(e);
      const [r, g, b] = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      finish('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      finish(null);
    };
    ov.addEventListener('pointerdown', onPick, true);
    window.addEventListener('keydown', onKey, true);
  });
}

// ---------------------------------------------------------- accès pour la copie de secours, la fermeture, Discord et Claude
hooks.montage = {
  isOpen: isMontageOpen,
  dirty: () => isMontageOpen() && !!M.dirty,
  setDirty,
  name: () => M.name,
  path: () => M.path,
  info: () => ({ width: M.project.width, height: M.project.height, clips: M.project.clips.length, duration: projectDuration(), playing: M.playing }),
  snapshot: () => M.project,
  save: () => saveMontage(),
  close: (force) => closeMontage(force),
  pickColor,
};
