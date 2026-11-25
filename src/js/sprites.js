// Import de sprites décrits dans un script .js, par exemple :
//   const sprite = [
//     "..####..",
//     ".#....#.",
//   ];
// Gère aussi les tableaux de nombres, les animations (tableau de sprites) et les palettes.
import { app, curLayer, curFrame, refreshUI } from './state.js';
import { el, escapeHtml, makeCanvas, ctx2d } from './util.js';
import { modal, toast } from './dialogs.js';
import { openFile } from './platform.js';
import { structural } from './history.js';
import { fitView, requestRender } from './view.js';
import { createProject } from './actions.js';
import { commitFloating } from './tools.js';
import { newId } from './doc.js';

// ---------------------------------------------------------- Lecture du script
// Le script est exécuté dans un Worker isolé : il n'a aucun accès à l'appli (fichiers, fenêtre…)
// et il est arrêté au bout de 3 s (boucle infinie). Seules les données (tableaux, objets) en ressortent.
export function runScript(code) {
  const src = String(code)
    .replace(/^\s*import\s.*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '__v["default"] = ')
    .replace(/\bmodule\.exports\s*=/g, '__v["default"] =')
    .replace(/\bexport\s+(?=(const|let|var|function)\b)/g, '')
    // const nom = ...  ->  var nom = __v["nom"] = ...  (garde la variable utilisable plus loin dans le script)
    .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/g, (m, k, n) => `var ${n} = __v[${JSON.stringify(n)}] =`);
  const workerCode = `
    // Faux objets "qui avalent tout" : le code de dessin du script (document, canvas…) tourne sans rien faire
    const trou = new Proxy(function () {}, {
      get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : trou),
      set: () => true, apply: () => trou, construct: () => trou, has: () => true,
    });
    self.document = trou; self.window = trou; self.canvas = trou; self.alert = () => {};
    self.requestAnimationFrame = () => 0; self.Image = function () { return trou; };
    onmessage = (e) => {
      const __v = {};
      let warning = null;
      try { (new Function('__v', e.data))(__v); }
      catch (err) { warning = String((err && err.message) || err); } // on garde ce qui a été lu avant l'erreur
      const out = {};
      for (const k of Object.keys(__v)) { try { out[k] = JSON.parse(JSON.stringify(__v[k])); } catch {} }
      postMessage({ ok: true, vars: out, warning });
    };`;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
    const w = new Worker(url);
    const done = (fn, v) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('le script met trop de temps (boucle infinie ?)')), 3000);
    w.onmessage = (e) => (e.data.ok ? done(resolve, Object.assign(e.data.vars, { __warning: e.data.warning })) : done(reject, new Error('le script contient une erreur : ' + e.data.error)));
    w.onerror = (e) => {
      e.preventDefault();
      done(reject, new Error('le script contient une erreur : ' + e.message));
    };
    w.postMessage(src);
  });
}

const isRows = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => typeof r === 'string');
const isNumGrid = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => Array.isArray(r) && r.length && r.every((c) => typeof c === 'number' || c === null));
const isGrid = (v) => isRows(v) || isNumGrid(v);
const isFrames = (v) => Array.isArray(v) && v.length > 0 && v.every(isGrid);

const cssColor = (() => {
  const c = makeCanvas(1, 1).getContext('2d');
  return (v) => {
    if (v == null || v === false || v === 'transparent' || v === '') return null;
    if (typeof v === 'number') v = '#' + v.toString(16).padStart(6, '0');
    c.fillStyle = '#000';
    c.fillStyle = String(v);
    return c.fillStyle.startsWith('#') ? c.fillStyle : rgbToHex(c.fillStyle);
  };
})();
function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g) || [0, 0, 0];
  return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
}
// Une vraie couleur : #hex, rgb()/hsl(), nom CSS (red, transparent…) — pas une ligne de sprite comme "##..##"
const NAMED = (() => {
  const c = makeCanvas(1, 1).getContext('2d');
  return (n) => {
    c.fillStyle = '#010203';
    c.fillStyle = n;
    return n.toLowerCase() === 'transparent' || c.fillStyle !== '#010203';
  };
})();
const isColorish = (v) => {
  if (v === null || typeof v === 'number') return true;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || /^(rgb|hsl)a?\(/i.test(t) || (/^[a-z]{3,}$/i.test(t) && NAMED(t));
};
const isColorList = (v) => Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === 'string' && isColorish(c));

/** Cherche les sprites et palettes dans les variables du script */
// Couleurs écrites telles quelles dans le script (ex. color = "#5fd35f") : utilisées par défaut s'il n'y a pas de palette
export function colorsInSource(code) {
  return [...new Set((String(code).match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) || []).map((c) => c.toLowerCase()))];
}

export function findSprites(vars) {
  const sprites = [];
  let charMap = null, indexPal = null;
  const visit = (name, v, depth = 0) => {
    if (isColorList(v)) indexPal ||= v; // ex. ["transparent", "#ff004d", "#ff77a8"]
    else if (isGrid(v)) sprites.push({ name, frames: [v] });
    else if (isFrames(v)) sprites.push({ name, frames: v });
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const entries = Object.entries(v);
      if (entries.length && entries.every(([k, c]) => isColorish(c)) && entries.some(([k]) => k.length === 1 || /^\d+$/.test(k))) charMap ||= v;
      else if (depth < 2) for (const [k, c] of entries) visit(name === 'default' ? k : `${name}.${k}`, c, depth + 1);
    }
  };
  for (const [name, v] of Object.entries(vars)) if (name !== '__warning') visit(name, v);
  return { sprites, charMap, indexPal };
}

const TRANSPARENT = new Set(['.', ' ', '_', '-', '0', 0, null]);
const symbolsOf = (sprites) => {
  const out = [];
  for (const s of sprites) for (const f of s.frames) for (const row of f) for (const c of row) if (!out.includes(c)) out.push(c);
  return out;
};

function defaultMapping(symbols, charMap, indexPal, srcColors = []) {
  const map = new Map();
  const pool = [...srcColors, app.color, ...app.palette.filter((c) => c !== app.color && c !== '#000000' && !srcColors.includes(c))];
  let k = 0;
  for (const s of symbols) {
    if (charMap && Object.prototype.hasOwnProperty.call(charMap, s)) map.set(s, cssColor(charMap[s]));
    else if (indexPal && typeof s === 'number' && indexPal[s] !== undefined) map.set(s, cssColor(indexPal[s]));
    else if (TRANSPARENT.has(s)) map.set(s, null);
    else map.set(s, pool[k++ % pool.length]);
  }
  return map;
}

const gridSize = (g) => ({ w: Math.max(...g.map((r) => r.length)), h: g.length });

function renderGrid(g, map, scale) {
  const { w, h } = gridSize(g);
  const c = makeCanvas(w * scale, h * scale);
  const x = c.getContext('2d');
  g.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const col = map.get(row[i]);
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(i * scale, y * scale, scale, scale);
    }
  });
  return c;
}

// Version vectorielle : un rectangle par suite de pixels de même couleur sur une ligne
function gridShapes(g, map, scale, ox, oy) {
  const shapes = [];
  g.forEach((row, y) => {
    let i = 0;
    while (i < row.length) {
      const col = map.get(row[i]);
      let j = i + 1;
      while (j < row.length && map.get(row[j]) === col) j++;
      if (col) {
        const x0 = ox + i * scale, x1 = ox + j * scale, y0 = oy + y * scale, y1 = y0 + scale;
        shapes.push({ id: newId(), pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], smooth: false, closed: true, stroke: null, width: 0, fill: col });
      }
      i = j;
    }
  });
  return shapes;
}

// ---------------------------------------------------------- Fenêtre d'import
export async function importSpriteScript(file = null) {
  commitFloating();
  if (!file) file = await openFile([{ name: 'Script de sprites', extensions: ['js', 'mjs', 'txt', 'json'] }]);
  if (!file) return;
  let found, srcColors = [], warning = null;
  try {
    const code = new TextDecoder().decode(file.bytes);
    const vars = file.name.toLowerCase().endsWith('.json') ? { [file.name.replace(/\.json$/i, '')]: JSON.parse(code) } : await runScript(code);
    warning = vars.__warning || null;
    srcColors = colorsInSource(code);
    found = findSprites(vars);
  } catch (e) {
    return toast('Impossible de lire ' + file.name + ' : ' + e.message, 'error', 6000);
  }
  const { sprites, charMap, indexPal } = found;
  if (!sprites.length) {
    if (warning) return toast('Aucun sprite trouvé, le script s’arrête sur une erreur : ' + warning, 'error', 7000);
    return toast('Aucun sprite trouvé dans ce fichier. Il faut un tableau de lignes, ex. const sprite = ["..##..", ".####."];', 'warn', 7000);
  }

  const symbols = symbolsOf(sprites);
  const map = defaultMapping(symbols, charMap, indexPal, charMap || indexPal ? [] : srcColors);
  const selected = new Set(sprites.map((_, i) => i));
  // on peut ajouter au projet ouvert seulement si un projet est affiché (pas l'écran d'accueil)
  const canPlace = !!app.doc && document.getElementById('startScreen').classList.contains('hidden');
  let place = canPlace ? 'insert' : 'new';
  let scale = 1;

  const box = el('div', 'sprite-import');
  const list = el('div', 'si-list');
  const colors = el('div', 'si-colors');
  const opts = el('div', 'si-opts');
  box.append(el('h4', null, `${sprites.length} sprite${sprites.length > 1 ? 's' : ''} trouvé${sprites.length > 1 ? 's' : ''} dans ${escapeHtml(file.name)}`), list,
    el('h4', null, 'Couleurs'), colors, el('h4', null, 'Placement'), opts);

  const previews = [];
  sprites.forEach((s, i) => {
    const { w, h } = gridSize(s.frames[0]);
    const row = el('label', 'si-item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.onchange = () => (cb.checked ? selected.add(i) : selected.delete(i));
    const pv = el('div', 'si-preview');
    previews.push({ pv, s });
    row.append(cb, pv, el('div', 'si-meta', `<b>${escapeHtml(s.name)}</b><span>${w} × ${h} px · ${s.frames.length} frame${s.frames.length > 1 ? 's' : ''}</span>`));
    list.appendChild(row);
  });
  const drawPreviews = () => {
    for (const { pv, s } of previews) {
      pv.innerHTML = '';
      const { w, h } = gridSize(s.frames[0]);
      const z = Math.max(1, Math.min(8, Math.floor(48 / Math.max(w, h))));
      for (const f of s.frames.slice(0, 6)) {
        const c = renderGrid(f, map, z);
        c.className = 'si-canvas';
        pv.appendChild(c);
      }
    }
  };

  for (const sym of symbols) {
    const r = el('div', 'si-color');
    const label = typeof sym === 'number' ? String(sym) : sym === ' ' ? '␣' : sym;
    const inp = el('input');
    inp.type = 'color';
    inp.value = map.get(sym) || app.color;
    const tr = el('label', 'rcheck');
    tr.innerHTML = `<input type="checkbox" ${map.get(sym) ? '' : 'checked'}><span>vide</span>`;
    const trCb = tr.querySelector('input');
    inp.disabled = trCb.checked;
    inp.oninput = () => {
      map.set(sym, inp.value);
      drawPreviews();
    };
    trCb.onchange = () => {
      inp.disabled = trCb.checked;
      map.set(sym, trCb.checked ? null : inp.value);
      drawPreviews();
    };
    r.append(el('kbd', null, escapeHtml(label)), inp, tr);
    colors.appendChild(r);
  }

  const placeSel = el('select');
  for (const [v, l, ok] of [
    ['new', 'Nouveau projet pixel à la taille du sprite', true],
    ['insert', 'Ajouter comme nouvelles frames (après la frame actuelle)', canPlace],
    ['overwrite', 'Remplacer à partir de la frame actuelle (calque actuel)', canPlace],
  ]) {
    if (!ok) continue;
    const o = el('option', null, l);
    o.value = v;
    o.selected = v === place;
    placeSel.appendChild(o);
  }
  placeSel.onchange = () => (place = placeSel.value);
  const scaleIn = el('input');
  Object.assign(scaleIn, { type: 'number', min: 1, max: 64, value: 1 });
  scaleIn.onchange = () => (scale = Math.max(1, Math.min(64, Math.round(+scaleIn.value) || 1)));
  const fl = (label, input) => {
    const l = el('label', 'form-row');
    l.append(el('span', null, label), input);
    return l;
  };
  opts.append(fl('Où ?', placeSel), fl('Taille d’un caractère (pixels)', scaleIn));
  drawPreviews();

  const ok = await modal({
    title: 'Importer des sprites depuis un script 👾',
    content: box,
    wide: true,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Importer', value: true, primary: true }],
  });
  if (!ok) return;
  const chosen = sprites.filter((_, i) => selected.has(i));
  if (!chosen.length) return toast('Aucun sprite sélectionné');
  applyImport(chosen, map, scale, place);
}

function applyImport(chosen, map, scale, place) {
  const grids = chosen.flatMap((s) => s.frames);
  const W = Math.max(...grids.map((g) => gridSize(g).w)) * scale;
  const H = Math.max(...grids.map((g) => gridSize(g).h)) * scale;

  if (place === 'new') {
    createProject('pixel', W, H, app.doc?.fps || 8);
    const d = app.doc;
    const layer = d.layers[0];
    grids.forEach((g, i) => {
      if (i >= d.frames.length) d.frames.push(d.makeFrame());
      const c = d.getCel(layer.id, d.frames[i].id);
      ctx2d(c).drawImage(renderGrid(g, map, scale), 0, 0);
      d.updateFlag(layer.id, d.frames[i].id);
    });
    app.frameIndex = 0;
    app.dirty = true;
    fitView();
    requestRender();
    refreshUI();
    return toast(`${grids.length} frame${grids.length > 1 ? 's' : ''} importée${grids.length > 1 ? 's' : ''} 👾`, 'ok');
  }

  if (curLayer().locked) return toast('Ce calque est verrouillé 🔒', 'warn');
  let grew = false;
  structural(() => {
    const d = app.doc;
    if (d.mode === 'pixel' && (W > d.width || H > d.height)) {
      d.resize(Math.max(W, d.width), Math.max(H, d.height), 'topleft');
      grew = true;
    }
    const layer = curLayer();
    let fi = app.frameIndex + (place === 'insert' ? 1 : 0);
    for (const g of grids) {
      if (place === 'insert') d.frames.splice(fi, 0, d.makeFrame());
      else if (fi >= d.frames.length) d.frames.push(d.makeFrame());
      const frame = d.frames[fi];
      const { w, h } = gridSize(g);
      const ox = Math.floor((d.width - w * scale) / 2), oy = Math.floor((d.height - h * scale) / 2);
      const cel = d.getCel(layer.id, frame.id);
      if (d.mode === 'pixel') {
        const x = ctx2d(cel);
        if (place === 'overwrite') x.clearRect(0, 0, d.width, d.height);
        x.drawImage(renderGrid(g, map, scale), ox, oy);
        d.updateFlag(layer.id, frame.id);
      } else {
        if (place === 'overwrite') cel.shapes = [];
        cel.shapes.push(...gridShapes(g, map, scale, ox, oy));
      }
      fi++;
    }
    if (place === 'insert') app.frameIndex++;
  });
  if (grew) fitView();
  toast(`${grids.length} frame${grids.length > 1 ? 's' : ''} importée${grids.length > 1 ? 's' : ''} 👾${grew ? ' (canevas agrandi)' : ''}`, 'ok');
}
