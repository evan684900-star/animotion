// Mode Montage : composition d'une image du montage au temps t
import { M, clipsOn, clipEnd, mediaById, trackById } from './model.js';
import { animFrame, gifFrame } from './media.js';
import { makeCanvas } from '../util.js';

export const hooks = { redraw: () => {}, onElement: () => {} };

// ---------------------------------------------------------- éléments <video>/<audio> (un par clip)
const elements = new Map();
export function elementFor(c) {
  const rt = M.media.get(c.media);
  if (!rt?.url) return null;
  let el = elements.get(c.id);
  if (!el || el.dataset.src !== rt.url) {
    el?.pause();
    el = document.createElement(c.type === 'audio' ? 'audio' : 'video');
    el.preload = 'auto';
    el.playsInline = true;
    el.src = rt.url;
    el.dataset.src = rt.url;
    el.preservesPitch = true;
    el.addEventListener('seeked', () => hooks.redraw());
    el.addEventListener('loadeddata', () => hooks.redraw());
    elements.set(c.id, el);
    hooks.onElement(el);
  }
  return el;
}
export const allElements = () => elements;
export function pruneElements() {
  const ids = new Set(M.project?.clips.map((c) => c.id) || []);
  for (const [id, el] of elements) if (!ids.has(id)) { el.pause(); elements.delete(id); }
}
export function disposeAll() {
  for (const el of elements.values()) { el.pause(); el.removeAttribute('src'); el.load(); }
  elements.clear();
}

// ---------------------------------------------------------- filtres prédéfinis
export const FILTERS = {
  none: { label: 'Original' },
  vif: { label: 'Vif', saturate: 150, contrast: 115 },
  doux: { label: 'Doux', contrast: 90, brightness: 106, saturate: 90 },
  vintage: { label: 'Vintage', sepia: 45, contrast: 108, saturate: 85, brightness: 104 },
  nb: { label: 'Noir & blanc', grayscale: 100, contrast: 110 },
  sepia: { label: 'Sépia', sepia: 90 },
  chaud: { label: 'Chaud', saturate: 115, tint: ['#ff8a2a', 0.14] },
  froid: { label: 'Froid', saturate: 95, tint: ['#2a7fff', 0.16] },
  cine: { label: 'Ciné', contrast: 122, saturate: 85, tint: ['#0f6a6a', 0.1] },
  retro: { label: 'Rétro', sepia: 35, hue: -12, contrast: 92 },
  neon: { label: 'Néon', saturate: 210, contrast: 125, hue: 14 },
  pastel: { label: 'Pastel', saturate: 60, brightness: 112, contrast: 90 },
  nuit: { label: 'Nuit', brightness: 72, saturate: 70, tint: ['#1d3b8f', 0.22] },
  drama: { label: 'Dramatique', contrast: 150, brightness: 90, saturate: 70 },
  reve: { label: 'Rêve', brightness: 110, saturate: 120, blur: 1, tint: ['#ff7ad9', 0.08] },
  delave: { label: 'Délavé', contrast: 80, brightness: 110, saturate: 70 },
};
const NEUTRAL = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 };

function filterOf(c, extraBlur, sx) {
  const f = FILTERS[c.filter?.name] || FILTERS.none;
  const k = (c.filter?.amount ?? 100) / 100;
  const v = {};
  for (const key of Object.keys(NEUTRAL)) {
    const preset = f[key] === undefined ? NEUTRAL[key] : NEUTRAL[key] + (f[key] - NEUTRAL[key]) * k;
    const a = c.adjust?.[key] ?? NEUTRAL[key];
    v[key] = key === 'hue' || key === 'blur' || key === 'grayscale' || key === 'sepia' || key === 'invert' ? preset + a - NEUTRAL[key] : (preset * a) / 100;
  }
  const parts = [];
  if (v.brightness !== 100) parts.push(`brightness(${v.brightness}%)`);
  if (v.contrast !== 100) parts.push(`contrast(${v.contrast}%)`);
  if (v.saturate !== 100) parts.push(`saturate(${v.saturate}%)`);
  if (v.hue) parts.push(`hue-rotate(${v.hue}deg)`);
  if (v.grayscale) parts.push(`grayscale(${Math.min(100, v.grayscale)}%)`);
  if (v.sepia) parts.push(`sepia(${Math.min(100, v.sepia)}%)`);
  if (v.invert) parts.push(`invert(${Math.min(100, v.invert)}%)`);
  const blur = (v.blur + extraBlur) * sx;
  if (blur > 0.05) parts.push(`blur(${blur}px)`);
  return { css: parts.join(' ') || 'none', tint: f.tint ? [f.tint[0], f.tint[1] * k] : null };
}

// ---------------------------------------------------------- textes, formes
const textCache = new Map();
export function renderText(c, local = Infinity) {
  const T = c.text;
  const full = String(T.content ?? '');
  // machine à écrire : ~14 lettres par seconde, sans dépasser 70 % de la durée du clip
  const progress = local / Math.max(0.3, Math.min(c.duration * 0.7, full.length * 0.07));
  const shown = T.typewriter ? full.slice(0, Math.round(full.length * Math.min(1, progress))) : full;
  const key = JSON.stringify(T) + '|' + shown.length;
  if (textCache.has(key)) return textCache.get(key);
  const font = `${T.italic ? 'italic ' : ''}${T.bold ? 800 : 400} ${T.size}px "${T.font}", "Segoe UI", sans-serif`;
  const m = makeCanvas(4, 4).getContext('2d');
  m.font = font;
  if ('letterSpacing' in m) m.letterSpacing = `${T.spacing || 0}px`;
  const lines = full.split('\n');
  const lh = T.size * 1.18;
  const widths = lines.map((l) => m.measureText(l || ' ').width);
  const ow = T.outline ? T.outlineWidth : 0;
  const pad = (T.bg ? T.size * 0.35 : 0) + ow + (T.glow ? T.size * 0.4 : T.shadow ? T.size * 0.12 : 4);
  const w = Math.ceil(Math.max(...widths) + pad * 2), h = Math.ceil(lines.length * lh + pad * 2);
  const cv = makeCanvas(Math.min(w, 8000), Math.min(h, 8000));
  const x = cv.getContext('2d');
  x.font = font;
  if ('letterSpacing' in x) x.letterSpacing = `${T.spacing || 0}px`;
  x.textBaseline = 'middle';
  x.textAlign = T.align;
  if (T.bg) {
    x.globalAlpha = T.bgOpacity ?? 0.6;
    x.fillStyle = T.bgColor;
    x.beginPath();
    x.roundRect(ow / 2, ow / 2, w - ow, h - ow, T.size * 0.25);
    x.fill();
    x.globalAlpha = 1;
  }
  const ax = T.align === 'left' ? pad : T.align === 'right' ? w - pad : w / 2;
  const shownLines = shown.split('\n');
  shownLines.forEach((line, i) => {
    const y = pad + lh * i + lh / 2;
    if (T.outline && ow > 0) {
      x.lineJoin = 'round';
      x.lineWidth = ow * 2;
      x.strokeStyle = T.outlineColor;
      x.strokeText(line, ax, y);
    }
    if (T.glow) { x.shadowColor = T.color; x.shadowBlur = T.size * 0.35; }
    else if (T.shadow) { x.shadowColor = (T.shadowColor || '#000000') + 'aa'; x.shadowBlur = T.size * 0.08; x.shadowOffsetY = T.size * 0.05; }
    x.fillStyle = T.color;
    x.fillText(line, ax, y);
    if (T.glow) x.fillText(line, ax, y);
    x.shadowColor = 'transparent';
  });
  if (textCache.size > 300) textCache.clear();
  textCache.set(key, cv);
  return cv;
}

const shapeCache = new Map();
export function renderShape(c) {
  const s = c.shape || { kind: 'rect', w: 400, h: 400 };
  const key = JSON.stringify(s) + c.color;
  if (shapeCache.has(key)) return shapeCache.get(key);
  const w = Math.max(2, Math.round(s.w)), h = Math.max(2, Math.round(s.h));
  const cv = makeCanvas(w, h);
  const x = cv.getContext('2d');
  x.fillStyle = c.color || '#2f8cff';
  x.beginPath();
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;
  switch (s.kind) {
    case 'circle': x.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'round': x.roundRect(0, 0, w, h, Math.min(w, h) * 0.18); break;
    case 'triangle': x.moveTo(cx, 0); x.lineTo(w, h); x.lineTo(0, h); x.closePath(); break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        x[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      x.closePath();
      break;
    case 'heart':
      x.moveTo(cx, h * 0.95);
      x.bezierCurveTo(-w * 0.1, h * 0.55, w * 0.1, -h * 0.1, cx, h * 0.28);
      x.bezierCurveTo(w * 0.9, -h * 0.1, w * 1.1, h * 0.55, cx, h * 0.95);
      break;
    case 'arrow':
      x.moveTo(0, h * 0.35); x.lineTo(w * 0.6, h * 0.35); x.lineTo(w * 0.6, 0); x.lineTo(w, cy);
      x.lineTo(w * 0.6, h); x.lineTo(w * 0.6, h * 0.65); x.lineTo(0, h * 0.65); x.closePath();
      break;
    default: x.rect(0, 0, w, h);
  }
  x.fill();
  shapeCache.set(key, cv);
  return cv;
}

// ---------------------------------------------------------- source d'un clip
let colorCv = null;
/** Ce qu'il faut dessiner pour un clip : { src, w, h, project } (project = tailles exprimées en pixels du projet) */
/** Pendant l'export rapide : images vidéo décodées à l'avance (clip -> canvas), à la place des éléments <video> */
export const frameSource = { get: null };

function sourceOf(c, local, W, H) {
  const mt = c.in + local * c.speed;
  const m = c.media && mediaById(c.media);
  const rt = c.media && M.media.get(c.media);
  switch (c.type) {
    case 'video': {
      const f = frameSource.get?.(c);
      if (f) return { src: f, w: f.width, h: f.height };
      if (f === null) return null;
      const el = elementFor(c);
      if (!el || el.readyState < 2 || !el.videoWidth) return null;
      return { src: el, w: el.videoWidth, h: el.videoHeight };
    }
    case 'image':
      return rt?.img ? { src: rt.img, w: m.width, h: m.height } : null;
    case 'gif': {
      const f = gifFrame(rt, mt, c.loop);
      return f ? { src: f, w: f.width, h: f.height } : null;
    }
    case 'anim': {
      const f = animFrame(m, rt, mt, W, H, c.loop);
      return f ? { src: f, w: f.width, h: f.height, pixel: m?.pixel } : null;
    }
    case 'color':
      if (!colorCv) colorCv = makeCanvas(2, 2);
      { const x = colorCv.getContext('2d'); x.fillStyle = c.color || '#000'; x.fillRect(0, 0, 2, 2); }
      return { src: colorCv, w: 2, h: 2, fill: true };
    case 'shape': {
      const cv = renderShape(c);
      return { src: cv, w: cv.width, h: cv.height, project: true };
    }
    case 'text': {
      const cv = renderText(c, local);
      return { src: cv, w: cv.width, h: cv.height, project: true };
    }
  }
  return null;
}

// ---------------------------------------------------------- animations d'entrée / sortie et mouvement
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const backOut = (t) => { const k = 1.70158; return 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2; };
export const ANIMS = {
  none: 'Aucune', fade: 'Fondu', 'slide-left': 'Glisser ←', 'slide-right': 'Glisser →', 'slide-up': 'Glisser ↑', 'slide-down': 'Glisser ↓',
  'zoom-in': 'Zoom avant', 'zoom-out': 'Zoom arrière', pop: 'Rebond', spin: 'Rotation', blur: 'Flou', bounce: 'Chute rebondie',
};
function applyAnim(type, a, tf, out) {
  // a : 0 = invisible (début de l'entrée / fin de la sortie), 1 = normal
  if (type === 'none' || a >= 1) return;
  const e = easeOut(a);
  switch (type) {
    case 'fade': tf.opacity *= e; break;
    case 'slide-left': tf.x += (1 - e) * 0.6; tf.opacity *= Math.min(1, a * 3); break;
    case 'slide-right': tf.x -= (1 - e) * 0.6; tf.opacity *= Math.min(1, a * 3); break;
    case 'slide-up': tf.y += (1 - e) * 0.6; tf.opacity *= Math.min(1, a * 3); break;
    case 'slide-down': tf.y -= (1 - e) * 0.6; tf.opacity *= Math.min(1, a * 3); break;
    case 'zoom-in': tf.scale *= 0.3 + 0.7 * e; tf.opacity *= e; break;
    case 'zoom-out': tf.scale *= 1.8 - 0.8 * e; tf.opacity *= e; break;
    case 'pop': tf.scale *= Math.max(0, backOut(a)); break;
    case 'spin': tf.rotation += (1 - e) * (out ? 180 : -180); tf.scale *= 0.4 + 0.6 * e; tf.opacity *= e; break;
    case 'blur': tf.blur += (1 - e) * 24; tf.opacity *= e; break;
    case 'bounce': {
      const b = a < 0.55 ? (a / 0.55) ** 2 : a < 0.8 ? 1 - 0.18 * Math.sin(((a - 0.55) / 0.25) * Math.PI) : 1 - 0.06 * Math.sin(((a - 0.8) / 0.2) * Math.PI);
      tf.y -= (1 - b) * (out ? -0.7 : 0.7);
      break;
    }
  }
}

function transformAt(c, local) {
  const tf = { ...c.transform, blur: 0 };
  if (c.motion?.enabled) {
    const p = Math.max(0, Math.min(1, local / c.duration));
    const e = c.motion.ease === 'linear' ? p : easeInOut(p);
    for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) tf[k] = c.transform[k] + (c.motion.to[k] - c.transform[k]) * e;
  }
  if (c.animIn?.type !== 'none' && c.animIn.duration > 0) applyAnim(c.animIn.type, Math.min(1, local / c.animIn.duration), tf, false);
  if (c.animOut?.type !== 'none' && c.animOut.duration > 0) applyAnim(c.animOut.type, Math.min(1, (c.duration - local) / c.animOut.duration), tf, true);
  return tf;
}

// ---------------------------------------------------------- incrustation (fond vert)
const keyCv = makeCanvas(2, 2);
function chromaKey(src, sx, sy, sw, sh, dw, dh, ch) {
  const k = Math.min(1, 960 / Math.max(dw, dh, 1));
  const w = Math.max(1, Math.round(dw * k)), h = Math.max(1, Math.round(dh * k));
  keyCv.width = w;
  keyCv.height = h;
  const x = keyCv.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const n = parseInt(ch.color.slice(1), 16);
  const kr = (n >> 16) & 255, kg = (n >> 8) & 255, kb = n & 255;
  // comparaison en chrominance (Cb, Cr) : insensible à la luminosité
  const kcb = -0.169 * kr - 0.331 * kg + 0.5 * kb, kcr = 0.5 * kr - 0.419 * kg - 0.081 * kb;
  const tol = (ch.tolerance / 100) * 120, soft = Math.max(1, (ch.softness / 100) * 120);
  for (let i = 0; i < d.length; i += 4) {
    const cb = -0.169 * d[i] - 0.331 * d[i + 1] + 0.5 * d[i + 2], cr = 0.5 * d[i] - 0.419 * d[i + 1] - 0.081 * d[i + 2];
    const dist = Math.hypot(cb - kcb, cr - kcr);
    if (dist < tol) d[i + 3] = 0;
    else if (dist < tol + soft) {
      d[i + 3] *= (dist - tol) / soft;
      // retire le reflet vert sur les bords
      if (kg > kr && kg > kb) d[i + 1] = Math.min(d[i + 1], (d[i] + d[i + 2]) / 2 + 10);
    }
  }
  x.putImageData(img, 0, 0);
  return keyCv;
}

// ---------------------------------------------------------- dessin d'un clip
const offCv = makeCanvas(2, 2);
/** mod : { local, alpha, dx, dy, scale, blur, clip(ctx) } — utilisé par les transitions */
export function drawClip(ctx, c, t, W, H, mod = {}, bounds = null) {
  const local = mod.local ?? t - c.start;
  const s = sourceOf(c, local, W, H);
  if (!s) return;
  const sxF = W / M.project.width;
  const tf = transformAt(c, local);
  tf.opacity *= mod.alpha ?? 1;
  tf.x += mod.dx || 0;
  tf.y += mod.dy || 0;
  tf.scale *= mod.scale ?? 1;
  tf.blur += mod.blur || 0;
  if (tf.opacity <= 0.001 || tf.scale <= 0.0001) return;
  const cr = c.crop || { l: 0, r: 0, t: 0, b: 0 };
  const sx = cr.l * s.w, sy = cr.t * s.h, sw = Math.max(1, s.w * (1 - cr.l - cr.r)), sh = Math.max(1, s.h * (1 - cr.t - cr.b));
  let bx, by;
  if (s.project) bx = by = sxF;
  else if (s.fill || c.fit === 'fill') { bx = W / s.w; by = H / s.h; }
  else if (c.fit === 'cover') bx = by = Math.max(W / s.w, H / s.h);
  else bx = by = Math.min(W / s.w, H / s.h);
  const dw = sw * bx * tf.scale, dh = sh * by * tf.scale;
  const f = filterOf(c, tf.blur, sxF);
  ctx.save();
  if (mod.clip) mod.clip(ctx);
  ctx.globalAlpha = Math.max(0, Math.min(1, tf.opacity));
  ctx.globalCompositeOperation = c.blend || 'source-over';
  ctx.translate(tf.x * W, tf.y * H);
  ctx.rotate((tf.rotation * Math.PI) / 180);
  ctx.scale(tf.flipH ? -1 : 1, tf.flipV ? -1 : 1);
  ctx.imageSmoothingEnabled = !s.pixel;
  ctx.filter = f.css;
  if (c.chroma?.enabled || f.tint) {
    // passage par une image intermédiaire : incrustation et/ou teinte
    let img = c.chroma?.enabled ? chromaKey(s.src, sx, sy, sw, sh, dw, dh, c.chroma) : null;
    if (f.tint) {
      const w = Math.max(1, Math.round(Math.min(dw, 1920))), h = Math.max(1, Math.round(Math.min(dh, 1920)));
      offCv.width = w;
      offCv.height = h;
      const o = offCv.getContext('2d');
      o.imageSmoothingEnabled = !s.pixel;
      if (img) o.drawImage(img, 0, 0, w, h);
      else o.drawImage(s.src, sx, sy, sw, sh, 0, 0, w, h);
      o.globalCompositeOperation = 'source-atop';
      o.globalAlpha = f.tint[1];
      o.fillStyle = f.tint[0];
      o.fillRect(0, 0, w, h);
      img = offCv;
    }
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } else ctx.drawImage(s.src, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  bounds?.push({ id: c.id, cx: tf.x * W, cy: tf.y * H, w: dw, h: dh, rot: (tf.rotation * Math.PI) / 180 });
}

// ---------------------------------------------------------- transitions
export const TRANSITIONS = {
  none: 'Aucune', fondu: 'Fondu enchaîné', noir: 'Fondu au noir', blanc: 'Flash blanc', 'glisser-gauche': 'Glisser ←', 'glisser-droite': 'Glisser →',
  'glisser-haut': 'Glisser ↑', 'glisser-bas': 'Glisser ↓', zoom: 'Zoom', balayage: 'Balayage', cercle: 'Cercle', flou: 'Flou', tourbillon: 'Tourbillon',
};
function previousOf(c) {
  const list = clipsOn(c.track);
  const i = list.findIndex((x) => x.id === c.id);
  const prev = list[i - 1];
  return prev && Math.abs(clipEnd(prev) - c.start) < 0.08 ? prev : null;
}
function drawTransition(ctx, c, t, W, H, bounds) {
  const d = c.transition.duration, local = t - c.start, p = Math.max(0, Math.min(1, local / d));
  const prev = previousOf(c);
  const tail = prev ? { local: prev.duration + local } : null;
  const drawPrev = (mod = {}) => prev && drawClip(ctx, prev, t, W, H, { ...tail, ...mod });
  const e = easeInOut(p);
  switch (c.transition.type) {
    case 'fondu': drawPrev(); drawClip(ctx, c, t, W, H, { alpha: e }, bounds); break;
    case 'noir':
    case 'blanc': {
      if (p < 0.5) drawPrev(); else drawClip(ctx, c, t, W, H, {}, bounds);
      ctx.save();
      ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2;
      ctx.fillStyle = c.transition.type === 'noir' ? '#000' : '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'glisser-gauche': drawPrev({ dx: -e }); drawClip(ctx, c, t, W, H, { dx: 1 - e }, bounds); break;
    case 'glisser-droite': drawPrev({ dx: e }); drawClip(ctx, c, t, W, H, { dx: e - 1 }, bounds); break;
    case 'glisser-haut': drawPrev({ dy: -e }); drawClip(ctx, c, t, W, H, { dy: 1 - e }, bounds); break;
    case 'glisser-bas': drawPrev({ dy: e }); drawClip(ctx, c, t, W, H, { dy: e - 1 }, bounds); break;
    case 'zoom': drawPrev({ scale: 1 + e, alpha: 1 - e }); drawClip(ctx, c, t, W, H, { scale: 0.6 + 0.4 * e, alpha: e }, bounds); break;
    case 'flou': drawPrev({ blur: e * 30, alpha: 1 - e }); drawClip(ctx, c, t, W, H, { blur: (1 - e) * 30, alpha: e }, bounds); break;
    case 'tourbillon': drawPrev({ scale: 1 - e * 0.7, alpha: 1 - e }); drawClip(ctx, c, t, W, H, { scale: 0.3 + 0.7 * e, alpha: e }, bounds); break;
    case 'balayage':
      drawPrev();
      drawClip(ctx, c, t, W, H, { clip: (x) => { x.beginPath(); x.rect(0, 0, W * e, H); x.clip(); } }, bounds);
      break;
    case 'cercle':
      drawPrev();
      drawClip(ctx, c, t, W, H, { clip: (x) => { x.beginPath(); x.arc(W / 2, H / 2, Math.hypot(W, H) * 0.5 * e, 0, Math.PI * 2); x.clip(); } }, bounds);
      break;
    default: drawClip(ctx, c, t, W, H, {}, bounds);
  }
}

// ---------------------------------------------------------- effets (calques d'effet : s'appliquent à tout ce qui est en dessous)
export const EFFECTS = {
  tremblement: ['Tremblement', '📳'], flash: ['Flash', '⚡'], glitch: ['Glitch', '👾'], vhs: ['VHS', '📼'], grain: ['Grain de film', '🎞️'],
  vignette: ['Vignette', '⭕'], cinema: ['Bandes ciné', '🎬'], zoompulse: ['Zoom pulsé', '💓'], miroir: ['Miroir', '🪞'],
  nb: ['Noir & blanc', '⚫'], flou: ['Flou', '🌫️'], arcenciel: ['Arc-en-ciel', '🌈'], pixel: ['Pixelisation', '🟦'],
  neige: ['Neige', '❄️'], confettis: ['Confettis', '🎉'], coeurs: ['Cœurs', '💖'], etoiles: ['Étoiles', '✨'], bulles: ['Bulles', '🫧'],
  lumiere: ['Lumière chaude', '🌅'], fondunoir: ['Fondu au noir', '🌑'],
};
const tmpCv = makeCanvas(2, 2);
let noiseCv = null, scanCv = null;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function copyCanvas(ctx) {
  const c = ctx.canvas;
  if (tmpCv.width !== c.width || tmpCv.height !== c.height) { tmpCv.width = c.width; tmpCv.height = c.height; }
  const t = tmpCv.getContext('2d');
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = 'copy';
  t.drawImage(c, 0, 0);
  t.globalCompositeOperation = 'source-over';
  return tmpCv;
}
function redraw(ctx, W, H, fn, filter = 'none') {
  const src = copyCanvas(ctx);
  ctx.save();
  ctx.fillStyle = M.project.background.color;
  ctx.fillRect(0, 0, W, H);
  ctx.filter = filter;
  fn(src);
  ctx.restore();
}
function particles(ctx, W, H, local, k, kind) {
  const n = Math.round(30 + 170 * k);
  const glyph = { coeurs: '💖', etoiles: '✨', confettis: null, neige: null, bulles: null }[kind];
  const colors = ['#ff004d', '#ffec27', '#29adff', '#00e436', '#ff77a8', '#ffa300'];
  ctx.save();
  for (let i = 0; i < n; i++) {
    const r0 = hash(i), r1 = hash(i + 100), r2 = hash(i + 200);
    const speed = kind === 'bulles' ? -(0.05 + r1 * 0.1) : 0.06 + r1 * 0.16;
    let y = (r2 + local * speed) % 1.1;
    if (y < 0) y += 1.1;
    y = y * H * 1.1 - H * 0.05;
    const x = (r0 + Math.sin(local * (0.6 + r1) + i) * 0.02) * W;
    const size = (kind === 'neige' ? 2 + r1 * 6 : 8 + r1 * 18) * (W / 1920) * 2;
    if (glyph) {
      ctx.globalAlpha = kind === 'etoiles' ? 0.4 + 0.6 * Math.abs(Math.sin(local * 3 + i)) : 0.9;
      ctx.font = `${size * 2}px "Segoe UI Emoji", sans-serif`;
      ctx.fillText(glyph, x, y);
    } else if (kind === 'confettis') {
      ctx.fillStyle = colors[i % colors.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(local * (2 + r1 * 4) + i);
      ctx.fillRect(-size / 2, -size / 4, size, size / 2);
      ctx.restore();
    } else if (kind === 'bulles') {
      ctx.strokeStyle = 'rgba(200,230,255,.8)';
      ctx.lineWidth = Math.max(1, size / 8);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function applyEffect(ctx, c, local, W, H) {
  const k = Math.max(0, Math.min(1, c.effect?.intensity ?? 0.6));
  const type = c.effect?.type;
  const frame = Math.floor(local * M.project.fps);
  switch (type) {
    case 'tremblement': {
      const a = k * 0.03 * W;
      redraw(ctx, W, H, (s) => ctx.drawImage(s, (hash(frame) - 0.5) * a, (hash(frame + 9) - 0.5) * a));
      break;
    }
    case 'flash': {
      const a = k * Math.max(0, 1 - ((local * 2) % 1) * 3);
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
      break;
    }
    case 'zoompulse': {
      const s = 1 + 0.08 * k * Math.abs(Math.sin(local * Math.PI * 2));
      redraw(ctx, W, H, (src) => { ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.drawImage(src, -W / 2, -H / 2); });
      break;
    }
    case 'glitch': {
      const src = copyCanvas(ctx);
      const slices = 3 + Math.round(k * 8);
      for (let i = 0; i < slices; i++) {
        if (hash(frame * 7 + i) > 0.55) continue;
        const y = hash(frame * 3 + i) * H, h = (0.02 + hash(frame + i * 5) * 0.08) * H, dx = (hash(frame * 11 + i) - 0.5) * k * 0.12 * W;
        ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
      }
      ctx.save();
      ctx.globalAlpha = 0.35 * k;
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = 'hue-rotate(90deg)';
      ctx.drawImage(src, k * 0.008 * W, 0);
      ctx.restore();
      break;
    }
    case 'vhs': {
      const src = copyCanvas(ctx);
      ctx.save();
      ctx.globalAlpha = 0.3 * k;
      ctx.globalCompositeOperation = 'screen';
      ctx.filter = 'saturate(180%) hue-rotate(-20deg)';
      ctx.drawImage(src, k * 0.006 * W + Math.sin(local * 40) * 2, 0);
      ctx.restore();
      if (!scanCv) {
        scanCv = makeCanvas(4, 4);
        const x = scanCv.getContext('2d');
        x.fillStyle = 'rgba(0,0,0,.55)';
        x.fillRect(0, 0, 4, 1);
      }
      ctx.save();
      ctx.globalAlpha = 0.5 * k;
      ctx.fillStyle = ctx.createPattern(scanCv, 'repeat');
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'grain': {
      if (!noiseCv) {
        noiseCv = makeCanvas(256, 256);
        const x = noiseCv.getContext('2d');
        const img = x.createImageData(256, 256);
        for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        x.putImageData(img, 0, 0);
      }
      ctx.save();
      ctx.globalAlpha = 0.28 * k;
      ctx.globalCompositeOperation = 'overlay';
      const pat = ctx.createPattern(noiseCv, 'repeat');
      pat.setTransform(new DOMMatrix().translate(hash(frame) * 256, hash(frame + 3) * 256));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'vignette': {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.9 * k})`);
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      break;
    }
    case 'cinema': {
      const h = H * 0.12 * k * Math.min(1, local / 0.4) * Math.min(1, (c.duration - local) / 0.4);
      ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, h); ctx.fillRect(0, H - h, W, h); ctx.restore();
      break;
    }
    case 'miroir': {
      const src = copyCanvas(ctx);
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(src, 0, 0, W / 2, H, 0, 0, W / 2, H); ctx.restore();
      break;
    }
    case 'nb': redraw(ctx, W, H, (s) => ctx.drawImage(s, 0, 0), `grayscale(${k * 100}%)`); break;
    case 'flou': redraw(ctx, W, H, (s) => ctx.drawImage(s, 0, 0), `blur(${k * 24 * (W / 1920)}px)`); break;
    case 'arcenciel': redraw(ctx, W, H, (s) => ctx.drawImage(s, 0, 0), `hue-rotate(${local * 160}deg) saturate(${100 + k * 80}%)`); break;
    case 'pixel': {
      const src = copyCanvas(ctx);
      const b = Math.max(2, Math.round((4 + k * 36) * (W / 1920) * 1.5));
      const w = Math.max(1, Math.round(W / b)), h = Math.max(1, Math.round(H / b));
      offCv.width = w; offCv.height = h;
      offCv.getContext('2d').drawImage(src, 0, 0, w, h);
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(offCv, 0, 0, W, H); ctx.restore();
      break;
    }
    case 'neige': case 'confettis': case 'coeurs': case 'etoiles': case 'bulles':
      particles(ctx, W, H, local, k, type);
      break;
    case 'lumiere': {
      const x = W * (0.2 + 0.6 * ((Math.sin(local * 0.8) + 1) / 2));
      const g = ctx.createRadialGradient(x, H * 0.2, 0, x, H * 0.2, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, `rgba(255,170,80,${0.55 * k})`);
      g.addColorStop(1, 'rgba(255,80,40,0)');
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      break;
    }
    case 'fondunoir': {
      ctx.save(); ctx.globalAlpha = k * Math.min(1, local / Math.max(0.1, c.duration)); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
      break;
    }
  }
}

// ---------------------------------------------------------- image complète au temps t
const isActive = (c, t) => t >= c.start && t < clipEnd(c);

/** Dessine l'image du montage au temps t dans ctx (taille W × H). Renvoie les contours des clips dessinés. */
export function renderFrame(ctx, t, W, H) {
  const p = M.project;
  const bounds = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = p.background.color;
  ctx.fillRect(0, 0, W, H);
  // fond flou : la vidéo principale agrandie et floutée derrière (pratique en format vertical)
  if (p.background.type === 'blur') {
    const main = p.tracks.find((tr) => tr.kind === 'visual' && !tr.hidden);
    const c = main && clipsOn(main.id).find((x) => isActive(x, t) && ['video', 'image', 'gif', 'anim'].includes(x.type));
    if (c) {
      const s = sourceOf(c, t - c.start, W, H);
      if (s) {
        const k = Math.max(W / s.w, H / s.h) * 1.1;
        ctx.save();
        ctx.filter = `blur(${(p.background.blur || 30) * (W / 1920)}px) brightness(85%)`;
        ctx.drawImage(s.src, (W - s.w * k) / 2, (H - s.h * k) / 2, s.w * k, s.h * k);
        ctx.restore();
      }
    }
  }
  for (const track of p.tracks) {
    if (track.kind === 'audio' || track.hidden) continue;
    const active = clipsOn(track.id).filter((c) => isActive(c, t));
    if (track.kind === 'effect') {
      for (const c of active) applyEffect(ctx, c, t - c.start, W, H);
      continue;
    }
    for (const c of active) {
      if (c.transition?.type && c.transition.type !== 'none' && t - c.start < c.transition.duration) drawTransition(ctx, c, t, W, H, bounds);
      else drawClip(ctx, c, t, W, H, {}, bounds);
    }
  }
  return bounds;
}

/** Temps « média » d'un clip vidéo/audio au temps t, y compris pendant la transition vers le clip suivant */
export function mediaTimeAt(c, t) {
  return c.in + (t - c.start) * c.speed;
}
/** Le clip doit-il jouer au temps t ? (inclut la « traîne » utilisée par la transition du clip suivant) */
export function playsAt(c, t) {
  if (isActive(c, t)) return true;
  if (c.type !== 'video') return false;
  const next = clipsOn(c.track).find((x) => Math.abs(x.start - clipEnd(c)) < 0.08 && x.transition?.type !== 'none');
  return !!next && t >= next.start && t < next.start + next.transition.duration;
}
export { trackById };
