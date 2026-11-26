import { app, on, emit, store, refreshUI, montageOpen } from './state.js';
import { resizeViewport, zoomStep, fitView, setZoom, requestRender, screenToDoc, toLocal } from './view.js';
import * as Tl from './tools.js';
import * as A from './actions.js';
import { undo, redo } from './history.js';
import { initRibbon } from './ribbon.js';
import { initPanels, renderStatus } from './panels.js';
import { initTimeline } from './timeline.js';
import { showStart } from './start.js';
import { isModalOpen, toast } from './dialogs.js';
import { showShortcuts, showTutorial } from './help.js';
import { toggleFullscreen, portableReady } from './platform.js';
import { LOGO } from './icons.js';
import { initLayout, toggleLayout, setUiScale, layout } from './layout.js';
import { checkForUpdate, showWhatsNew } from './update.js';
import { initRecovery, checkRecovery } from './recovery.js';
import { importSpriteScript } from './sprites.js';
import { initDiscord } from './discord.js';
import { initMcp } from './mcp.js';
import { showExportDialog } from './exportdialog.js';

// Glisser-déposer : un .js ou .json de sprites, ou un projet .animo
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f || isModalOpen()) return;
  // mode montage : tous les fichiers deviennent des médias (sauf un autre projet de montage)
  if (montageOpen()) {
    const { dropFiles } = await import('./montage/index.js');
    if (e.dataTransfer.files.length === 1 && f.name.toLowerCase().endsWith('.animo')) {
      const file = { path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
      try {
        if (JSON.parse(new TextDecoder().decode(file.bytes)).mode === 'montage') return A.openProjectBytes(file);
      } catch {}
    }
    return dropFiles(e.dataTransfer.files);
  }
  const name = f.name.toLowerCase();
  const file = { path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
  if (/\.(js|mjs|json|txt)$/.test(name)) importSpriteScript(file);
  else if (name.endsWith('.animo')) A.openProjectBytes(file);
  else if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) {
    if (!app.doc || !document.getElementById('startScreen').classList.contains('hidden')) return toast('Crée ou ouvre d’abord un projet, puis glisse ton image dessus 🖼️');
    A.importImage(file);
  } else if (/\.(mp4|webm|mov|m4v|mkv|ogv|avi|mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/.test(name)) {
    // une vidéo ou un son : on démarre un montage avec
    const { openMontage, dropFiles } = await import('./montage/index.js');
    if (await openMontage(null, {})) dropFiles(e.dataTransfer.files);
  } else toast('Glisse une image, une vidéo, un son, un fichier .js (sprites) ou un projet .animo');
});

document.querySelector('.brand-logo').innerHTML = LOGO;

const accent = store('accent');
if (accent) A.setAccent(accent);

initLayout();
initRecovery();
initDiscord();
initMcp();
initRibbon();
initPanels();
initTimeline();
on('title', A.updateTitle);
on('ui', A.updateTitle);

// ------------------------------------------------------------ Zone de dessin
const vp = document.getElementById('viewport');
new ResizeObserver(() => resizeViewport()).observe(vp.parentElement);
window.addEventListener('resize', () => resizeViewport());

let spaceDown = false;
let pan = null;

vp.addEventListener('contextmenu', (e) => e.preventDefault());
vp.addEventListener('pointerdown', (e) => {
  if (!app.doc) return;
  vp.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceDown || (app.tool === 'hand' && e.button === 0)) {
    const l0 = toLocal(e.clientX, e.clientY);
    pan = { x: l0.x, y: l0.y, px: app.panX, py: app.panY };
    vp.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  if (app.playing) A.stopPlay();
  Tl.pointerDown(e);
});
vp.addEventListener('pointermove', (e) => {
  if (!app.doc) return;
  if (pan) {
    const l = toLocal(e.clientX, e.clientY);
    app.panX = pan.px + l.x - pan.x;
    app.panY = pan.py + l.y - pan.y;
    if (app.mode === 'pixel') {
      app.panX = Math.round(app.panX);
      app.panY = Math.round(app.panY);
    }
    requestRender();
    return;
  }
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) Tl.pointerMove(ev);
  if (!spaceDown && !Tl.isDrawing()) vp.style.cursor = Tl.cursorAt(screenToDoc(e.clientX, e.clientY));
  renderStatus();
});
const endPointer = (e) => {
  if (pan) {
    pan = null;
    vp.style.cursor = spaceDown || app.tool === 'hand' ? 'grab' : '';
    return;
  }
  Tl.pointerUp(e);
};
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('pointerleave', () => {
  if (!Tl.isDrawing()) {
    app.hover = null;
    requestRender();
    renderStatus();
  }
});
vp.addEventListener('wheel', (e) => {
  if (!app.doc) return;
  e.preventDefault();
  const r = vp.getBoundingClientRect();
  if (e.shiftKey) {
    app.panX -= e.deltaY;
    requestRender();
    return;
  }
  const l = toLocal(e.clientX, e.clientY);
  zoomStep(e.deltaY < 0 ? 1 : -1, l.x, l.y);
}, { passive: false });

// ------------------------------------------------------------ Clavier
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
    return;
  }
  if (isModalOpen() || typing(e.target)) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['+', '=', '-', '_', '0', ')'].includes(e.key)) {
    e.preventDefault();
    setUiScale(e.key === '0' || e.key === ')' ? 1 : layout.ui + (e.key === '-' || e.key === '_' ? -0.1 : 0.1));
    return;
  }
  if (montageOpen()) return; // le montage a ses propres raccourcis
  if (e.key === 'F1' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    toggleLayout('ribbon');
    return;
  }
  if (!app.doc) return;
  if (!document.getElementById('startScreen').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const map = {
      z: () => (e.shiftKey ? redo() : undo()), y: redo,
      s: () => A.saveProject(e.shiftKey), o: () => A.openProject(), n: A.newProject, e: () => showExportDialog(),
      c: () => Tl.copySel(), x: Tl.cutSel, v: Tl.paste, a: Tl.selectAll, d: Tl.deselect,
      g: () => A.toggle('showGrid'), r: () => A.toggle('showRulers'),
      '=': () => zoomStep(1), '+': () => zoomStep(1), '-': () => zoomStep(-1), '0': fitView, '1': () => setZoom(1),
    };
    if (map[k]) {
      e.preventDefault();
      map[k]();
    }
    return;
  }
  if (e.altKey) return;
  const step = e.shiftKey ? 10 : 1;
  const tools = { v: 'pointer', h: 'hand', b: 'pencil', e: 'eraser', g: 'bucket', i: 'picker', l: 'line', r: 'rect', o: 'ellipse', m: 'select' };
  if (k === ' ') {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      vp.style.cursor = 'grab';
    }
    return;
  }
  if (tools[k] && !e.shiftKey) return Tl.setTool(tools[k]);
  switch (k) {
    case 'x': return A.swapColors();
    case '[': A.setSize((app.mode === 'pixel' ? app.pixelSize : app.vectorSize) - (app.mode === 'pixel' ? 1 : 1)); return refreshUI();
    case ']': A.setSize((app.mode === 'pixel' ? app.pixelSize : app.vectorSize) + 1); return refreshUI();
    case 'delete': case 'backspace': e.preventDefault(); return Tl.deleteSel();
    case 'escape': return Tl.deselect();
    case 'enter':
      e.preventDefault();
      if (app.floating) {
        Tl.commitFloating();
        return refreshUI();
      }
      return A.togglePlay();
    case ',': return A.setFrame(app.frameIndex - 1);
    case '.': return A.setFrame(app.frameIndex + 1);
    case 'n': return e.shiftKey ? A.duplicateFrame() : A.addFrame();
    case 'u': return A.toggleOnion();
    case 'h': return e.shiftKey && Tl.transform('flipH');
    case 'v': return e.shiftKey && Tl.transform('flipV');
    case 'f1': e.preventDefault(); return showShortcuts();
    case 'arrowleft': e.preventDefault(); if (!Tl.nudge(-step, 0)) A.setFrame(app.frameIndex - 1); return;
    case 'arrowright': e.preventDefault(); if (!Tl.nudge(step, 0)) A.setFrame(app.frameIndex + 1); return;
    case 'arrowup': e.preventDefault(); if (!Tl.nudge(0, -step)) A.setLayer(app.layerIndex + 1); return;
    case 'arrowdown': e.preventDefault(); if (!Tl.nudge(0, step)) A.setLayer(app.layerIndex - 1); return;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    if (!pan) vp.style.cursor = '';
  }
});
window.addEventListener('blur', () => {
  spaceDown = false;
});

// Empêche le menu contextuel du navigateur (WebView) sauf dans les champs
document.addEventListener('contextmenu', (e) => {
  if (!typing(e.target)) e.preventDefault();
});

// ------------------------------------------------------------ Démarrage
resizeViewport();
showStart();
emit('ui');
// Au démarrage : d'abord récupérer un éventuel dessin perdu, puis tutoriel ou nouveautés / mise à jour
setTimeout(async () => {
  const p = await portableReady;
  if (p?.created) toast(`🔌 Mode portable activé : tes projets, exports, médias et copies de secours sont rangés dans ${p.root}`, 'ok', 8000);
  const recovered = await checkRecovery();
  if (!store('tutoDone')) {
    if (!recovered) await showTutorial();
    return;
  }
  if (!(await showWhatsNew())) checkForUpdate(true);
}, 500);

// accès debug / tests
window.__animotion = { app, A, Tl };
