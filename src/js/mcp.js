// Claude pilote Animotion (MCP) : exécution des actions reçues du pont `Animotion.exe --mcp`
import { app, curLayer, refreshUI } from './state.js';
import { isTauri } from './platform.js';
import * as A from './actions.js';
import * as X from './export.js';
import { Doc, normalizeShape, newId } from './doc.js';
import { structural, pushHistory, celEntry, undo, redo } from './history.js';
import { compositeFrame } from './render.js';
import { requestRender } from './view.js';
import { commitFloating, TOOL_DEFS, setTool } from './tools.js';
import { ghostOn, clickOn, animateSteps, moveTo, docToScreen } from './ghost.js';
import { bbox, shapePath } from './render.js';
import { renderAdjust } from './imageedit.js';
import { fitView, setZoom } from './view.js';
import { PALETTES } from './palettes.js';
import { toast, modal } from './dialogs.js';
import { parseLooseJSON, ctx2d, el, escapeHtml, makeCanvas, cloneCanvas, normalizeHex } from './util.js';

const T = window.__TAURI__;

class UserError extends Error {}
const need = (cond, msg) => {
  if (!cond) throw new UserError(msg);
};
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const onStart = () => !document.getElementById('startScreen').classList.contains('hidden');
const requireDoc = () => need(app.doc && !onStart(), 'Aucun projet ouvert : utilise new_project ou open_animo.');
const requireMode = (m) => need(app.doc.mode === m, m === 'pixel'
  ? 'Ce projet est en mode dessin vectoriel : utilise draw_shapes.'
  : 'Ce projet est en pixel art : utilise draw_pixels.');

function layerIdx(v) {
  const d = app.doc;
  if (v === undefined || v === null || v === '') return app.layerIndex;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const i = +v;
    need(i >= 0 && i < d.layers.length, `Calque ${v} inexistant (index de 0 à ${d.layers.length - 1}).`);
    return i;
  }
  const i = d.layers.findIndex((l) => l.id === v || l.name.toLowerCase() === String(v).toLowerCase());
  need(i >= 0, `Calque « ${v} » introuvable.`);
  return i;
}
function frameIdx(v) {
  const d = app.doc;
  if (v === undefined || v === null || v === '') return app.frameIndex;
  const i = Math.round(+v);
  need(Number.isFinite(i) && i >= 0 && i < d.frames.length, `Frame ${v} inexistante (index de 0 à ${d.frames.length - 1}).`);
  return i;
}
function editableLayer(li) {
  const l = app.doc.layers[li];
  need(!l.locked, `Le calque « ${l.name} » est verrouillé.`);
  return l;
}
function guardDirty(discard) {
  if (app.doc && app.dirty && !onStart() && !discard) {
    throw new UserError(`Le projet « ${app.fileName} » a des modifications non enregistrées. Demande à l'utilisateur s'il faut l'enregistrer (save_project) ou l'abandonner (puis rappelle avec discard_changes: true).`);
  }
  app.dirty = false; // l'utilisateur a accepté de l'abandonner
}
function show(fi, li) {
  app.frameIndex = fi;
  if (li !== undefined) app.layerIndex = li;
  requestRender();
  refreshUI();
}

function summary() {
  const d = app.doc;
  if (!d || onStart()) return { projet: null, ecran: 'accueil', conseil: 'Crée un projet avec new_project ou open_animo.' };
  return {
    nom: app.fileName,
    mode: d.mode,
    largeur: d.width,
    hauteur: d.height,
    fps: d.fps,
    enregistre: !app.dirty,
    fichier: app.filePath,
    calques: d.layers.map((l, i) => ({ index: i, id: l.id, nom: l.name, visible: l.visible, verrouille: l.locked, opacite: l.opacity })),
    frames: d.frames.map((f, i) => ({
      index: i, id: f.id, duree_ms: Math.round(d.duration(i)),
      calques_dessines: d.layers.map((l, li) => (d.hasContent(l.id, f.id) ? li : null)).filter((v) => v !== null),
    })),
    selection: { frame: app.frameIndex, calque: app.layerIndex },
    couleurs: { principale: app.color, secondaire: app.color2 },
    palette: app.palette,
    pelure_oignon: app.onion,
    grille: { affichee: app.showGrid, grande_grille: app.gridMajor, magnetisme: app.grid.snap },
  };
}

async function documentsPath(file) {
  try {
    return await T.path.join(await T.path.documentDir(), 'Animotion', file);
  } catch {
    throw new UserError('Impossible de trouver le dossier Documents : précise path.');
  }
}
const safeName = () => (app.fileName && app.fileName !== 'Sans titre' ? app.fileName : 'animation').replace(/[\\/:*?"<>|]/g, '_');

// ---------------------------------------------------------- Mise en scène (souris fantôme)
async function useTool(tool) {
  if (!ghostOn() || !TOOL_DEFS[tool]) return;
  const name = app.mode === 'pixel' && tool === 'brush' ? 'pencil' : app.mode === 'vector' && tool === 'pencil' ? 'brush' : tool;
  await clickOn(`#toolbar .tbtn[title^="${TOOL_DEFS[name].label} ("]`);
  setTool(name);
}
async function goToFrame(fi, li) {
  if (ghostOn() && fi !== app.frameIndex) await clickOn(`#timeline th.fnum[data-f="${fi}"]`);
  show(fi, li);
}
const color = (c, def = '#000000') => (c === 'transparent' || c === null ? 'transparent' : c ? String(c) : def);

/** Pixel : peint une liste [x, y, couleur] (couleur 'transparent' = effacer), progressivement si la souris fantôme est active */
async function paintOps(fi, li, ops, { clear = false, tool = 'pencil' } = {}) {
  const d = app.doc, l = editableLayer(li), f = d.frames[fi];
  await useTool(tool);
  await goToFrame(fi, li);
  const c = ctx2d(d.getCel(l.id, f.id));
  const before = c.getImageData(0, 0, d.width, d.height);
  if (clear) c.clearRect(0, 0, d.width, d.height);
  const inside = ops.filter(([x, y]) => x >= 0 && y >= 0 && x < d.width && y < d.height);
  const steps = inside.map(([x, y, col]) => ({
    x: x + 0.5, y: y + 0.5,
    run: () => {
      if (col === 'transparent') c.clearRect(x, y, 1, 1);
      else {
        c.fillStyle = col;
        c.fillRect(x, y, 1, 1);
      }
    },
  }));
  await animateSteps(steps, requestRender);
  pushHistory(celEntry(l.id, f.id, before, c.getImageData(0, 0, d.width, d.height)));
  d.updateFlag(l.id, f.id);
  requestRender();
  refreshUI();
  return inside.length;
}

/** Dessin : ajoute des formes, en les « traçant » avec la souris fantôme */
async function addShapes(fi, li, list, { clear = false, tool = 'brush' } = {}) {
  const d = app.doc, l = editableLayer(li), f = d.frames[fi];
  await useTool(tool);
  await goToFrame(fi, li);
  const cel = d.getCel(l.id, f.id);
  const before = structuredClone(cel.shapes);
  if (clear) cel.shapes = [];
  for (const s of list) {
    if (!ghostOn() || s.img) {
      cel.shapes.push(s);
      continue;
    }
    const temp = { ...s, pts: [s.pts[0]], closed: false, fill: null, stroke: s.stroke || s.fill };
    cel.shapes.push(temp);
    const pts = s.pts.length > 40 ? s.pts.filter((_, i) => i % Math.ceil(s.pts.length / 40) === 0).concat([s.pts.at(-1)]) : s.pts;
    const steps = pts.map((p, i) => ({ x: p[0], y: p[1], run: () => (temp.pts = s.pts.slice(0, Math.max(1, Math.round(((i + 1) / pts.length) * s.pts.length)))) }));
    if (s.closed) steps.push({ x: s.pts[0][0], y: s.pts[0][1], run: () => {} });
    await animateSteps(steps, requestRender, Math.min(380, 1400 / list.length));
    Object.assign(temp, s);
  }
  pushHistory(celEntry(l.id, f.id, before, structuredClone(cel.shapes)));
  requestRender();
  refreshUI();
}

function lineOps(x0, y0, x1, y1, col, size = 1) {
  const out = [], s = Math.max(1, Math.round(size)), o = Math.floor((s - 1) / 2);
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) out.push([x0 - o + a, y0 - o + b, col]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}
function ellipseOps(x, y, w, h, col, fill, size = 1) {
  const out = [], cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const inside = (px, py, shrink = 0) => {
    const ax = rx - shrink, ay = ry - shrink;
    if (ax <= 0 || ay <= 0) return false;
    const u = (px + 0.5 - cx) / ax, v = (py + 0.5 - cy) / ay;
    return u * u + v * v <= 1.0001;
  };
  const th = Math.max(1, Math.round(size));
  for (let py = Math.floor(y); py < y + h; py++) for (let px = Math.floor(x); px < x + w; px++) {
    if (!inside(px, py)) continue;
    if (!inside(px, py, th)) out.push([px, py, col]);
    else if (fill) out.push([px, py, fill]);
  }
  return out;
}
function rectOps(x, y, w, h, col, fill, size = 1) {
  const out = [], th = Math.max(1, Math.round(size));
  [x, y, w, h] = [x, y, w, h].map(Math.round);
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const edge = px < x + th || px >= x + w - th || py < y + th || py >= y + h - th;
    if (edge && col) out.push([px, py, col]);
    else if (fill) out.push([px, py, fill]);
  }
  return out;
}

// ---------------------------------------------------------- Les actions
const TOOLS = {
  get_state: () => text(summary()),

  new_project({ mode = 'pixel', width, height, fps = 12, discard_changes }) {
    guardDirty(discard_changes);
    need(width >= 1 && height >= 1 && width <= 4096 && height <= 4096, 'Taille invalide (1 à 4096).');
    A.createProject(mode === 'vector' ? 'vector' : 'pixel', Math.round(width), Math.round(height), Math.max(1, Math.min(60, Math.round(fps) || 12)));
    return text({ ok: true, ...summary() });
  },

  async open_animo({ animo, name, discard_changes }) {
    guardDirty(discard_changes);
    let obj = typeof animo === 'string' ? parseLooseJSON(animo) : animo;
    need(obj && typeof obj === 'object', 'animo doit être un objet JSON.');
    obj = { app: 'animotion', ...obj };
    const doc = await Doc.load(obj);
    A.setDoc(doc, { name: name || 'Animation de Claude' });
    app.dirty = true;
    refreshUI();
    return text({ ok: true, ...summary() });
  },

  async draw_pixels({ rows, palette = {}, x = 0, y = 0, frame, layer, clear }) {
    requireDoc();
    requireMode('pixel');
    need(Array.isArray(rows) && rows.length, 'rows doit être une liste de lignes de texte.');
    const fi = frameIdx(frame), li = layerIdx(layer);
    const clearChars = new Set(['.', ' ', '_', '-', '0']);
    const ops = [];
    rows.forEach((row, ry) => {
      [...String(row)].forEach((ch, rx) => {
        const col = Object.prototype.hasOwnProperty.call(palette, ch) ? palette[ch] : clearChars.has(ch) ? undefined : '#ff00ff';
        if (col !== undefined) ops.push([Math.round(x) + rx, Math.round(y) + ry, col]);
      });
    });
    await paintOps(fi, li, ops, { clear, tool: 'pencil' });
    const missing = [...new Set(rows.join('').split(''))].filter((ch) => !(ch in palette) && !clearChars.has(ch));
    return text(`Dessiné sur la frame ${fi}, calque ${li} (« ${app.doc.layers[li].name} »).` + (missing.length ? ` Attention : caractères sans couleur dans palette, dessinés en magenta : ${missing.join(' ')}` : ''));
  },

  async draw_shapes({ shapes, frame, layer, clear }) {
    requireDoc();
    requireMode('vector');
    need(Array.isArray(shapes), 'shapes doit être une liste de formes.');
    const add = shapes.map(normalizeShape).filter(Boolean);
    const fi = frameIdx(frame), li = layerIdx(layer);
    const t = shapes[0]?.type;
    await addShapes(fi, li, add, { clear, tool: t === 'rect' ? 'rect' : t === 'circle' || t === 'ellipse' ? 'ellipse' : t === 'line' ? 'line' : 'brush' });
    return text(`${add.length} forme(s) ajoutée(s) sur la frame ${fi}, calque ${li}.` + (add.length < shapes.length ? ` ${shapes.length - add.length} forme(s) ignorée(s) car invalides.` : ''));
  },

  read_frame({ frame, layer, x, y, w, h }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = d.layers[li], f = d.frames[fi];
    const cel = d.cels.get(d.key(l.id, f.id));
    if (d.mode === 'vector') return text({ frame: fi, calque: li, formes: cel ? cel.shapes.map(({ id, ...s }) => s) : [] });
    if (!cel || !d.hasContent(l.id, f.id)) return text({ frame: fi, calque: li, vide: true });
    const data = ctx2d(cel).getImageData(0, 0, d.width, d.height).data;
    // zone : celle demandée, sinon le rectangle qui contient le dessin
    if (x === undefined || w === undefined) {
      let x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
      for (let py = 0; py < d.height; py++) for (let px = 0; px < d.width; px++) if (data[(py * d.width + px) * 4 + 3]) {
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      x = x0; y = y0; w = x1 - x0 + 1; h = y1 - y0 + 1;
    }
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y ?? 0));
    w = Math.min(Math.round(w), d.width - x); h = Math.min(Math.round(h ?? w), d.height - y);
    need(w > 0 && h > 0, 'Zone vide.');
    need(w <= 128 && h <= 128, `Zone trop grande (${w}×${h}) : précise x, y, w, h (128×128 max).`);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789#@$%&*+=?!';
    const pal = {}, byColor = new Map(), rows = [];
    for (let py = y; py < y + h; py++) {
      let row = '';
      for (let px = x; px < x + w; px++) {
        const i = (py * d.width + px) * 4;
        if (!data[i + 3]) { row += '.'; continue; }
        const hex = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('') + (data[i + 3] < 255 ? data[i + 3].toString(16).padStart(2, '0') : '');
        if (!byColor.has(hex)) {
          need(byColor.size < chars.length, 'Trop de couleurs différentes pour un affichage texte : utilise get_frame_image.');
          const ch = chars[byColor.size];
          byColor.set(hex, ch);
          pal[ch] = hex;
        }
        row += byColor.get(hex);
      }
      rows.push(row);
    }
    return text({ frame: fi, calque: li, x, y, w, h, rows, palette: pal });
  },

  get_frame_image({ frame, scale }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame);
    const big = Math.max(d.width, d.height);
    const s = scale > 0 ? Math.min(scale, d.mode === 'pixel' ? 32 : 4) : d.mode === 'pixel' ? Math.max(1, Math.min(16, Math.floor(512 / big))) : Math.min(1, 1024 / big);
    const c = compositeFrame(d, fi, s);
    return {
      content: [
        { type: 'image', data: c.toDataURL('image/png').split(',')[1], mimeType: 'image/png' },
        { type: 'text', text: `Frame ${fi} (${d.width}×${d.height}, affichée ×${+s.toFixed(2)}, fond transparent).` },
      ],
    };
  },

  add_frames({ count = 1, after, duplicate, duration }) {
    requireDoc();
    const d = app.doc;
    const at = frameIdx(after);
    count = Math.max(1, Math.min(200, Math.round(count) || 1));
    structural(() => {
      const src = d.frames[at];
      for (let k = 0; k < count; k++) {
        const f = d.makeFrame(duration > 0 ? Math.round(duration) : null);
        if (duplicate) {
          for (const l of d.layers) {
            const c = d.cels.get(d.key(l.id, src.id));
            if (c) {
              d.cels.set(d.key(l.id, f.id), d.copyCel(c));
              d.flags.set(d.key(l.id, f.id), d.flags.get(d.key(l.id, src.id)));
            }
          }
        }
        d.frames.splice(at + 1 + k, 0, f);
      }
      app.frameIndex = at + 1;
    });
    return text({ nouvelles_frames: Array.from({ length: count }, (_, k) => at + 1 + k), total: d.frames.length });
  },

  delete_frame({ frame }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame);
    need(d.frames.length > 1, 'Il faut garder au moins une frame.');
    structural(() => {
      d.removeCels({ frameId: d.frames[fi].id });
      d.frames.splice(fi, 1);
      app.frameIndex = Math.min(app.frameIndex, d.frames.length - 1);
    });
    return text({ ok: true, total: d.frames.length });
  },

  add_layer({ name, on_top }) {
    requireDoc();
    const d = app.doc;
    let index;
    structural(() => {
      const l = d.makeLayer(String(name || 'Calque ' + (d.layers.length + 1)).slice(0, 40));
      index = on_top ? d.layers.length : app.layerIndex + 1;
      d.layers.splice(index, 0, l);
      app.layerIndex = index;
    });
    return text({ index, id: d.layers[index].id, nom: d.layers[index].name });
  },

  clear_cel({ frame, layer }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li), f = d.frames[fi];
    const before = d.getCelData(l.id, f.id);
    if (d.mode === 'pixel') ctx2d(d.getCel(l.id, f.id)).clearRect(0, 0, d.width, d.height);
    else d.getCel(l.id, f.id).shapes = [];
    pushHistory(celEntry(l.id, f.id, before, d.getCelData(l.id, f.id)));
    d.updateFlag(l.id, f.id);
    show(fi, li);
    return text('Cel vidée.');
  },

  select({ frame, layer }) {
    requireDoc();
    if (frame !== undefined) A.setFrame(frameIdx(frame));
    if (layer !== undefined) A.setLayer(layerIdx(layer));
    return text({ selection: { frame: app.frameIndex, calque: app.layerIndex } });
  },

  set_timing({ fps, frame, duration }) {
    requireDoc();
    if (fps) A.setFps(fps);
    if (frame !== undefined && duration !== undefined) {
      const fi = frameIdx(frame);
      structural(() => {
        app.doc.frames[fi].duration = duration > 0 ? Math.max(10, Math.round(duration)) : null;
      });
    }
    return text({ fps: app.doc.fps, durees_ms: app.doc.frames.map((_, i) => Math.round(app.doc.duration(i))) });
  },

  play({ playing }) {
    requireDoc();
    if (playing) A.startPlay();
    else A.stopPlay();
    return text(app.playing ? 'Lecture en cours.' : 'Lecture arrêtée.');
  },

  undo({ steps = 1 }) {
    requireDoc();
    for (let i = 0; i < Math.max(1, Math.min(50, steps)); i++) undo();
    return text('Annulé.');
  },

  async save_project({ path, name }) {
    requireDoc();
    if (name) app.fileName = String(name);
    const target = path || app.filePath || (await documentsPath(safeName() + '.animo'));
    const ok = await A.saveProject(false, target);
    need(ok, 'L’enregistrement a échoué.');
    return text({ enregistre_dans: app.filePath || target });
  },

  async export({ format, path, scale }) {
    requireDoc();
    const ext = { gif: 'gif', png: 'png', sequence: 'zip', spritesheet: 'png', webm: 'webm', mp4: 'mp4' }[format];
    need(ext, 'Format inconnu : gif, png, sequence, spritesheet, webm ou mp4.');
    const suffix = { png: `_frame${app.frameIndex + 1}`, sequence: '_frames', spritesheet: '_spritesheet' }[format] || '';
    const target = path || (await documentsPath(safeName() + suffix + '.' + ext));
    const oldScale = app.render.scale;
    if (scale > 0) app.render.scale = scale;
    try {
      const fn = { gif: X.exportGIF, png: X.exportPNG, sequence: X.exportSequence, spritesheet: X.exportSpritesheet, webm: () => X.exportVideo('webm'), mp4: () => X.exportVideo('mp4') }[format];
      const written = await X.exportTo(target, fn);
      need(written, format === 'mp4' ? 'Export MP4 impossible sur ce PC : essaie webm.' : 'Export impossible.');
      return text({ fichier: written });
    } finally {
      app.render.scale = oldScale;
    }
  },

  // ======================================================== nouvelles actions
  async draw_line({ x1, y1, x2, y2, color: c, size = 1, frame, layer }) {
    requireDoc();
    const fi = frameIdx(frame), li = layerIdx(layer), col = color(c, app.color);
    if (app.doc.mode === 'pixel') {
      const n = await paintOps(fi, li, lineOps(x1, y1, x2, y2, col, size), { tool: 'line' });
      return text(`Ligne tracée (${n} pixels) sur la frame ${fi}.`);
    }
    await addShapes(fi, li, [normalizeShape({ type: 'line', x1, y1, x2, y2, stroke: col, strokeWidth: size })], { tool: 'line' });
    return text(`Ligne ajoutée sur la frame ${fi}.`);
  },

  async draw_rect({ x, y, w, h, color: c, fill, size = 1, frame, layer }) {
    requireDoc();
    const fi = frameIdx(frame), li = layerIdx(layer), col = c === undefined ? (fill ? null : app.color) : color(c);
    need(w > 0 && h > 0, 'w et h doivent être positifs.');
    if (app.doc.mode === 'pixel') {
      const n = await paintOps(fi, li, rectOps(x, y, w, h, col, fill ? color(fill) : null, size), { tool: 'rect' });
      return text(`Rectangle dessiné (${n} pixels) sur la frame ${fi}.`);
    }
    await addShapes(fi, li, [normalizeShape({ type: 'rect', x, y, w, h, stroke: col, fill, strokeWidth: size })], { tool: 'rect' });
    return text(`Rectangle ajouté sur la frame ${fi}.`);
  },

  async draw_ellipse({ x, y, w, h, color: c, fill, size = 1, frame, layer }) {
    requireDoc();
    const fi = frameIdx(frame), li = layerIdx(layer), col = c === undefined ? (fill ? null : app.color) : color(c);
    need(w > 0 && h > 0, 'w et h doivent être positifs.');
    if (app.doc.mode === 'pixel') {
      const n = await paintOps(fi, li, ellipseOps(x, y, w, h, col || fill, fill ? color(fill) : null, size), { tool: 'ellipse' });
      return text(`Ellipse dessinée (${n} pixels) sur la frame ${fi}.`);
    }
    await addShapes(fi, li, [normalizeShape({ type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, stroke: col, fill, strokeWidth: size })], { tool: 'ellipse' });
    return text(`Ellipse ajoutée sur la frame ${fi}.`);
  },

  async fill({ x, y, color: c, frame, layer }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li), col = color(c, app.color);
    if (d.mode === 'pixel') {
      x = Math.floor(x); y = Math.floor(y);
      need(x >= 0 && y >= 0 && x < d.width && y < d.height, 'Point en dehors du canevas.');
      const data = ctx2d(d.getCel(l.id, d.frames[fi].id)).getImageData(0, 0, d.width, d.height);
      const px = new Uint32Array(data.data.buffer), target = px[y * d.width + x];
      const seen = new Uint8Array(px.length), ops = [], queue = [[x, y]];
      seen[y * d.width + x] = 1;
      while (queue.length) { // parcours en largeur : la couleur se répand depuis le point (joli à regarder)
        const [qx, qy] = queue.shift();
        ops.push([qx, qy, col]);
        for (const [nx, ny] of [[qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]]) {
          const i = ny * d.width + nx;
          if (nx >= 0 && ny >= 0 && nx < d.width && ny < d.height && !seen[i] && px[i] === target) { seen[i] = 1; queue.push([nx, ny]); }
        }
      }
      await paintOps(fi, li, ops, { tool: 'bucket' });
      return text(`Zone remplie (${ops.length} pixels).`);
    }
    const cel = d.getCel(l.id, d.frames[fi].id);
    const hit = makeCanvas(1, 1).getContext('2d');
    const s = [...cel.shapes].reverse().find((sh) => !sh.img && sh.pts.length > 2 && hit.isPointInPath(shapePath(sh), x, y));
    need(s, 'Aucune forme à cet endroit : le remplissage en mode dessin colorie une forme existante.');
    await useTool('bucket');
    if (ghostOn()) { const p = docToScreen(x, y); await moveTo(p.x, p.y); }
    const before = structuredClone(cel.shapes);
    s.fill = col === 'transparent' ? null : col;
    pushHistory(celEntry(l.id, d.frames[fi].id, before, structuredClone(cel.shapes)));
    show(fi, li);
    return text('Forme remplie.');
  },

  async erase_area({ x = 0, y = 0, w, h, frame, layer }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li);
    w = w ?? d.width; h = h ?? d.height;
    if (d.mode === 'pixel') {
      const n = await paintOps(fi, li, rectOps(x, y, w, h, null, 'transparent'), { tool: 'eraser' });
      return text(`${n} pixels effacés.`);
    }
    const cel = d.getCel(l.id, d.frames[fi].id), before = structuredClone(cel.shapes);
    await useTool('eraser');
    const keep = cel.shapes.filter((s) => { const b = bbox(s); return !(b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y); });
    const removed = cel.shapes.length - keep.length;
    cel.shapes = keep;
    pushHistory(celEntry(l.id, d.frames[fi].id, before, structuredClone(keep)));
    show(fi, li);
    return text(`${removed} forme(s) effacée(s).`);
  },

  move_content({ dx = 0, dy = 0, frame, layer, all_frames }) {
    requireDoc();
    const d = app.doc, li = layerIdx(layer), l = editableLayer(li);
    const list = all_frames ? d.frames.map((_, i) => i) : [frameIdx(frame)];
    structural(() => {
      for (const fi of list) {
        const cel = d.cels.get(d.key(l.id, d.frames[fi].id));
        if (!cel) continue;
        if (d.mode === 'pixel') {
          const copy = cloneCanvas(cel), c = ctx2d(cel);
          c.clearRect(0, 0, d.width, d.height);
          c.drawImage(copy, Math.round(dx), Math.round(dy));
          d.updateFlag(l.id, d.frames[fi].id);
        } else for (const s of cel.shapes) s.pts = s.pts.map(([px, py]) => [px + dx, py + dy]);
      }
    });
    return text(`Contenu décalé de (${dx}, ${dy}) sur ${list.length} frame(s).`);
  },

  transform({ action, frame, layer }) {
    requireDoc();
    need(['flipH', 'flipV', 'rotCW', 'rotCCW'].includes(action), 'action : flipH, flipV, rotCW ou rotCCW.');
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li), f = d.frames[fi];
    const W = d.width, H = d.height, cx = W / 2, cy = H / 2;
    const before = d.getCelData(l.id, f.id);
    if (d.mode === 'pixel') {
      const cel = d.getCel(l.id, f.id), copy = cloneCanvas(cel), c = ctx2d(cel);
      c.clearRect(0, 0, W, H);
      c.save();
      c.imageSmoothingEnabled = false;
      if (action === 'flipH') { c.translate(W, 0); c.scale(-1, 1); }
      else if (action === 'flipV') { c.translate(0, H); c.scale(1, -1); }
      else { c.translate(Math.floor(cx), Math.floor(cy)); c.rotate(action === 'rotCW' ? Math.PI / 2 : -Math.PI / 2); c.translate(-Math.floor(cx), -Math.floor(cy)); }
      c.drawImage(copy, 0, 0);
      c.restore();
    } else {
      const fn = { flipH: ([x, y]) => [2 * cx - x, y], flipV: ([x, y]) => [x, 2 * cy - y], rotCW: ([x, y]) => [cx - (y - cy), cy + (x - cx)], rotCCW: ([x, y]) => [cx + (y - cy), cy - (x - cx)] }[action];
      for (const s of d.getCel(l.id, f.id).shapes) s.pts = s.pts.map(fn);
    }
    pushHistory(celEntry(l.id, f.id, before, d.getCelData(l.id, f.id)));
    d.updateFlag(l.id, f.id);
    show(fi, li);
    return text(`Transformation ${action} appliquée.`);
  },

  copy_cel({ from_frame, to_frame, from_layer, to_layer }) {
    requireDoc();
    const d = app.doc, ff = frameIdx(from_frame), tf = frameIdx(to_frame);
    const fl = layerIdx(from_layer), tl = layerIdx(to_layer ?? fl), target = editableLayer(tl);
    structural(() => {
      const src = d.cels.get(d.key(d.layers[fl].id, d.frames[ff].id));
      const key = d.key(target.id, d.frames[tf].id);
      if (src) { d.cels.set(key, d.copyCel(src)); d.updateFlag(target.id, d.frames[tf].id); }
      else { d.cels.delete(key); d.flags.delete(key); }
      app.frameIndex = tf; app.layerIndex = tl;
    });
    return text(`Cel copiée de (frame ${ff}, calque ${fl}) vers (frame ${tf}, calque ${tl}).`);
  },

  move_frame({ frame, to }) {
    requireDoc();
    const d = app.doc, i = frameIdx(frame), j = frameIdx(to);
    structural(() => { const [f] = d.frames.splice(i, 1); d.frames.splice(j, 0, f); app.frameIndex = j; });
    return text(`Frame ${i} déplacée en position ${j}.`);
  },

  set_layer({ layer, name, visible, locked, opacity }) {
    requireDoc();
    const li = layerIdx(layer);
    structural(() => {
      const l = app.doc.layers[li];
      if (name !== undefined) l.name = String(name).slice(0, 40);
      if (visible !== undefined) l.visible = !!visible;
      if (locked !== undefined) l.locked = !!locked;
      if (opacity !== undefined) l.opacity = Math.max(0, Math.min(1, +opacity > 1 ? +opacity / 100 : +opacity));
    });
    const l = app.doc.layers[li];
    return text({ index: li, nom: l.name, visible: l.visible, verrouille: l.locked, opacite: l.opacity });
  },

  delete_layer({ layer }) {
    requireDoc();
    const d = app.doc, li = layerIdx(layer);
    need(d.layers.length > 1, 'Il faut garder au moins un calque.');
    structural(() => { d.removeCels({ layerId: d.layers[li].id }); d.layers.splice(li, 1); app.layerIndex = Math.max(0, Math.min(app.layerIndex, d.layers.length - 1)); });
    return text({ ok: true, calques: d.layers.map((l, i) => `${i}: ${l.name}`) });
  },

  move_layer({ layer, to }) {
    requireDoc();
    const d = app.doc, i = layerIdx(layer), j = Math.max(0, Math.min(d.layers.length - 1, Math.round(+to)));
    structural(() => { const [l] = d.layers.splice(i, 1); d.layers.splice(j, 0, l); app.layerIndex = j; });
    return text({ calques: d.layers.map((l, k) => `${k}: ${l.name}`) });
  },

  merge_down({ layer }) {
    requireDoc();
    const li = layerIdx(layer);
    need(li > 0, 'Ce calque est déjà tout en bas.');
    app.layerIndex = li;
    A.mergeDown();
    return text({ calques: app.doc.layers.map((l, k) => `${k}: ${l.name}`) });
  },

  async set_colors({ primary, secondary }) {
    if (ghostOn()) await clickOn('#sidepanel .colorpair');
    if (primary) A.setColor(primary === 'transparent' ? 'transparent' : normalizeHex(primary) || primary);
    if (secondary) A.setColor(secondary === 'transparent' ? 'transparent' : normalizeHex(secondary) || secondary, true);
    return text({ principale: app.color, secondaire: app.color2 });
  },

  set_palette({ colors, name, preset }) {
    if (preset) { need(PALETTES[preset], `Palettes disponibles : ${Object.keys(PALETTES).join(', ')}`); A.loadPalette(preset); return text({ palette: app.palette }); }
    need(Array.isArray(colors) && colors.length, 'colors : liste de couleurs, ou preset : nom de palette.');
    app.palette = colors.map((c) => normalizeHex(c)).filter(Boolean).slice(0, 64);
    app.paletteName = name || 'Palette de Claude';
    refreshUI();
    return text({ palette: app.palette });
  },

  async set_onion({ enabled, before, after }) {
    requireDoc();
    if (ghostOn()) await clickOn('.tl-controls .icon-btn[title^="Pelure"]');
    if (enabled !== undefined) app.onion.enabled = !!enabled;
    if (before !== undefined) app.onion.before = Math.max(0, Math.min(5, Math.round(before)));
    if (after !== undefined) app.onion.after = Math.max(0, Math.min(5, Math.round(after)));
    requestRender(); refreshUI();
    return text(app.onion);
  },

  set_grid({ show: visible, major, step, style, snap }) {
    requireDoc();
    if (visible !== undefined) app.showGrid = !!visible;
    if (major !== undefined) app.gridMajor = Math.max(0, Math.round(major));
    if (step !== undefined) app.grid.step = Math.max(0, Math.round(step));
    if (style === 'lines' || style === 'dots') app.grid.style = style;
    if (snap !== undefined) app.grid.snap = !!snap;
    requestRender(); refreshUI();
    return text({ affichee: app.showGrid, grande_grille: app.gridMajor, pas: app.grid.step, style: app.grid.style, magnetisme: app.grid.snap });
  },

  resize_canvas({ width, height, anchor = 'center' }) {
    requireDoc();
    need(width >= 1 && height >= 1 && width <= 4096 && height <= 4096, 'Taille invalide (1 à 4096).');
    structural(() => app.doc.resize(Math.round(width), Math.round(height), anchor === 'topleft' ? 'topleft' : 'center'));
    fitView();
    return text({ largeur: app.doc.width, hauteur: app.doc.height });
  },

  async adjust_image({ frame, layer, ...opts }) {
    requireDoc();
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li), f = d.frames[fi];
    const o = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: false, sepia: false, invert: false, palette: false, flipH: false, flipV: false, ...opts };
    const before = d.getCelData(l.id, f.id);
    if (d.mode === 'pixel') {
      const cel = d.getCel(l.id, f.id), out = renderAdjust(cloneCanvas(cel), o), c = ctx2d(cel);
      c.clearRect(0, 0, d.width, d.height);
      c.drawImage(out, 0, 0);
      d.updateFlag(l.id, f.id);
    } else {
      const imgs = d.getCel(l.id, f.id).shapes.filter((s) => s.img);
      need(imgs.length, 'Aucune image sur cette cel (en mode dessin, adjust_image modifie les images importées).');
      for (const s of imgs) {
        const im = new Image();
        im.src = s.img;
        await im.decode();
        const src = makeCanvas(s.iw, s.ih);
        ctx2d(src).drawImage(im, 0, 0, s.iw, s.ih);
        s.img = renderAdjust(src, o).toDataURL('image/png');
      }
    }
    pushHistory(celEntry(l.id, f.id, before, d.getCelData(l.id, f.id)));
    show(fi, li);
    return text('Image modifiée.');
  },

  tween({ from, to, count = 3, layer }) {
    requireDoc();
    requireMode('vector');
    const d = app.doc, a = frameIdx(from), b = frameIdx(to);
    need(a !== b, 'from et to doivent être deux frames différentes.');
    count = Math.max(1, Math.min(60, Math.round(count)));
    const layers = layer === undefined ? d.layers : [d.layers[layerIdx(layer)]];
    let skipped = 0;
    structural(() => {
      const fa = d.frames[a], fb = d.frames[b];
      const news = Array.from({ length: count }, () => d.makeFrame());
      d.frames.splice(a + 1, 0, ...news);
      news.forEach((nf, k) => {
        const t = (k + 1) / (count + 1);
        for (const l of layers) {
          const A0 = d.cels.get(d.key(l.id, fa.id))?.shapes || [], B0 = d.cels.get(d.key(l.id, fb.id))?.shapes || [];
          const out = A0.map((sa, i) => {
            const sb = B0[i];
            if (!sb || sb.pts.length !== sa.pts.length) { if (k === 0) skipped++; return structuredClone(sa); }
            const lerp = (u, v) => u + (v - u) * t;
            return { ...structuredClone(sa), id: undefined, pts: sa.pts.map((p, j) => [lerp(p[0], sb.pts[j][0]), lerp(p[1], sb.pts[j][1])]), width: lerp(sa.width || 0, sb.width || 0) };
          }).map((sh) => (sh.img ? { ...sh, id: newId() } : normalizeShape(sh))).filter(Boolean);
          if (out.length) d.cels.set(d.key(l.id, nf.id), { shapes: out });
        }
      });
      app.frameIndex = a + 1;
    });
    return text(`${count} frame(s) intermédiaire(s) créée(s) après la frame ${a}.` + (skipped ? ` ${skipped} forme(s) recopiée(s) sans interpolation (pas d'équivalent avec le même nombre de points dans la frame ${b}).` : ' Les formes sont associées dans l’ordre : la forme n de from glisse vers la forme n de to.'));
  },

  redo({ steps = 1 }) {
    requireDoc();
    for (let i = 0; i < Math.max(1, Math.min(50, steps)); i++) redo();
    return text('Rétabli.');
  },

  set_view({ zoom }) {
    requireDoc();
    if (zoom === 'fit' || zoom === undefined) fitView();
    else setZoom(Math.max(0.05, Math.min(64, +zoom)));
    return text({ zoom: app.zoom });
  },
};

// boutons « cliqués » par la souris fantôme avant certaines actions
const GHOST_CLICK = {
  add_frames: '.tl-controls .icon-btn[title^="Nouvelle frame"]',
  delete_frame: '.tl-controls .icon-btn[title^="Supprimer la frame"]',
  add_layer: '#timeline .corner .mini-btn',
  play: '.tl-controls .icon-btn.play',
  export: '#exportTop',
  undo: '.rbtn[title^="Annuler"]',
  redo: '.rbtn[title^="Rétablir"]',
  set_timing: '.tl-fps input',
  resize_canvas: '#tabbar .tab:nth-child(7)',
  save_project: '#tabbar .tab.file',
};

// ---------------------------------------------------------- Badge « Claude pilote Animotion »
let badgeTimer = null;
function badge(tool) {
  let b = document.getElementById('mcpBadge');
  if (!b) {
    b = el('div', 'mcp-badge');
    b.id = 'mcpBadge';
    document.body.appendChild(b);
  }
  b.innerHTML = `<span class="dot"></span> Claude pilote Animotion <span class="muted">· ${escapeHtml(tool)}</span>`;
  b.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => b.classList.remove('show'), 4000);
}

export function initMcp() {
  if (!isTauri || !T.event) return;
  T.event.listen('mcp-call', async (ev) => {
    const { id, tool, args } = ev.payload || {};
    let res;
    try {
      const fn = TOOLS[tool];
      need(fn, `Outil inconnu : ${tool}`);
      if (tool !== 'get_state' && tool !== 'get_frame_image' && tool !== 'read_frame') {
        commitFloating();
        if (tool !== 'play') A.stopPlay();
      }
      badge(tool);
      if (ghostOn() && GHOST_CLICK[tool]) await clickOn(GHOST_CLICK[tool]);
      res = await fn(args || {});
    } catch (e) {
      res = { content: [{ type: 'text', text: e instanceof UserError ? e.message : 'Erreur : ' + (e.message || e) }], isError: true };
    }
    try {
      await T.core.invoke('mcp_reply', { id, payload: JSON.stringify(res) });
    } catch {}
  });
}

// ---------------------------------------------------------- Connexion à Claude Desktop
export async function showMcpSetup() {
  let exe = 'C:\\chemin\\vers\\Animotion.exe';
  if (isTauri) {
    try { exe = await T.core.invoke('mcp_exe_path'); } catch {}
  }
  const cfg = JSON.stringify({ mcpServers: { animotion: { command: exe, args: ['--mcp'] } } }, null, 2);
  const box = el('div', 'claude-help');
  box.innerHTML = `
    <p>Une fois connecté, tu peux demander à <b>Claude Desktop</b> : <i>« crée un slime de 16×16 qui saute en 6 frames et exporte un GIF »</i>, et il pilote Animotion sous tes yeux. Tout ce qu’il fait s’annule avec Ctrl+Z.</p>
    <ol class="steps">
      <li>Clique sur <b>Connecter automatiquement</b> (ou copie la configuration ci-dessous dans <code>claude_desktop_config.json</code>).</li>
      <li><b>Quitte complètement Claude Desktop</b> (clic droit sur son icône près de l’horloge → Quitter) puis relance-le.</li>
      <li>Dans une conversation, l’outil « animotion » apparaît : demande-lui une animation !</li>
    </ol>
    <div class="ch-row"><b>Configuration manuelle</b><span class="muted">Claude Code : <code>claude mcp add animotion -- "${escapeHtml(exe)}" --mcp</code></span></div>
    <textarea class="ch-prompt" readonly>${escapeHtml(cfg)}</textarea>
    <p class="muted">⚠ Si tu déplaces Animotion.exe, reconnecte-le ici.</p>`;
  const choice = await modal({
    title: 'Connecter Animotion à Claude Desktop 🤖',
    content: box,
    wide: true,
    buttons: [{ label: 'Fermer', value: null }, ...(isTauri ? [{ label: 'Connecter automatiquement', value: 'install', primary: true }] : [])],
  });
  if (choice !== 'install') return;
  try {
    const files = await T.core.invoke('mcp_install');
    await modal({
      title: 'Animotion est connecté ✔',
      content: `<p>Configuration ajoutée dans :</p><p><code>${files.map(escapeHtml).join('</code><br><code>')}</code></p><p>Maintenant, <b>quitte complètement Claude Desktop</b> et relance-le. Ensuite, demande-lui une animation 🎬</p>
        <p class="muted">Si « animotion » n’apparaît toujours pas dans Claude Desktop › Paramètres › Application de bureau › Extensions › Serveurs MCP locaux : clique là-bas sur « Modifier la configuration » et colle la configuration manuelle de cette fenêtre.</p>`,
      buttons: [{ label: 'Compris !', value: true, primary: true }],
    });
  } catch (e) {
    toast('Connexion impossible : ' + e, 'error', 7000);
  }
}
