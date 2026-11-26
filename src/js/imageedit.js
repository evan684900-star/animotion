// « Modifier l'image » : luminosité, contraste, couleurs… sur une image importée ou sur le dessin
import { app, curLayer, curFrame, refreshUI } from './state.js';
import { el, makeCanvas, ctx2d, cloneCanvas, loadImage, escapeHtml } from './util.js';
import { modal, toast } from './dialogs.js';
import { pushHistory, celEntry } from './history.js';
import { requestRender } from './view.js';
import { getImage } from './render.js';

const DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: false, sepia: false, invert: false, palette: false, flipH: false, flipV: false };

/** Applique les réglages à une image source et renvoie un nouveau canvas */
export function renderAdjust(src, o, w, h) {
  return render(src, { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, ...o }, w ?? src.width, h ?? src.height);
}

function render(src, o, w = src.width, h = src.height) {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  x.filter = [
    `brightness(${o.brightness}%)`, `contrast(${o.contrast}%)`, `saturate(${o.saturate}%)`, `hue-rotate(${o.hue}deg)`,
    o.blur ? `blur(${o.blur}px)` : '', o.grayscale ? 'grayscale(1)' : '', o.sepia ? 'sepia(1)' : '', o.invert ? 'invert(1)' : '',
  ].filter(Boolean).join(' ');
  x.imageSmoothingEnabled = app.mode !== 'pixel';
  x.save();
  x.translate(o.flipH ? w : 0, o.flipV ? h : 0);
  x.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
  x.drawImage(src, 0, 0, w, h);
  x.restore();
  x.filter = 'none';
  if (o.palette && app.palette.length) toPalette(x, w, h);
  return c;
}

// Chaque pixel prend la couleur la plus proche de la palette (photo -> pixel art)
function toPalette(x, w, h) {
  const pal = app.palette.filter((c) => c !== 'transparent').map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const img = x.getImageData(0, 0, w, h), d = img.data, cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let best = cache.get(key);
    if (!best) {
      let bd = Infinity;
      for (const p of pal) {
        const dr = p[0] - d[i], dg = p[1] - d[i + 1], db = p[2] - d[i + 2];
        const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (dist < bd) { bd = dist; best = p; }
      }
      cache.set(key, best);
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2]; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}

/** Ce qu'on va modifier : la sélection, l'image sélectionnée ou toute la frame du calque */
async function findTarget() {
  const d = app.doc, l = curLayer(), f = curFrame();
  if (l.locked) throw new Error('Ce calque est verrouillé 🔒');
  if (d.mode === 'pixel') {
    if (app.floating) return { kind: 'floating', label: 'la sélection', src: cloneCanvas(app.floating.src || app.floating.canvas) };
    const cel = d.getCel(l.id, f.id);
    const r = app.sel || { x: 0, y: 0, w: d.width, h: d.height };
    const src = makeCanvas(r.w, r.h);
    ctx2d(src).drawImage(cel, -r.x, -r.y);
    return { kind: 'pixels', label: app.sel ? 'la sélection' : `la frame ${app.frameIndex + 1} du calque « ${l.name} »`, src, rect: r };
  }
  const cel = d.getCel(l.id, f.id);
  const shape = cel.shapes.find((s) => s.img && app.vsel.has(s.id)) || (cel.shapes.filter((s) => s.img).length === 1 ? cel.shapes.find((s) => s.img) : null);
  if (!shape) throw new Error('Sélectionne d’abord une image avec le Pointeur (V)');
  const img = getImage(shape.img).complete ? getImage(shape.img) : await loadImage(shape.img);
  const src = makeCanvas(shape.iw, shape.ih);
  ctx2d(src).drawImage(img, 0, 0, shape.iw, shape.ih);
  return { kind: 'shape', label: 'l’image sélectionnée', src, shape };
}

function apply(t, out) {
  const d = app.doc, l = curLayer(), f = curFrame();
  if (t.kind === 'floating') {
    const fl = app.floating;
    fl.src = out;
    fl.canvas = out.width === fl.canvas.width && out.height === fl.canvas.height ? out : (() => {
      const c = makeCanvas(fl.canvas.width, fl.canvas.height);
      const x = ctx2d(c);
      x.imageSmoothingEnabled = false;
      x.drawImage(out, 0, 0, c.width, c.height);
      return c;
    })();
  } else if (t.kind === 'pixels') {
    const c = ctx2d(d.getCel(l.id, f.id));
    const before = c.getImageData(0, 0, d.width, d.height);
    c.clearRect(t.rect.x, t.rect.y, t.rect.w, t.rect.h);
    c.drawImage(out, t.rect.x, t.rect.y);
    pushHistory(celEntry(l.id, f.id, before, c.getImageData(0, 0, d.width, d.height)));
    d.updateFlag(l.id, f.id);
  } else {
    const cel = d.getCel(l.id, f.id);
    const before = structuredClone(cel.shapes);
    t.shape.img = out.toDataURL('image/png');
    pushHistory(celEntry(l.id, f.id, before, structuredClone(cel.shapes)));
  }
  requestRender();
  refreshUI();
}

export async function showImageAdjust() {
  if (!app.doc) return;
  let t;
  try {
    t = await findTarget();
  } catch (e) {
    return toast(e.message, 'warn', 4500);
  }
  const o = { ...DEFAULTS };
  const pixel = app.mode === 'pixel';
  const box = el('div', 'ie');
  box.innerHTML = `
    <div class="ie-previews">
      <figure><canvas class="ie-before"></canvas><figcaption>Avant</figcaption></figure>
      <figure><canvas class="ie-after"></canvas><figcaption>Après</figcaption></figure>
    </div>
    <p class="muted">Modifie ${escapeHtml(t.label)} — annulable avec Ctrl+Z.</p>
    <div class="ie-controls"></div>`;
  const controls = box.querySelector('.ie-controls');
  // aperçus réduits (rapides) à 200 px max
  const k = Math.min(1, 200 / Math.max(t.src.width, t.src.height));
  const pw = Math.max(1, Math.round(t.src.width * k)), ph = Math.max(1, Math.round(t.src.height * k));
  const small = makeCanvas(pw, ph);
  ctx2d(small).imageSmoothingEnabled = !pixel;
  ctx2d(small).drawImage(t.src, 0, 0, pw, ph);
  for (const sel of ['.ie-before', '.ie-after']) {
    const c = box.querySelector(sel);
    c.width = pw;
    c.height = ph;
  }
  ctx2d(box.querySelector('.ie-before')).drawImage(small, 0, 0);
  const preview = () => {
    const c = box.querySelector('.ie-after');
    const x = ctx2d(c);
    x.clearRect(0, 0, pw, ph);
    x.drawImage(render(small, { ...o, blur: o.blur * k }), 0, 0);
  };

  const sliders = [
    ['brightness', 'Luminosité', 0, 200, '%'], ['contrast', 'Contraste', 0, 200, '%'], ['saturate', 'Saturation', 0, 300, '%'],
    ['hue', 'Teinte', -180, 180, '°'], ['blur', 'Flou', 0, 20, ' px'],
  ];
  for (const [key, label, min, max, unit] of sliders) {
    const row = el('div', 'xp-row');
    const r = el('input');
    Object.assign(r, { type: 'range', min, max, value: o[key] });
    const v = el('span', 'val', o[key] + unit);
    r.oninput = () => { o[key] = +r.value; v.textContent = r.value + unit; preview(); };
    r.ondblclick = () => { r.value = DEFAULTS[key]; r.oninput(); };
    r.title = 'Double-clic : valeur d’origine';
    row.append(el('label', null, label), r, v);
    controls.appendChild(row);
  }
  const checks = el('div', 'ie-checks');
  for (const [key, label] of [['grayscale', 'Noir et blanc'], ['sepia', 'Sépia'], ['invert', 'Inverser les couleurs'], ['flipH', 'Miroir ↔'], ['flipV', 'Miroir ↕'], ...(pixel ? [['palette', '🎨 Couleurs de la palette (effet pixel art)']] : [])]) {
    const l = el('label', 'rcheck');
    l.innerHTML = `<input type="checkbox"><span>${label}</span>`;
    l.querySelector('input').onchange = (e) => { o[key] = e.target.checked; preview(); };
    checks.appendChild(l);
  }
  controls.appendChild(checks);
  preview();

  const ok = await modal({
    title: 'Modifier l’image 🖼️',
    content: box,
    wide: true,
    buttons: [{ label: 'Annuler', value: false }, { label: 'Appliquer', value: true, primary: true }],
  });
  if (!ok) return;
  apply(t, render(t.src, o));
  toast('Image modifiée ✔ (Ctrl+Z pour annuler)', 'ok');
}
