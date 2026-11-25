// Claude pilote Animotion (MCP) : exécution des actions reçues du pont `Animotion.exe --mcp`
import { app, curLayer, refreshUI } from './state.js';
import { isTauri } from './platform.js';
import * as A from './actions.js';
import * as X from './export.js';
import { Doc, drawRows, normalizeShape } from './doc.js';
import { structural, pushHistory, celEntry, undo } from './history.js';
import { compositeFrame } from './render.js';
import { requestRender } from './view.js';
import { commitFloating } from './tools.js';
import { toast, modal } from './dialogs.js';
import { parseLooseJSON, ctx2d, el, escapeHtml } from './util.js';

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

  draw_pixels({ rows, palette = {}, x = 0, y = 0, frame, layer, clear }) {
    requireDoc();
    requireMode('pixel');
    need(Array.isArray(rows) && rows.length, 'rows doit être une liste de lignes de texte.');
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li), f = d.frames[fi];
    const c = ctx2d(d.getCel(l.id, f.id));
    const before = c.getImageData(0, 0, d.width, d.height);
    if (clear) c.clearRect(0, 0, d.width, d.height);
    drawRows(c, { rows, palette, x, y });
    pushHistory(celEntry(l.id, f.id, before, c.getImageData(0, 0, d.width, d.height)));
    d.updateFlag(l.id, f.id);
    show(fi, li);
    const clearChars = new Set(['.', ' ', '_', '-', '0']);
    const missing = [...new Set(rows.join('').split(''))].filter((ch) => !(ch in palette) && !clearChars.has(ch));
    return text(`Dessiné sur la frame ${fi}, calque ${li} (« ${l.name} »).` + (missing.length ? ` Attention : caractères sans couleur dans palette, dessinés en magenta : ${missing.join(' ')}` : ''));
  },

  draw_shapes({ shapes, frame, layer, clear }) {
    requireDoc();
    requireMode('vector');
    need(Array.isArray(shapes), 'shapes doit être une liste de formes.');
    const d = app.doc, fi = frameIdx(frame), li = layerIdx(layer), l = editableLayer(li), f = d.frames[fi];
    const cel = d.getCel(l.id, f.id);
    const before = structuredClone(cel.shapes);
    const add = shapes.map(normalizeShape).filter(Boolean);
    cel.shapes = clear ? add : [...cel.shapes, ...add];
    pushHistory(celEntry(l.id, f.id, before, structuredClone(cel.shapes)));
    show(fi, li);
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
      content: `<p>Configuration ajoutée dans :</p><p><code>${files.map(escapeHtml).join('</code><br><code>')}</code></p><p>Maintenant, <b>quitte complètement Claude Desktop</b> et relance-le. Ensuite, demande-lui une animation 🎬</p>`,
      buttons: [{ label: 'Compris !', value: true, primary: true }],
    });
  } catch (e) {
    toast('Connexion impossible : ' + e, 'error', 7000);
  }
}
