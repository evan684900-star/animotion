import { app, curLayer, curFrame, refreshUI, emit, store, markDirty } from './state.js';
import { Doc, newId } from './doc.js';
import { structural, clearHistory } from './history.js';
import { requestRender, fitView } from './view.js';
import { commitFloating, applyToSelection, setTool } from './tools.js';
import { toast, form, modal, confirmDialog } from './dialogs.js';
import { saveFile, openFile, readPath, isTauri, setWindowTitle } from './platform.js';
import { ctx2d, makeCanvas, loadImage, bytesToDataURL, mimeFromName, baseName, normalizeHex } from './util.js';
import { PALETTES, SIZE_PRESETS } from './palettes.js';
import { showStart, hideStart } from './start.js';
import { clearRecovery } from './recovery.js';

// ------------------------------------------------------------ Couleurs
export function setColor(hex, secondary = false) {
  hex = normalizeHex(hex);
  if (!hex) return;
  if (secondary) app.color2 = hex;
  else {
    app.color = hex;
    applyToSelection('stroke', hex);
  }
  refreshUI();
}
export function swapColors() {
  [app.color, app.color2] = [app.color2, app.color];
  refreshUI();
}
export function recentColor(hex) {
  app.recentColors = [hex, ...app.recentColors.filter((c) => c !== hex)].slice(0, 16);
  refreshUI();
}
export function loadPalette(name) {
  const p = PALETTES[name];
  if (!p) return;
  app.palette = [...p.colors];
  app.paletteName = name;
  app.color = p.colors[Math.min(p.colors.length - 1, 2)];
  refreshUI();
  toast(`Palette « ${name} » chargée 🎨`);
}
export function addToPalette(hex = app.color) {
  if (app.palette.includes(hex)) return toast('Cette couleur est déjà dans la palette');
  app.palette.push(hex);
  refreshUI();
}
export function removeFromPalette(hex) {
  app.palette = app.palette.filter((c) => c !== hex);
  refreshUI();
}
export function setSize(v) {
  if (app.mode === 'pixel') app.pixelSize = Math.max(1, Math.min(64, Math.round(v)));
  else {
    app.vectorSize = Math.max(0.5, Math.min(200, v));
    applyToSelection('width', app.vectorSize);
  }
  requestRender();
}

// ------------------------------------------------------------ Navigation
export function setFrame(i) {
  const n = app.doc.frames.length;
  i = Math.max(0, Math.min(n - 1, i));
  if (i === app.frameIndex) return;
  commitFloating();
  app.frameIndex = i;
  app.vsel.clear();
  requestRender();
  refreshUI();
}
export function setLayer(i) {
  i = Math.max(0, Math.min(app.doc.layers.length - 1, i));
  if (i === app.layerIndex) return;
  commitFloating();
  app.layerIndex = i;
  app.vsel.clear();
  requestRender();
  refreshUI();
}

// ------------------------------------------------------------ Calques
export function addLayer() {
  structural(() => {
    const d = app.doc;
    const l = d.makeLayer('Calque ' + (d.layers.length + 1));
    d.layers.splice(app.layerIndex + 1, 0, l);
    app.layerIndex++;
  });
}
export function duplicateLayer() {
  structural(() => {
    const d = app.doc;
    const src = curLayer();
    const l = { ...structuredClone(src), id: newId(), name: src.name + ' (copie)' };
    for (const f of d.frames) {
      const c = d.cels.get(d.key(src.id, f.id));
      if (c) {
        d.cels.set(d.key(l.id, f.id), d.copyCel(c));
        d.flags.set(d.key(l.id, f.id), d.flags.get(d.key(src.id, f.id)));
      }
    }
    d.layers.splice(app.layerIndex + 1, 0, l);
    app.layerIndex++;
  });
}
export function deleteLayer() {
  if (app.doc.layers.length < 2) return toast('Il faut garder au moins un calque');
  structural(() => {
    const d = app.doc;
    d.removeCels({ layerId: curLayer().id });
    d.layers.splice(app.layerIndex, 1);
    app.layerIndex = Math.max(0, app.layerIndex - 1);
  });
}
export function mergeDown() {
  if (app.layerIndex === 0) return toast('Aucun calque en dessous pour fusionner');
  structural(() => {
    const d = app.doc;
    const top = curLayer(), bottom = d.layers[app.layerIndex - 1];
    for (const f of d.frames) {
      const src = d.cels.get(d.key(top.id, f.id));
      if (!src) continue;
      const dst = d.getCel(bottom.id, f.id);
      if (d.mode === 'pixel') {
        const x = ctx2d(dst);
        x.globalAlpha = top.opacity;
        x.drawImage(src, 0, 0);
        x.globalAlpha = 1;
        d.updateFlag(bottom.id, f.id);
      } else dst.shapes.push(...structuredClone(src.shapes));
    }
    d.removeCels({ layerId: top.id });
    d.layers.splice(app.layerIndex, 1);
    app.layerIndex--;
  });
}
export function moveLayer(dir) {
  const i = app.layerIndex, j = i + dir;
  if (j < 0 || j >= app.doc.layers.length) return;
  structural(() => {
    const L = app.doc.layers;
    [L[i], L[j]] = [L[j], L[i]];
    app.layerIndex = j;
  });
}
export async function renameLayer(i = app.layerIndex) {
  const l = app.doc.layers[i];
  const r = await form('Renommer le calque', [{ name: 'name', label: 'Nom', value: l.name }], 'Renommer');
  if (!r || !r.name.trim()) return;
  structural(() => {
    app.doc.layers[i].name = r.name.trim().slice(0, 40);
  });
}
export function toggleLayerProp(i, prop) {
  structural(() => {
    const l = app.doc.layers[i];
    l[prop] = !l[prop];
  });
}
export function setLayerOpacity(v, final = false) {
  curLayer().opacity = Math.max(0, Math.min(1, v));
  markDirty();
  requestRender();
  if (final) refreshUI();
}

// ------------------------------------------------------------ Frames
export function addFrame() {
  structural(() => {
    app.doc.frames.splice(app.frameIndex + 1, 0, app.doc.makeFrame());
    app.frameIndex++;
  });
}
export function duplicateFrame() {
  structural(() => {
    const d = app.doc;
    const src = curFrame();
    const f = d.makeFrame(src.duration);
    for (const l of d.layers) {
      const c = d.cels.get(d.key(l.id, src.id));
      if (c) {
        d.cels.set(d.key(l.id, f.id), d.copyCel(c));
        d.flags.set(d.key(l.id, f.id), d.flags.get(d.key(l.id, src.id)));
      }
    }
    d.frames.splice(app.frameIndex + 1, 0, f);
    app.frameIndex++;
  });
}
export function deleteFrame() {
  if (app.doc.frames.length < 2) return toast('Il faut garder au moins une frame');
  structural(() => {
    const d = app.doc;
    d.removeCels({ frameId: curFrame().id });
    d.frames.splice(app.frameIndex, 1);
    app.frameIndex = Math.min(app.frameIndex, d.frames.length - 1);
  });
}
export function moveFrame(dir) {
  const i = app.frameIndex, j = i + dir;
  if (j < 0 || j >= app.doc.frames.length) return;
  structural(() => {
    const F = app.doc.frames;
    [F[i], F[j]] = [F[j], F[i]];
    app.frameIndex = j;
  });
}
export async function setFrameDuration(i = app.frameIndex) {
  const f = app.doc.frames[i];
  const r = await form(`Durée de la frame ${i + 1}`, [
    { name: 'ms', label: 'Durée en millisecondes (vide = automatique selon les FPS)', type: 'number', value: f.duration ?? '', min: 10, max: 60000, placeholder: Math.round(1000 / app.doc.fps) + ' (auto)' },
  ], 'Appliquer');
  if (!r) return;
  structural(() => {
    app.doc.frames[i].duration = r.ms ? Math.max(10, Math.round(r.ms)) : null;
  });
}
export function setFps(v) {
  v = Math.max(1, Math.min(60, Math.round(v) || 12));
  if (v === app.doc.fps) return;
  structural(() => {
    app.doc.fps = v;
  });
}

// ------------------------------------------------------------ Lecture
let raf = null, last = 0, acc = 0, dir = 1;
export function togglePlay() {
  if (app.playing) stopPlay();
  else startPlay();
}
export function startPlay() {
  if (app.doc.frames.length < 2) return toast('Ajoute au moins 2 frames pour lancer l’animation 🎬');
  commitFloating();
  app.playing = true;
  last = performance.now();
  acc = 0;
  dir = 1;
  raf = requestAnimationFrame(tick);
  refreshUI();
  requestRender();
}
export function stopPlay() {
  if (!app.playing) return;
  app.playing = false;
  cancelAnimationFrame(raf);
  refreshUI();
  requestRender();
}
function tick(t) {
  acc += t - last;
  last = t;
  const n = app.doc.frames.length;
  let guard = 0;
  while (acc >= app.doc.duration(app.frameIndex) && guard++ < 100) {
    acc -= app.doc.duration(app.frameIndex);
    let i = app.frameIndex;
    if (app.playMode === 'pingpong') {
      if (i + dir < 0 || i + dir >= n) dir = -dir;
      i += dir;
    } else if (app.playMode === 'once') {
      if (i >= n - 1) return stopPlay();
      i++;
    } else i = (i + 1) % n;
    app.frameIndex = Math.max(0, Math.min(n - 1, i));
    emit('frame');
  }
  requestRender();
  raf = requestAnimationFrame(tick);
}

// ------------------------------------------------------------ Projet / fichiers
export function updateTitle() {
  const name = app.doc ? app.fileName + (app.dirty ? ' •' : '') + ' — Animotion' : 'Animotion';
  setWindowTitle(name);
}

export function setDoc(doc, meta = {}) {
  stopPlay();
  app.doc = doc;
  app.mode = doc.mode;
  app.layerIndex = doc.layers.length - 1;
  app.frameIndex = 0;
  app.tool = doc.mode === 'pixel' ? 'pencil' : 'brush';
  app.sel = null;
  app.floating = null;
  app.vsel.clear();
  app.filePath = meta.path || null;
  app.fileName = meta.name || 'Sans titre';
  app.dirty = false;
  app.render.scale = doc.mode === 'pixel' ? (doc.width <= 64 ? 8 : doc.width <= 256 ? 4 : 1) : 1;
  app.gridMajor = doc.mode === 'pixel' ? (doc.width <= 64 ? 8 : 16) : 8;
  clearHistory();
  hideStart();
  fitView();
  refreshUI();
  requestRender();
  updateTitle();
}

export function createProject(mode, w, h, fps) {
  setDoc(Doc.create(mode, w, h, fps));
  toast(mode === 'pixel' ? `Nouvelle grille ${w} × ${h} prête, à tes pixels ! 👾` : `Nouveau dessin ${w} × ${h}, à tes crayons ! ✏️`);
}

async function confirmLoseChanges() {
  if (!app.doc || !app.dirty) return true;
  const c = await modal({
    title: 'Modifications non enregistrées',
    content: `<p>Le projet <b>${app.fileName.replace(/[<>&]/g, '')}</b> a des modifications non enregistrées.</p>`,
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Ne pas enregistrer', value: 'discard', danger: true },
      { label: 'Enregistrer', value: 'save', primary: true },
    ],
  });
  if (c === 'save') return saveProject();
  if (c === 'discard') {
    await clearRecovery();
    return true;
  }
  return false;
}

export async function newProject() {
  if (!(await confirmLoseChanges())) return;
  showStart(true);
}

export async function saveProject(as = false) {
  commitFloating();
  const json = JSON.stringify(app.doc.serialize());
  const bytes = new TextEncoder().encode(json);
  try {
    const path = await saveFile(bytes, (app.fileName || 'animation') + '.animo', [{ name: 'Projet Animotion', extensions: ['animo'] }], as ? null : app.filePath);
    if (!path) return false;
    if (isTauri) {
      app.filePath = path;
      addRecent(path);
    }
    app.fileName = baseName(path).replace(/\.animo$/i, '');
    app.dirty = false;
    await clearRecovery();
    updateTitle();
    refreshUI();
    toast('Projet enregistré 💾', 'ok');
    return true;
  } catch (err) {
    toast('Échec de l’enregistrement : ' + (err.message || err), 'error', 5000);
    return false;
  }
}

export async function openProject(path = null) {
  if (!(await confirmLoseChanges())) return;
  try {
    const f = path ? await readPath(path) : await openFile([{ name: 'Projet Animotion', extensions: ['animo'] }]);
    if (!f) return;
    const obj = JSON.parse(new TextDecoder().decode(f.bytes));
    const doc = await Doc.load(obj);
    setDoc(doc, { path: f.path, name: f.name.replace(/\.animo$/i, '') });
    if (f.path) addRecent(f.path);
    toast('Projet ouvert 📂', 'ok');
  } catch (err) {
    if (path) removeRecent(path);
    toast('Impossible d’ouvrir : ' + (err.message || err), 'error', 5000);
  }
}

export const getRecents = () => (store('recent') || []).filter(Boolean);
function addRecent(path) {
  store('recent', [path, ...getRecents().filter((p) => p !== path)].slice(0, 8));
}
function removeRecent(path) {
  store('recent', getRecents().filter((p) => p !== path));
  refreshUI();
}

// ------------------------------------------------------------ Import
const IMG_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }];

async function pickImage() {
  const f = await openFile(IMG_FILTERS);
  if (!f) return null;
  const url = await bytesToDataURL(f.bytes, mimeFromName(f.name));
  const img = await loadImage(url);
  return { img, url, name: f.name };
}

function imageShape(url, iw, ih, x, y, w, h) {
  return { id: newId(), img: url, iw, ih, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
}

export async function importImage() {
  commitFloating();
  if (curLayer().locked) return toast('Ce calque est verrouillé 🔒', 'warn');
  let res;
  try {
    res = await pickImage();
  } catch (e) {
    return toast(e.message, 'error');
  }
  if (!res) return;
  const { img, url } = res;
  const d = app.doc;
  let mode = 'keep';
  if (img.width > d.width || img.height > d.height) {
    mode = await modal({
      title: 'Image plus grande que le canevas',
      content: `<p>L’image fait ${img.width} × ${img.height}, le canevas ${d.width} × ${d.height}. Que veux-tu faire ?</p>`,
      buttons: [
        { label: 'Rogner', value: 'keep' },
        { label: 'Réduire l’image', value: 'fit' },
        { label: 'Agrandir le canevas', value: 'grow', primary: true },
      ],
    });
    if (!mode) return;
  }
  structural(() => {
    if (mode === 'grow') d.resize(Math.max(d.width, img.width), Math.max(d.height, img.height), 'topleft');
    let w = img.width, h = img.height;
    if (mode === 'fit') {
      const s = Math.min(d.width / w, d.height / h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    const x = Math.round((d.width - w) / 2), y = Math.round((d.height - h) / 2);
    const cel = d.getCel(curLayer().id, curFrame().id);
    if (d.mode === 'pixel') {
      const c = ctx2d(cel);
      c.imageSmoothingEnabled = false;
      c.drawImage(img, x, y, w, h);
      d.updateFlag(curLayer().id, curFrame().id);
    } else cel.shapes.push(imageShape(url, img.width, img.height, x, y, w, h));
  });
  if (mode === 'grow') fitView();
  toast('Image importée 🖼️', 'ok');
}

export async function importSpritesheet() {
  commitFloating();
  if (curLayer().locked) return toast('Ce calque est verrouillé 🔒', 'warn');
  let res;
  try {
    res = await pickImage();
  } catch (e) {
    return toast(e.message, 'error');
  }
  if (!res) return;
  const { img } = res;
  const d = app.doc;
  const guess = img.width > img.height ? img.height : img.width;
  const r = await form('Découper la spritesheet', [
    { name: 'fw', label: 'Largeur d’une frame (px)', type: 'number', value: Math.min(guess, img.width), min: 1 },
    { name: 'fh', label: 'Hauteur d’une frame (px)', type: 'number', value: Math.min(guess, img.height), min: 1 },
    { name: 'count', label: 'Nombre de frames (vide = toutes)', type: 'number', value: '', min: 1 },
    { name: 'resize', label: 'Adapter le canevas à la taille d’une frame', type: 'checkbox', value: d.width !== guess || d.height !== guess },
  ], 'Importer');
  if (!r || !r.fw || !r.fh) return;
  const cols = Math.floor(img.width / r.fw), rows = Math.floor(img.height / r.fh);
  const total = Math.min(cols * rows, r.count || Infinity);
  if (!total) return toast('Taille de frame trop grande pour cette image', 'error');
  structural(() => {
    if (r.resize) d.resize(r.fw, r.fh, 'topleft');
    const layer = curLayer();
    for (let k = 0; k < total; k++) {
      const fi = app.frameIndex + k;
      if (fi >= d.frames.length) d.frames.push(d.makeFrame());
      const frame = d.frames[fi];
      const sx = (k % cols) * r.fw, sy = Math.floor(k / cols) * r.fh;
      const tile = makeCanvas(r.fw, r.fh);
      tile.getContext('2d').drawImage(img, sx, sy, r.fw, r.fh, 0, 0, r.fw, r.fh);
      const cel = d.getCel(layer.id, frame.id);
      if (d.mode === 'pixel') {
        const c = ctx2d(cel);
        c.clearRect(0, 0, d.width, d.height);
        c.drawImage(tile, 0, 0);
        d.updateFlag(layer.id, frame.id);
      } else {
        cel.shapes = [imageShape(tile.toDataURL(), r.fw, r.fh, 0, 0, r.fw, r.fh)];
      }
    }
  });
  if (r.resize) fitView();
  toast(`${total} frames importées 🎞️`, 'ok');
}

// ------------------------------------------------------------ Canevas / presets
export async function resizeCanvasDialog(w = null, h = null) {
  const d = app.doc;
  const r = await form('Taille du canevas', [
    { name: 'w', label: 'Largeur', type: 'number', value: w ?? d.width, min: 1, max: 8192 },
    { name: 'h', label: 'Hauteur', type: 'number', value: h ?? d.height, min: 1, max: 8192 },
    { name: 'anchor', label: 'Ancrage du contenu', type: 'select', value: 'center', options: [['center', 'Centre'], ['topleft', 'Haut-gauche']] },
  ], 'Redimensionner');
  if (!r || !r.w || !r.h) return;
  const nw = Math.max(1, Math.min(8192, Math.round(r.w))), nh = Math.max(1, Math.min(8192, Math.round(r.h)));
  if (nw === d.width && nh === d.height) return;
  structural(() => d.resize(nw, nh, r.anchor));
  app.sel = null;
  fitView();
  toast(`Canevas : ${nw} × ${nh}`);
}
export const sizePresets = () => SIZE_PRESETS[app.mode];

export const getBrushes = () => store('brushes') || [];
export async function saveBrush() {
  const r = await form('Enregistrer le pinceau', [{ name: 'name', label: 'Nom du preset', value: `${app.mode === 'pixel' ? 'Pixel' : 'Trait'} ${app.mode === 'pixel' ? app.pixelSize : app.vectorSize}px` }], 'Enregistrer');
  if (!r || !r.name.trim()) return;
  const b = { name: r.name.trim().slice(0, 24), mode: app.mode, tool: app.tool === 'select' ? (app.mode === 'pixel' ? 'pencil' : 'brush') : app.tool, size: app.mode === 'pixel' ? app.pixelSize : app.vectorSize, color: app.color, fill: app.fillShapes };
  store('brushes', [...getBrushes(), b]);
  refreshUI();
  toast('Pinceau enregistré ⭐', 'ok');
}
export function applyBrush(b) {
  if (b.mode !== app.mode) return toast('Ce pinceau est pour l’autre mode');
  setTool(b.tool);
  if (b.mode === 'pixel') app.pixelSize = b.size;
  else app.vectorSize = b.size;
  app.color = b.color;
  app.fillShapes = !!b.fill;
  refreshUI();
  requestRender();
}
export function deleteBrush(i) {
  const list = getBrushes();
  list.splice(i, 1);
  store('brushes', list);
  refreshUI();
}

// ------------------------------------------------------------ Affichage
export function setAccent(hex) {
  app.accent = hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  store('accent', hex);
  requestRender();
  refreshUI();
}
export function toggle(key) {
  app[key] = !app[key];
  if (key === 'showRulers') document.getElementById('stage').classList.toggle('no-rulers', !app.showRulers);
  if (key === 'showRulers') window.dispatchEvent(new Event('resize'));
  requestRender();
  refreshUI();
}
export function toggleOnion() {
  app.onion.enabled = !app.onion.enabled;
  requestRender();
  refreshUI();
}
