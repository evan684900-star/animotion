import { makeCanvas } from './util.js';

// --- Cache des images (formes "image" en mode dessin) ---
const imgCache = new Map();
let onImgLoad = () => {};
export function setImageLoadCallback(fn) {
  onImgLoad = fn;
}
export function getImage(src) {
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => onImgLoad();
    im.src = src;
    imgCache.set(src, im);
  }
  return im;
}

// --- Formes vectorielles ---
// Une forme = { id, pts:[[x,y]...], smooth, closed, stroke, width, fill } ou { img, iw, ih, pts:[4 coins] }
export function shapePath(s) {
  const p = new Path2D();
  const pts = s.pts;
  const n = pts.length;
  if (n === 0) return p;
  if (n === 1) {
    p.arc(pts[0][0], pts[0][1], Math.max((s.width || 1) / 2, 0.5), 0, Math.PI * 2);
    return p;
  }
  p.moveTo(pts[0][0], pts[0][1]);
  if (!s.smooth || n < 3) {
    for (let i = 1; i < n; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (s.closed) p.closePath();
    return p;
  }
  // Catmull-Rom -> Bézier : courbe lisse qui passe par tous les points
  const get = (i) => (s.closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = s.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    p.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
  if (s.closed) p.closePath();
  return p;
}

export function drawShape(ctx, s) {
  if (s.img) {
    const im = getImage(s.img);
    if (!im.complete || !im.naturalWidth) return;
    const [p0, p1, , p3] = s.pts;
    ctx.save();
    ctx.transform((p1[0] - p0[0]) / s.iw, (p1[1] - p0[1]) / s.iw, (p3[0] - p0[0]) / s.ih, (p3[1] - p0[1]) / s.ih, p0[0], p0[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(im, 0, 0, s.iw, s.ih);
    ctx.restore();
    return;
  }
  if (s.pts.length === 1) {
    ctx.fillStyle = s.stroke;
    ctx.fill(shapePath(s));
    return;
  }
  const p = shapePath(s);
  if (s.fill) {
    ctx.fillStyle = s.fill;
    ctx.fill(p);
  }
  if (s.stroke && s.width > 0) strokeBrush(ctx, s, p);
}

// ---------------------------------------------------------- styles du pinceau (mode Dessin)
export const VECTOR_BRUSHES = [
  ['round', '●', 'Rond'], ['square', '■', 'Carré'], ['calli', '✒️', 'Calligraphie'], ['dash', '┅', 'Tirets'],
  ['dots', '⋯', 'Pointillés'], ['marker', '🖍️', 'Feutre (transparent)'], ['neon', '💡', 'Néon'], ['double', '〓', 'Double trait'],
];
function strokeBrush(ctx, s, p) {
  const w = s.width;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = s.stroke;
  switch (s.brush) {
    case 'square': ctx.lineCap = 'square'; ctx.lineJoin = 'miter'; ctx.stroke(p); break;
    case 'dash': ctx.lineCap = 'butt'; ctx.setLineDash([w * 2.5, w * 1.5]); ctx.stroke(p); break;
    case 'dots': ctx.setLineDash([0.001, w * 2]); ctx.stroke(p); break;
    case 'marker': ctx.globalAlpha *= 0.5; ctx.lineCap = 'square'; ctx.stroke(p); break;
    case 'neon':
      ctx.shadowColor = s.stroke;
      ctx.shadowBlur = w * 2.5;
      ctx.stroke(p);
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(0.5, w * 0.35);
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha *= 0.85;
      ctx.stroke(p);
      break;
    case 'double':
      ctx.stroke(p);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = w * 0.45;
      ctx.stroke(p);
      break;
    case 'calli': {
      // plume biseautée à 45° : on repasse un trait fin décalé le long de la plume
      const n = Math.min(40, Math.max(3, Math.round(w * 1.5))), a = -Math.PI / 4;
      ctx.lineWidth = Math.max(0.6, w / n * 1.6);
      for (let k = 0; k <= n; k++) {
        const t = (k / n - 0.5) * w;
        ctx.save();
        ctx.translate(Math.cos(a) * t, Math.sin(a) * t);
        ctx.stroke(p);
        ctx.restore();
      }
      break;
    }
    default: ctx.stroke(p);
  }
  ctx.restore();
}

export function bbox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const m = s.img ? 0 : (s.width || 0) / 2;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

// --- Composition d'une frame ---
let scratch = null;
function scratchFor(c) {
  if (!scratch) scratch = makeCanvas(c.width, c.height);
  if (scratch.width !== c.width || scratch.height !== c.height) {
    scratch.width = c.width;
    scratch.height = c.height;
  }
  return scratch;
}

/**
 * Dessine la frame `fi` dans ctx avec la transformation T (coordonnées du document -> ctx).
 * extra = { layerId, draw(ctx) } permet de dessiner un aperçu "dans" un calque.
 */
export function drawFrame(ctx, doc, fi, T, extra) {
  const frame = doc.frames[fi];
  if (!frame) return;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const cel = doc.cels.get(doc.key(layer.id, frame.id));
    const hasExtra = extra && extra.layerId === layer.id;
    if (!cel && !hasExtra) continue;
    let target = ctx;
    if (layer.opacity < 1) {
      const sc = scratchFor(ctx.canvas);
      target = sc.getContext('2d');
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.clearRect(0, 0, sc.width, sc.height);
    }
    target.setTransform(...T);
    target.imageSmoothingEnabled = doc.mode !== 'pixel';
    if (cel) {
      if (doc.mode === 'pixel') target.drawImage(cel, 0, 0);
      else for (const s of cel.shapes) drawShape(target, s);
    }
    if (hasExtra) extra.draw(target);
    if (target !== ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(target.canvas, 0, 0);
      ctx.restore();
    }
  }
}

export function compositeFrame(doc, fi, scale = 1, bg = null) {
  const c = makeCanvas(doc.width * scale, doc.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  drawFrame(ctx, doc, fi, [scale, 0, 0, scale, 0, 0]);
  return c;
}
