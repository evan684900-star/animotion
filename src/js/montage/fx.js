// Mode Montage : bibliothèque des transitions et des effets
// Une transition reçoit l'image « avant » (A) et « après » (B) déjà dessinées, et les mélange selon p (0 → 1).
// Un effet modifie l'image déjà composée (tout ce qui est sous la piste d'effets).
import { makeCanvas } from '../util.js';

// ---------------------------------------------------------- outils
export const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const h2 = (i, j) => hash(i * 157.31 + j * 113.97);
function noise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const noise1 = (x) => noise2(x, 0.37);
const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const eo = (t) => 1 - (1 - t) ** 3;
const ei = (t) => t * t * t;
const bell = (p) => Math.sin(Math.PI * cl(p)); // 0 → 1 → 0
const backOut = (t) => { const s = 1.70158; return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };
const elasticOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
function bounceOut(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

// toiles de travail réutilisées
const pool = [];
function scratch(i, W, H, read = false) {
  let c = pool[i];
  if (!c) c = pool[i] = makeCanvas(W, H);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const x = c.getContext('2d', read ? { willReadFrequently: true } : undefined);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.imageSmoothingEnabled = true;
  x.clearRect(0, 0, W, H);
  return [c, x];
}
/** Calques A et B utilisés par le moteur pour les transitions */
export const layer = (i, W, H) => scratch(i, W, H);

/** Dessine une image plein cadre avec transformation autour d'un pivot (ox, oy en fraction du cadre) */
function put(ctx, src, W, H, o = {}) {
  const { a = 1, x = 0, y = 0, s = 1, sx = s, sy = s, r = 0, f = 'none', op = null, ox = 0.5, oy = 0.5 } = o;
  if (a <= 0.002 || Math.abs(sx) < 1e-4 || Math.abs(sy) < 1e-4) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, a);
  if (op) ctx.globalCompositeOperation = op;
  if (f !== 'none') ctx.filter = f;
  ctx.translate(W * ox + x * W, H * oy + y * H);
  if (r) ctx.rotate(r);
  ctx.scale(sx, sy);
  ctx.drawImage(src, -W * ox, -H * oy, W, H);
  ctx.restore();
}
function clipped(ctx, src, path) {
  ctx.save();
  ctx.beginPath();
  path(ctx);
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}
/** Dessine src à travers un masque peint par paint(x) (zones opaques = visibles) */
function masked(ctx, src, W, H, paint) {
  const [c, x] = scratch(2, W, H);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  paint(x);
  ctx.drawImage(c, 0, 0);
}
// masque calculé point par point sur une petite grille (puis agrandi)
const FW = 96, FH = 54;
let fCv = null, fCtx = null, fImg = null, lCv = null, lCtx = null;
function field(ctx, src, W, H, fn, smooth = true) {
  if (!fCv) { fCv = makeCanvas(FW, FH); fCtx = fCv.getContext('2d', { willReadFrequently: true }); fImg = fCtx.createImageData(FW, FH); }
  const d = fImg.data;
  for (let j = 0; j < FH; j++) {
    for (let i = 0; i < FW; i++) {
      const a = fn((i + 0.5) / FW, (j + 0.5) / FH, i, j), o = (j * FW + i) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
    }
  }
  fCtx.putImageData(fImg, 0, 0);
  masked(ctx, src, W, H, (x) => { x.imageSmoothingEnabled = smooth; x.drawImage(fCv, 0, 0, W, H); });
}
/** Luminosité (0..1) de src sur la petite grille */
function lumaGrid(src) {
  if (!lCv) { lCv = makeCanvas(FW, FH); lCtx = lCv.getContext('2d', { willReadFrequently: true }); }
  lCtx.clearRect(0, 0, FW, FH);
  lCtx.drawImage(src, 0, 0, FW, FH);
  const d = lCtx.getImageData(0, 0, FW, FH).data, out = new Float32Array(FW * FH);
  for (let i = 0; i < out.length; i++) out[i] = ((0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255) * (d[i * 4 + 3] / 255);
  return out;
}
function overlay(ctx, W, H, color, a, op = null) {
  if (a <= 0.002) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  if (op) ctx.globalCompositeOperation = op;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
/** Copies décalées (flou de mouvement) */
function smear(ctx, src, W, H, o, spread, dx = 1, dy = 0, n = 5) {
  if (spread < 0.002) return put(ctx, src, W, H, o);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1) - 0.5;
    put(ctx, src, W, H, { ...o, x: (o.x || 0) + k * spread * dx, y: (o.y || 0) + k * spread * dy, a: (o.a ?? 1) * (i === (n >> 1) ? 1 : 0.35) });
  }
}
/** Copies agrandies (flou radial) */
function zoomSmear(ctx, src, W, H, o, spread, n = 5) {
  if (spread < 0.002) return put(ctx, src, W, H, o);
  for (let i = 0; i < n; i++) put(ctx, src, W, H, { ...o, s: (o.s ?? 1) * (1 + (i / (n - 1)) * spread), a: (o.a ?? 1) * (i === 0 ? 1 : 0.3) });
}
/** Isole un canal de couleur (rouge, vert ou bleu) dans une toile de travail */
function channel(src, W, H, color, slot = 3) {
  const [c, x] = scratch(slot, W, H);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = color;
  x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0);
  return c;
}
function shapePath(x, kind, cx, cy, r, rot = 0) {
  const pts = [];
  if (kind === 'etoile') for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
  else if (kind === 'coeur') for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; pts.push([cx + (r / 17) * 16 * Math.sin(t) ** 3, cy - (r / 17) * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - r * 0.1]); }
  else if (kind === 'losange') pts.push([cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]);
  else if (kind === 'triangle') for (let i = 0; i < 3; i++) { const a = rot - Math.PI / 2 + (i * 2 * Math.PI) / 3; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  else if (kind === 'croix') { const w = r * 0.36; pts.push([cx - w, cy - r], [cx + w, cy - r], [cx + w, cy - w], [cx + r, cy - w], [cx + r, cy + w], [cx + w, cy + w], [cx + w, cy + r], [cx - w, cy + r], [cx - w, cy + w], [cx - r, cy + w], [cx - r, cy - w], [cx - w, cy - w]); }
  else if (kind === 'carre') pts.push([cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]);
  else return x.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
  pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
  x.closePath();
}
let noiseCv = null, scanCv = null;
function noiseTex() {
  if (!noiseCv) {
    noiseCv = makeCanvas(256, 256);
    const x = noiseCv.getContext('2d');
    const img = x.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = hash(i * 0.731) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
  }
  return noiseCv;
}
function noiseFill(ctx, W, H, a, seed, op = 'source-over', scale = 1, y = 0) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = op;
  const pat = ctx.createPattern(noiseTex(), 'repeat');
  pat.setTransform(new DOMMatrix().translate(hash(seed) * 256, hash(seed + 3) * 256).scale(scale));
  ctx.fillStyle = pat;
  ctx.fillRect(0, y, W, H);
  ctx.restore();
}
function scanlines(ctx, W, H, a) {
  if (!scanCv) {
    scanCv = makeCanvas(4, 4);
    const x = scanCv.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,.6)';
    x.fillRect(0, 0, 4, 2);
  }
  ctx.save();
  ctx.globalAlpha = a;
  const pat = ctx.createPattern(scanCv, 'repeat');
  pat.setTransform(new DOMMatrix().scale(Math.max(0.5, H / 1080)));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
function vignette(ctx, W, H, a, inner = 0.3, color = '0,0,0') {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.hypot(W, H) / 2);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(1, `rgba(${color},${Math.min(1, a)})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
/** Bascule A → B au milieu, avec un court fondu */
const swap = (ctx, A, B, W, H, p, w = 0.12) => { const m = cl((p - 0.5 + w / 2) / w); put(ctx, A, W, H, { a: 1 - m }); put(ctx, B, W, H, { a: m }); };
/** Volet doux dans la direction (dx, dy) */
function wipe(ctx, A, B, W, H, e, dx, dy, soft = 0.1) {
  put(ctx, A, W, H);
  const n = Math.hypot(dx, dy);
  dx /= n; dy /= n;
  const ox = dx >= 0 ? 0 : W, oy = dy >= 0 ? 0 : H;
  const L = Math.abs(W * dx) + Math.abs(H * dy), S = soft * L, s = e * (L + S);
  masked(ctx, B, W, H, (x) => {
    const g = x.createLinearGradient(ox + dx * (s - S), oy + dy * (s - S), ox + dx * s, oy + dy * s);
    g.addColorStop(0, '#000');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  });
}
/** Face de cube : tranches verticales dont la hauteur varie de h0 (gauche) à h1 (droite) */
function face(ctx, src, W, H, x0, x1, h0, h1, bright) {
  const n = 24, w = x1 - x0;
  if (w < 1) return;
  for (let i = 0; i < n; i++) {
    const sx = (i / n) * W, sw = W / n + 0.5, hh = h0 + ((h1 - h0) * (i + 0.5)) / n;
    ctx.drawImage(src, sx, 0, sw, H, x0 + (i / n) * w, (H - hh) / 2, w / n + 0.6, hh);
  }
  // face qui tourne : assombrie par un voile (bien plus rapide qu'un filtre par tranche)
  if (bright < 100) {
    ctx.save();
    ctx.globalAlpha *= (100 - bright) / 100;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(x0, (H - h0) / 2); ctx.lineTo(x1, (H - h1) / 2); ctx.lineTo(x1, (H + h1) / 2); ctx.lineTo(x0, (H + h0) / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------- TRANSITIONS
const T = [];
const tr = (cat, id, label, icon, draw, dur = 0.6) => T.push({ cat, id, label, icon, draw, dur });

// --- Fondus
tr('Fondus', 'fondu', 'Fondu enchaîné', '🌗', (c, A, B, p, W, H) => { put(c, A, W, H); put(c, B, W, H, { a: ease(p) }); });
tr('Fondus', 'noir', 'Fondu au noir', '🌑', (c, A, B, p, W, H) => { put(c, p < 0.5 ? A : B, W, H); overlay(c, W, H, '#000', 1 - Math.abs(p - 0.5) * 2); }, 0.8);
tr('Fondus', 'blanc', 'Flash blanc', '⚪', (c, A, B, p, W, H) => { put(c, p < 0.5 ? A : B, W, H); overlay(c, W, H, '#fff', 1 - Math.abs(p - 0.5) * 2); });
tr('Fondus', 'flash-couleur', 'Flash arc-en-ciel', '🌈', (c, A, B, p, W, H) => { put(c, p < 0.5 ? A : B, W, H); overlay(c, W, H, `hsl(${Math.round(p * 300)},95%,60%)`, 1 - Math.abs(p - 0.5) * 2); });
tr('Fondus', 'additif', 'Fondu lumineux', '🔆', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { a: 1 - e * 0.6 }); put(c, B, W, H, { a: e, op: 'lighter' }); put(c, B, W, H, { a: cl(e * 1.6 - 0.6) }); });
tr('Fondus', 'dissolution', 'Dissolution', '🧂', (c, A, B, p, W, H) => { put(c, A, W, H); field(c, B, W, H, (u, v, i, j) => (h2(i, j) < p ? 1 : 0), false); });
tr('Fondus', 'luma', 'Fondu par la lumière', '💡', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const L = lumaGrid(B), th = 1 - p * 1.35;
  field(c, B, W, H, (u, v, i, j) => cl((L[j * FW + i] - th) / 0.35));
}, 0.9);
tr('Fondus', 'flou', 'Flou', '🌫️', (c, A, B, p, W, H) => { const e = ease(p), b = 30 * (W / 1920); put(c, A, W, H, { f: `blur(${e * b}px)`, a: 1 - e }); put(c, B, W, H, { f: `blur(${(1 - e) * b}px)`, a: e }); });
tr('Fondus', 'surexposition', 'Surexposition', '☀️', (c, A, B, p, W, H) => { const e = ease(p), br = 100 + 320 * bell(p); put(c, A, W, H, { a: 1 - e, f: `brightness(${br}%)` }); put(c, B, W, H, { a: e, f: `brightness(${br}%)` }); }, 0.8);
tr('Fondus', 'brulure', 'Brûlure de pellicule', '🔥', (c, A, B, p, W, H) => {
  swap(c, A, B, W, H, p, 0.3);
  const x = W * (0.1 + 0.8 * p), g = c.createRadialGradient(x, H * 0.55, 0, x, H * 0.55, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.25, 'rgba(255,170,40,.95)'); g.addColorStop(0.6, 'rgba(200,40,0,.6)'); g.addColorStop(1, 'rgba(80,0,0,0)');
  c.save(); c.globalAlpha = bell(p); c.globalCompositeOperation = 'screen'; c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
}, 0.9);
tr('Fondus', 'fuite', 'Fuite de lumière', '🌅', (c, A, B, p, W, H) => {
  const e = ease(p);
  put(c, A, W, H); put(c, B, W, H, { a: e });
  c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = bell(p) * 0.9;
  for (const [col, off, ry] of [['255,120,60', 0, 0.3], ['255,60,160', 0.25, 0.7], ['255,220,120', 0.5, 0.5]]) {
    const x = W * (-0.3 + 1.6 * cl(p * 1.2 - off * 0.4)), g = c.createRadialGradient(x, H * ry, 0, x, H * ry, W * 0.5);
    g.addColorStop(0, `rgba(${col},.95)`); g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  c.restore();
}, 1);
tr('Fondus', 'encre', 'Tache d’encre', '🖋️', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const asp = W / H, q = ease(p) * 1.45;
  field(c, B, W, H, (u, v) => cl((q - Math.hypot((u - 0.5) * asp, v - 0.5) / (asp * 0.6) - (noise2(u * 5, v * 5) - 0.5) * 0.45) / 0.05));
}, 1);

// --- Glissements
const DIRS = { gauche: [-1, 0, '⬅️', '←'], droite: [1, 0, '➡️', '→'], haut: [0, -1, '⬆️', '↑'], bas: [0, 1, '⬇️', '↓'] };
for (const [k, [dx, dy, ic, ar]] of Object.entries(DIRS)) {
  tr('Glissements', 'glisser-' + k, 'Pousser ' + ar, ic, (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { x: dx * e, y: dy * e }); put(c, B, W, H, { x: -dx * (1 - e), y: -dy * (1 - e) }); });
}
for (const [k, [dx, dy, , ar]] of Object.entries(DIRS)) {
  tr('Glissements', 'couvrir-' + k, 'Recouvrir ' + ar, '📥', (c, A, B, p, W, H) => { const e = eo(p); put(c, A, W, H, { f: `brightness(${100 - 35 * e}%)` }); put(c, B, W, H, { x: -dx * (1 - e), y: -dy * (1 - e) }); });
}
for (const [k, [dx, dy, , ar]] of Object.entries(DIRS)) {
  tr('Glissements', 'decouvrir-' + k, 'Découvrir ' + ar, '📤', (c, A, B, p, W, H) => { const e = ease(p); put(c, B, W, H, { f: `brightness(${65 + 35 * e}%)` }); put(c, A, W, H, { x: dx * e, y: dy * e }); });
}
tr('Glissements', 'glisser-diag1', 'Pousser ↖', '↖️', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { x: -e, y: -e }); put(c, B, W, H, { x: 1 - e, y: 1 - e }); });
tr('Glissements', 'glisser-diag2', 'Pousser ↘', '↘️', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { x: e, y: e }); put(c, B, W, H, { x: e - 1, y: e - 1 }); });
tr('Glissements', 'rebond', 'Rebond', '🏀', (c, A, B, p, W, H) => { put(c, A, W, H); put(c, B, W, H, { y: -(1 - bounceOut(p)) }); }, 0.9);
tr('Glissements', 'elastique', 'Élastique', '🪀', (c, A, B, p, W, H) => { put(c, A, W, H); put(c, B, W, H, { x: 1 - elasticOut(p) }); }, 0.9);
tr('Glissements', 'retour', 'Retour en arrière', '🪃', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { x: -e * 0.3, s: 1 - 0.15 * bell(p), a: 1 - e }); put(c, B, W, H, { x: (1 - backOut(p)) * 0.9, s: 1 - 0.15 * bell(p) }); }, 0.8);
tr('Glissements', 'whip-gauche', 'Panoramique rapide ←', '💨', (c, A, B, p, W, H) => { const e = ease(p), s = bell(p) * 0.18; smear(c, A, W, H, { x: -e }, s); smear(c, B, W, H, { x: 1 - e }, s); }, 0.45);
tr('Glissements', 'whip-droite', 'Panoramique rapide →', '💨', (c, A, B, p, W, H) => { const e = ease(p), s = bell(p) * 0.18; smear(c, A, W, H, { x: e }, s); smear(c, B, W, H, { x: e - 1 }, s); }, 0.45);
tr('Glissements', 'whip-haut', 'Panoramique rapide ↑', '💨', (c, A, B, p, W, H) => { const e = ease(p), s = bell(p) * 0.18; smear(c, A, W, H, { y: -e }, s, 0, 1); smear(c, B, W, H, { y: 1 - e }, s, 0, 1); }, 0.45);

// --- Volets
tr('Volets', 'balayage', 'Balayage net →', '🧹', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H); clipped(c, B, (x) => x.rect(0, 0, W * e, H)); });
for (const [k, [dx, dy, ic, ar]] of Object.entries(DIRS)) tr('Volets', 'volet-' + k, 'Volet doux ' + ar, ic, (c, A, B, p, W, H) => wipe(c, A, B, W, H, ease(p), dx, dy));
tr('Volets', 'volet-diag1', 'Volet diagonal ↘', '↘️', (c, A, B, p, W, H) => wipe(c, A, B, W, H, ease(p), W, H));
tr('Volets', 'volet-diag2', 'Volet diagonal ↙', '↙️', (c, A, B, p, W, H) => wipe(c, A, B, W, H, ease(p), -W, H));
tr('Volets', 'portes-h', 'Ouverture horizontale', '🚪', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H); clipped(c, B, (x) => x.rect(W / 2 - (e * W) / 2, 0, e * W, H)); });
tr('Volets', 'portes-v', 'Ouverture verticale', '🚪', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H); clipped(c, B, (x) => x.rect(0, H / 2 - (e * H) / 2, W, e * H)); });
tr('Volets', 'fermeture-h', 'Fermeture horizontale', '🔲', (c, A, B, p, W, H) => { const e = ease(p); put(c, B, W, H); clipped(c, A, (x) => x.rect((e * W) / 2, 0, W * (1 - e), H)); });
tr('Volets', 'rideau', 'Rideau', '🎭', (c, A, B, p, W, H) => {
  const e = ease(p);
  put(c, B, W, H, { s: 1.08 - 0.08 * e });
  c.drawImage(A, 0, 0, W / 2, H, -e * W * 0.5, 0, W / 2, H);
  c.drawImage(A, W / 2, 0, W / 2, H, W / 2 + e * W * 0.5, 0, W / 2, H);
}, 0.9);
tr('Volets', 'stores-h', 'Stores', '🪟', (c, A, B, p, W, H) => { put(c, A, W, H); const n = 10, h = H / n; clipped(c, B, (x) => { for (let i = 0; i < n; i++) x.rect(0, i * h, W, h * ease(cl(p * 1.3 - i * 0.03))); }); }, 0.8);
tr('Volets', 'stores-v', 'Stores verticaux', '🎚️', (c, A, B, p, W, H) => { put(c, A, W, H); const n = 14, w = W / n; clipped(c, B, (x) => { for (let i = 0; i < n; i++) x.rect(i * w, 0, w * ease(cl(p * 1.3 - i * 0.022)), H); }); }, 0.8);
tr('Volets', 'damier', 'Damier', '🏁', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const cols = 8, rows = Math.max(2, Math.round((cols * H) / W)), cw = W / cols, ch = H / rows;
  clipped(c, B, (x) => {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const q = ease(cl((i + j) % 2 ? p * 2 - 1 : p * 2)), w = cw * q, h = ch * q;
      if (q > 0) x.rect(i * cw + (cw - w) / 2, j * ch + (ch - h) / 2, w, h);
    }
  });
}, 0.9);
tr('Volets', 'horloge', 'Horloge', '🕐', (c, A, B, p, W, H) => { put(c, A, W, H); const e = ease(p); clipped(c, B, (x) => { x.moveTo(W / 2, H / 2); x.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2); x.closePath(); }); }, 0.8);
tr('Volets', 'eventail', 'Éventail', '🪭', (c, A, B, p, W, H) => { put(c, A, W, H); const e = ease(p); clipped(c, B, (x) => { x.moveTo(W / 2, H); x.arc(W / 2, H, Math.hypot(W, H), -Math.PI / 2 - e * Math.PI * 0.55, -Math.PI / 2 + e * Math.PI * 0.55); x.closePath(); }); }, 0.8);
tr('Volets', 'radar', 'Radar', '📡', (c, A, B, p, W, H) => { put(c, A, W, H); const e = ease(p); clipped(c, B, (x) => { for (const s of [0, Math.PI]) { x.moveTo(W / 2, H / 2); x.arc(W / 2, H / 2, Math.hypot(W, H), s, s + e * Math.PI); x.closePath(); } }); }, 0.8);
tr('Volets', 'zigzag', 'Zigzag', '⚡', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const amp = W * 0.05, edge = ease(p) * (W + amp * 2) - amp, n = 9;
  clipped(c, B, (x) => { x.moveTo(0, 0); for (let i = 0; i <= n * 2; i++) x.lineTo(edge + (i % 2 ? amp : -amp), (i / (n * 2)) * H); x.lineTo(0, H); x.closePath(); });
});
tr('Volets', 'vague', 'Vague', '🌊', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const amp = W * 0.05, edge = ease(p) * (W + amp * 2) - amp;
  clipped(c, B, (x) => { x.moveTo(0, 0); for (let i = 0; i <= 40; i++) { const y = (i / 40) * H; x.lineTo(edge + Math.sin((y / H) * Math.PI * 3 + p * 8) * amp, y); } x.lineTo(0, H); x.closePath(); });
}, 0.8);
tr('Volets', 'grille', 'Grille', '🔳', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const cols = 10, rows = Math.max(2, Math.round((cols * H) / W)), cw = W / cols, ch = H / rows;
  clipped(c, B, (x) => {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const q = ease(cl((p - ((i + j) / (cols + rows - 2)) * 0.6) / 0.4));
      if (q > 0) x.rect(i * cw + (cw * (1 - q)) / 2, j * ch + (ch * (1 - q)) / 2, cw * q + 0.5, ch * q + 0.5);
    }
  });
}, 1);
tr('Volets', 'bandes', 'Bandes', '📊', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const n = 8, h = H / n;
  for (let i = 0; i < n; i++) { const q = eo(cl((p - i * 0.05) / 0.65)), dx = (1 - q) * W * (i % 2 ? 1 : -1); c.drawImage(B, 0, i * h, W, h, dx, i * h, W, h + 0.5); }
}, 0.9);
tr('Volets', 'rayures', 'Rayures', '🦓', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const per = Math.hypot(W, H) / 10, e = ease(p);
  c.save();
  c.beginPath();
  c.translate(W / 2, H / 2);
  c.rotate(Math.PI / 4);
  const L = Math.hypot(W, H);
  for (let s = -L; s < L; s += per) c.rect(s, -L, per * e, 2 * L);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clip();
  c.drawImage(B, 0, 0);
  c.restore();
}, 0.8);
tr('Volets', 'bulles', 'Bulles', '🫧', (c, A, B, p, W, H) => {
  put(c, A, W, H);
  const asp = W / H, C = [];
  for (let i = 0; i < 24; i++) C.push([hash(i) * asp, hash(i + 40), ease(cl((p - hash(i + 80) * 0.45) / 0.55)) * (0.25 + hash(i + 120) * 0.3) * asp]);
  field(c, B, W, H, (u, v) => { let a = 0; for (const [x, y, r] of C) { const d = r - Math.hypot(u * asp - x, v - y); if (d > 0) a = Math.max(a, d / 0.03); } return a; });
}, 1);

// --- Formes
tr('Formes', 'cercle', 'Iris (cercle)', '⭕', (c, A, B, p, W, H) => { put(c, A, W, H); clipped(c, B, (x) => x.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * ease(p), 0, Math.PI * 2)); });
tr('Formes', 'cercle-inverse', 'Iris fermant', '🎯', (c, A, B, p, W, H) => { put(c, B, W, H); clipped(c, A, (x) => x.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * (1 - ease(p)), 0, Math.PI * 2)); });
for (const [k, label, ic, f] of [['losange', 'Losange', '🔷', 1.05], ['etoile', 'Étoile', '⭐', 1.9], ['coeur', 'Cœur', '❤️', 1.35], ['carre', 'Carré', '⬛', 0.62], ['croix', 'Croix', '➕', 1.4], ['triangle', 'Triangle', '🔺', 1.8]]) {
  tr('Formes', 'forme-' + k, label, ic, (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H); clipped(c, B, (x) => shapePath(x, k, W / 2, H / 2, e * Math.hypot(W, H) * f * 0.55, k === 'etoile' ? e * 0.8 : 0)); }, 0.8);
}

// --- Zoom et mouvement
tr('Zoom et mouvement', 'zoom', 'Zoom avant', '🔍', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { s: 1 + e, a: 1 - e }); put(c, B, W, H, { s: 0.6 + 0.4 * e, a: e }); });
tr('Zoom et mouvement', 'zoom-arriere', 'Zoom arrière', '🔭', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { s: 1 - 0.5 * e, a: 1 - e }); put(c, B, W, H, { s: 1.6 - 0.6 * e, a: e }); });
tr('Zoom et mouvement', 'zoom-flou', 'Zoom traversant', '💥', (c, A, B, p, W, H) => { const e = ease(p), b = bell(p) * 0.25; if (p < 0.5) zoomSmear(c, A, W, H, { s: 1 + e * 2 }, b); else zoomSmear(c, B, W, H, { s: 0.4 + 0.6 * e }, b); }, 0.6);
tr('Zoom et mouvement', 'tourbillon', 'Tourbillon', '🌀', (c, A, B, p, W, H) => { const e = ease(p); put(c, A, W, H, { s: 1 - 0.7 * e, r: e * Math.PI, a: 1 - e }); put(c, B, W, H, { s: 0.3 + 0.7 * e, r: -(1 - e) * Math.PI, a: e }); }, 0.8);
tr('Zoom et mouvement', 'rotation', 'Rotation', '🔄', (c, A, B, p, W, H) => { const e = ease(p); put(c, p < 0.5 ? A : B, W, H, { r: e * Math.PI * 2, s: 1 - 0.4 * bell(p) }); }, 0.8);
tr('Zoom et mouvement', 'retourner', 'Retourner (carte)', '🃏', (c, A, B, p, W, H) => { const e = ease(p), sx = Math.abs(Math.cos(Math.PI * e)); put(c, e < 0.5 ? A : B, W, H, { sx, s: 1 - 0.1 * bell(p), f: `brightness(${55 + 45 * sx}%)` }); }, 0.7);
tr('Zoom et mouvement', 'retourner-v', 'Retourner vertical', '🔃', (c, A, B, p, W, H) => { const e = ease(p), sy = Math.abs(Math.cos(Math.PI * e)); put(c, e < 0.5 ? A : B, W, H, { sx: 1 - 0.1 * bell(p), sy, f: `brightness(${55 + 45 * sy}%)` }); }, 0.7);
tr('Zoom et mouvement', 'cube', 'Cube', '🧊', (c, A, B, p, W, H) => { const e = ease(p), xs = W * (1 - e); face(c, A, W, H, 0, xs, H * (1 - 0.22 * e), H, 100 - 45 * e); face(c, B, W, H, xs, W, H, H * (1 - 0.22 * (1 - e)), 55 + 45 * e); }, 0.8);
tr('Zoom et mouvement', 'cube-v', 'Cube (vers la droite)', '🧊', (c, A, B, p, W, H) => { const e = ease(p), xs = W * e; face(c, B, W, H, 0, xs, H * (1 - 0.22 * (1 - e)), H, 55 + 45 * e); face(c, A, W, H, xs, W, H, H * (1 - 0.22 * e), 100 - 45 * e); }, 0.8);
tr('Zoom et mouvement', 'chute', 'Chute', '🍂', (c, A, B, p, W, H) => { put(c, B, W, H, { s: 0.92 + 0.08 * ease(p) }); put(c, A, W, H, { y: ei(p) * 1.3, r: ei(p) * 0.5 }); }, 0.8);
tr('Zoom et mouvement', 'aspiration', 'Aspiration', '🌪️', (c, A, B, p, W, H) => { const e = ease(p); put(c, B, W, H); put(c, A, W, H, { s: 1 - e, r: e * 4, a: 1 - ei(p) }); }, 0.8);
tr('Zoom et mouvement', 'envol', 'Envol', '🕊️', (c, A, B, p, W, H) => { put(c, B, W, H); put(c, A, W, H, { y: -ei(p) * 1.3, s: 1 - 0.3 * ease(p), r: -ease(p) * 0.25 }); }, 0.8);
tr('Zoom et mouvement', 'balancier', 'Balancier', '🎡', (c, A, B, p, W, H) => { put(c, B, W, H); put(c, A, W, H, { ox: 0, oy: 0, r: bounceOut(p) * Math.PI * 0.5 }); }, 1);
tr('Zoom et mouvement', 'secousse', 'Secousse', '📳', (c, A, B, p, W, H) => { const f = Math.floor(p * 40), a = bell(p) * 0.04, o = { x: (hash(f) - 0.5) * a, y: (hash(f + 7) - 0.5) * a, s: 1 + a }; put(c, A, W, H, o); put(c, B, W, H, { ...o, a: ease(p) }); });
tr('Zoom et mouvement', 'sautille', 'Saut', '🦘', (c, A, B, p, W, H) => { const j = -bell(p) * 0.12; put(c, p < 0.5 ? A : B, W, H, { y: j, s: 1 - 0.1 * bell(p) }); });

// --- Stylisés
tr('Stylisés', 'glitch', 'Glitch', '👾', (c, A, B, p, W, H) => {
  swap(c, A, B, W, H, p, 0.1);
  const g = bell(p), f = Math.floor(p * 30);
  for (let i = 0; i < 10; i++) {
    if (hash(f * 7 + i) > g) continue;
    const src = hash(f * 3 + i * 13) > 0.5 ? A : B, y = hash(f * 3 + i) * H, h = (0.02 + hash(f + i * 5) * 0.1) * H;
    c.drawImage(src, 0, y, W, h, (hash(f * 11 + i) - 0.5) * 0.2 * W * g, y, W, h);
  }
  put(c, channel(p < 0.5 ? A : B, W, H, '#ff0000'), W, H, { x: 0.012 * g, a: 0.7 * g, op: 'screen' });
  put(c, channel(p < 0.5 ? A : B, W, H, '#00ffff'), W, H, { x: -0.012 * g, a: 0.7 * g, op: 'screen' });
}, 0.5);
tr('Stylisés', 'pixel', 'Pixels', '🟦', (c, A, B, p, W, H) => {
  const b = Math.max(1, Math.round(1 + bell(p) * 48 * (W / 1920) * 1.5)), w = Math.max(1, Math.round(W / b)), h = Math.max(1, Math.round(H / b));
  const [s, x] = scratch(3, w, h);
  const m = cl((p - 0.4) / 0.2);
  x.globalAlpha = 1 - m; x.drawImage(A, 0, 0, w, h);
  x.globalAlpha = m; x.drawImage(B, 0, 0, w, h);
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(s, 0, 0, w, h, 0, 0, W, H); c.restore();
}, 0.8);
tr('Stylisés', 'rgb', 'Décalage RGB', '🔴', (c, A, B, p, W, H) => {
  const e = ease(p), g = bell(p), [s, x] = scratch(4, W, H);
  x.drawImage(A, 0, 0); x.globalAlpha = e; x.drawImage(B, 0, 0); x.globalAlpha = 1;
  put(c, s, W, H);
  put(c, channel(s, W, H, '#ff0000'), W, H, { x: 0.03 * g, a: g, op: 'screen' });
  put(c, channel(s, W, H, '#0000ff'), W, H, { x: -0.03 * g, a: g, op: 'screen' });
}, 0.5);
tr('Stylisés', 'vhs', 'VHS', '📼', (c, A, B, p, W, H) => {
  swap(c, A, B, W, H, p, 0.2);
  const g = bell(p), f = Math.floor(p * 25), src = p < 0.5 ? A : B;
  for (let i = 0; i < 4; i++) { const y = ((hash(f + i * 9) + p) % 1) * H, h = H * (0.03 + 0.08 * hash(i + f)); c.drawImage(src, 0, y, W, h, (hash(f * 5 + i) - 0.3) * W * 0.15 * g, y, W, h); }
  noiseFill(c, W, H, 0.35 * g, f, 'overlay');
  scanlines(c, W, H, 0.5 * g);
}, 0.7);
tr('Stylisés', 'eclair', 'Éclair', '🌩️', (c, A, B, p, W, H) => {
  put(c, p < 0.5 ? A : B, W, H);
  const fl = cl(1 - Math.abs(p - 0.5) * 5);
  overlay(c, W, H, '#e8f0ff', fl * 0.85);
  if (fl > 0.05) {
    c.save(); c.strokeStyle = '#fff'; c.shadowColor = '#9cf'; c.shadowBlur = 25 * (W / 1920); c.lineWidth = 6 * (W / 1920); c.globalAlpha = fl;
    c.beginPath(); let x = W * 0.55; c.moveTo(x, 0);
    for (let i = 1; i <= 8; i++) { x += (hash(i * 3.3) - 0.5) * W * 0.12; c.lineTo(x, (i / 8) * H); }
    c.stroke(); c.restore();
  }
}, 0.5);
tr('Stylisés', 'ondulation', 'Ondulation', '〰️', (c, A, B, p, W, H) => {
  const e = ease(p), amp = bell(p) * W * 0.04, h = Math.max(2, Math.round(H / 120));
  for (const [src, a] of [[A, 1], [B, e]]) {
    c.save(); c.globalAlpha = a;
    for (let y = 0; y < H; y += h) c.drawImage(src, 0, y, W, h, Math.sin((y / H) * Math.PI * 6 + p * 12) * amp, y, W, h + 0.5);
    c.restore();
  }
}, 0.8);
tr('Stylisés', 'mosaique', 'Mosaïque', '🧩', (c, A, B, p, W, H) => {
  const cols = 8, rows = Math.max(2, Math.round((cols * H) / W)), cw = W / cols, ch = H / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = ease(cl((p - hash(i + j * 31) * 0.5) / 0.5)), sx = Math.abs(Math.cos(Math.PI * q)), src = q < 0.5 ? A : B, w = cw * sx;
    if (w > 0.5) c.drawImage(src, i * cw, j * ch, cw, ch, i * cw + (cw - w) / 2, j * ch, w, ch + 0.5);
  }
}, 1);
tr('Stylisés', 'eclats', 'Éclats', '💔', (c, A, B, p, W, H) => {
  put(c, B, W, H);
  const cols = 10, rows = Math.max(2, Math.round((cols * H) / W)), cw = W / cols, ch = H / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = cl((p - hash(i * 7 + j * 13) * 0.4) / 0.6);
    if (q >= 1) continue;
    c.save();
    c.globalAlpha = 1 - q * q;
    c.translate(i * cw + cw / 2 + (hash(i + j * 3) - 0.5) * q * W * 0.3, j * ch + ch / 2 + q * q * H * 1.2);
    c.rotate((hash(i * 3 + j) - 0.5) * q * 4);
    c.drawImage(A, i * cw, j * ch, cw, ch, -cw / 2, -ch / 2, cw + 0.5, ch + 0.5);
    c.restore();
  }
}, 1.1);
tr('Stylisés', 'neige-tele', 'Neige télé', '📺', (c, A, B, p, W, H) => { swap(c, A, B, W, H, p, 0.05); const g = cl(1 - Math.abs(p - 0.5) * 2.5); noiseFill(c, W, H, g, Math.floor(p * 60), 'source-over', 0.6); scanlines(c, W, H, g * 0.5); }, 0.5);
tr('Stylisés', 'paillettes', 'Paillettes', '✨', (c, A, B, p, W, H) => {
  put(c, A, W, H); put(c, B, W, H, { a: ease(p) });
  const g = bell(p);
  c.save(); c.fillStyle = '#fff'; c.shadowColor = '#ffe9a0'; c.shadowBlur = 12 * (W / 1920);
  for (let i = 0; i < 60; i++) {
    const tw = Math.abs(Math.sin(p * 18 + i)) * g, r = (6 + hash(i + 5) * 18) * (W / 1920) * tw * 2, x = hash(i) * W, y = hash(i + 30) * H;
    if (r < 0.5) continue;
    c.globalAlpha = tw;
    c.beginPath(); c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r); c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
  }
  c.restore();
}, 1);
tr('Stylisés', 'pellicule', 'Pellicule', '🎞️', (c, A, B, p, W, H) => {
  const e = ease(p), k = 0.84;
  overlay(c, W, H, '#0b0b0b', 1);
  for (const [src, off] of [[A, -e], [B, 1 - e]]) put(c, src, W, H, { y: off * (k + 0.06), s: k });
  c.save(); c.fillStyle = '#f4f4f4';
  const hw = W * 0.02, hh = H * 0.045, gap = H * 0.1, shift = (e * (k + 0.06) * H) % gap;
  for (let y = -gap; y < H + gap; y += gap) for (const x of [W * 0.025, W - W * 0.025 - hw]) { c.beginPath(); c.rect(x, y - shift, hw, hh); c.fill(); }
  c.restore();
}, 0.9);
tr('Stylisés', 'kaleido', 'Kaléidoscope', '🔮', (c, A, B, p, W, H) => {
  const g = bell(p), src = p < 0.5 ? A : B;
  put(c, src, W, H, { r: g * Math.PI * 0.5, s: 1 + g });
  if (g > 0.02) { c.save(); c.globalAlpha = g * 0.6; c.translate(W, 0); c.scale(-1, 1); put(c, src, W, H, { r: g * Math.PI * 0.5, s: 1 + g }); c.restore(); }
}, 0.8);

export const TRANSITION_LIST = T;
export const TRANSITION_BY_ID = Object.fromEntries(T.map((t) => [t.id, t]));

// ---------------------------------------------------------- EFFETS
const E = [];
const fx = (cat, id, label, icon, apply) => E.push({ cat, id, label, icon, apply });
const sc = (W) => W / 1920;

function copyOf(ctx, slot = 5) {
  const W = ctx.canvas.width, H = ctx.canvas.height, [c, x] = scratch(slot, W, H);
  x.drawImage(ctx.canvas, 0, 0);
  return c;
}
/** Redessine l'image composée avec une transformation (zoom, rotation…) sur le fond du projet */
function redraw(ctx, W, H, env, o = {}, f = 'none') {
  const src = copyOf(ctx);
  ctx.save();
  ctx.fillStyle = env.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  put(ctx, src, W, H, { ...o, f });
}
const filt = (f) => (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, {}, f(k, l, sc(W)));
/** Effet de couleur calculé pixel par pixel (sur une image réduite) : fn(r, g, b, x, y, out) */
function pixels(ctx, W, H, k, fn, maxW = 960) {
  const s = Math.min(1, maxW / W), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const [c, x] = scratch(6, w, h, true);
  x.drawImage(ctx.canvas, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h), d = img.data, out = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    fn(d[i], d[i + 1], d[i + 2], ((i >> 2) % w) / w, Math.floor((i >> 2) / w) / h, out);
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
  }
  x.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 1.25);
  ctx.drawImage(c, 0, 0, w, h, 0, 0, W, H);
  ctx.restore();
}
const lum = (r, g, b) => (0.3 * r + 0.59 * g + 0.11 * b) / 255;
function gradientLUT(stops) {
  const c = makeCanvas(256, 1), x = c.getContext('2d', { willReadFrequently: true }), g = x.createLinearGradient(0, 0, 256, 0);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 1);
  return x.getImageData(0, 0, 256, 1).data;
}
let thermalLUT = null;

/** Particules qui tombent (ou montent) : opt = { n, up, speed, size, sway, glyphs, draw } */
function fall(ctx, W, H, local, k, o) {
  const n = Math.round((o.n?.[0] ?? 30) + ((o.n?.[1] ?? 200) - (o.n?.[0] ?? 30)) * k), u = sc(W);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const r0 = hash(i + (o.seed || 0)), r1 = hash(i + 100), r2 = hash(i + 200);
    const sp = o.speed[0] + r1 * (o.speed[1] - o.speed[0]);
    let y = (r2 + local * sp * (o.up ? -1 : 1)) % 1.15;
    if (y < 0) y += 1.15;
    y = y * H - H * 0.07;
    const x = (r0 + Math.sin(local * (0.6 + r1) + i) * (o.sway ?? 0.02)) * W;
    const size = (o.size[0] + r1 * (o.size[1] - o.size[0])) * u;
    if (o.glyphs) {
      ctx.globalAlpha = o.alpha ? o.alpha(i, local) : 0.95;
      ctx.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
      ctx.save();
      ctx.translate(x, y);
      if (o.spin) ctx.rotate(Math.sin(local * (1 + r1) + i) * o.spin);
      ctx.fillText(o.glyphs[i % o.glyphs.length], 0, 0);
      ctx.restore();
    } else o.draw(ctx, x, y, size, i, r1, local);
  }
  ctx.restore();
}
const CONF = ['#ff004d', '#ffec27', '#29adff', '#00e436', '#ff77a8', '#ffa300'];

// --- Mouvement de caméra
fx('Mouvement de caméra', 'tremblement', 'Tremblement', '📳', (ctx, k, l, d, W, H, env) => { const f = Math.floor(l * env.fps), a = k * 0.03; redraw(ctx, W, H, env, { x: (hash(f) - 0.5) * a, y: (hash(f + 9) - 0.5) * a, s: 1 + a }); });
fx('Mouvement de caméra', 'seisme', 'Séisme', '🌋', (ctx, k, l, d, W, H, env) => { const f = Math.floor(l * env.fps), a = k * 0.07; redraw(ctx, W, H, env, { x: (hash(f) - 0.5) * a, y: (hash(f + 9) - 0.5) * a, r: (hash(f + 4) - 0.5) * a * 0.8, s: 1 + a * 1.3 }); });
fx('Mouvement de caméra', 'zoompulse', 'Zoom pulsé', '💓', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { s: 1 + 0.08 * k * Math.abs(Math.sin(l * Math.PI * 2)) }));
fx('Mouvement de caméra', 'battement', 'Battement de cœur', '❤️‍🔥', (ctx, k, l, d, W, H, env) => { const t = l % 1, g = (m, w) => Math.exp(-(((t - m) / w) ** 2)); redraw(ctx, W, H, env, { s: 1 + 0.09 * k * Math.max(g(0.12, 0.06), 0.7 * g(0.32, 0.06)) }); });
fx('Mouvement de caméra', 'zoom-lent', 'Zoom avant lent', '🔍', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { s: 1 + 0.35 * k * ease(cl(l / d)) }));
fx('Mouvement de caméra', 'dezoom-lent', 'Zoom arrière lent', '🔭', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { s: 1 + 0.35 * k * (1 - ease(cl(l / d))) }));
fx('Mouvement de caméra', 'rotation-lente', 'Rotation lente', '🔄', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { r: 0.25 * k * (l / d - 0.5), s: 1.12 + 0.1 * k }));
fx('Mouvement de caméra', 'balancement', 'Balancement', '🎐', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { r: Math.sin(l * 2.2) * 0.06 * k, s: 1.06 + 0.06 * k }));
fx('Mouvement de caméra', 'rebond', 'Rebond', '🏀', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { y: -Math.abs(Math.sin(l * Math.PI * 2)) * 0.05 * k, s: 1.08 }));
fx('Mouvement de caméra', 'camera-main', 'Caméra à la main', '🎥', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { x: (noise1(l * 1.3) - 0.5) * 0.05 * k, y: (noise1(l * 1.1 + 40) - 0.5) * 0.05 * k, r: (noise1(l * 0.9 + 80) - 0.5) * 0.04 * k, s: 1.08 + 0.04 * k }));
fx('Mouvement de caméra', 'travelling', 'Travelling', '🛤️', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { x: (0.5 - ease(cl(l / d))) * 0.16 * k, s: 1.1 + 0.16 * k }));
fx('Mouvement de caméra', 'vertige', 'Vertige', '😵', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { s: 1.15 + 0.1 * k * Math.sin(l * 1.6), r: Math.sin(l * 1.1) * 0.07 * k }));

// --- Lumière
fx('Lumière', 'flash', 'Flash', '⚡', (ctx, k, l, d, W, H) => overlay(ctx, W, H, '#fff', k * Math.max(0, 1 - ((l * 2) % 1) * 3)));
fx('Lumière', 'stroboscope', 'Stroboscope', '🚨', (ctx, k, l, d, W, H) => { if (Math.floor(l * 14) % 2 === 0) overlay(ctx, W, H, '#fff', 0.85 * k); });
fx('Lumière', 'clignotement', 'Clignotement', '💡', (ctx, k, l, d, W, H) => { if (l % 0.8 < 0.09) overlay(ctx, W, H, '#000', k); });
fx('Lumière', 'lumiere', 'Lumière chaude', '🌄', (ctx, k, l, d, W, H) => {
  const x = W * (0.2 + 0.6 * ((Math.sin(l * 0.8) + 1) / 2)), g = ctx.createRadialGradient(x, H * 0.2, 0, x, H * 0.2, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, `rgba(255,170,80,${0.55 * k})`); g.addColorStop(1, 'rgba(255,80,40,0)');
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
});
fx('Lumière', 'fuite-lumiere', 'Fuite de lumière', '🌇', (ctx, k, l, d, W, H) => {
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (const [col, sp, ph, ry] of [['255,110,50', 0.35, 0, 0.25], ['255,60,170', 0.27, 2, 0.75], ['255,215,110', 0.42, 4, 0.5]]) {
    const x = W * (0.5 + 0.55 * Math.sin(l * sp + ph)), g = ctx.createRadialGradient(x, H * ry, 0, x, H * ry, W * 0.45);
    g.addColorStop(0, `rgba(${col},${0.6 * k})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
});
fx('Lumière', 'reflet', 'Reflet d’objectif', '🌞', (ctx, k, l, d, W, H) => {
  const sx = W * (0.15 + 0.7 * ((Math.sin(l * 0.5) + 1) / 2)), sy = H * 0.22, cx = W / 2, cy = H / 2, u = sc(W);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  let g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 260 * u);
  g.addColorStop(0, `rgba(255,255,235,${k})`); g.addColorStop(0.2, `rgba(255,220,150,${0.5 * k})`); g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const [t, r, col] of [[0.4, 40, '120,200,255'], [0.75, 70, '255,140,220'], [1.2, 30, '150,255,180'], [1.5, 110, '255,200,120'], [1.8, 50, '170,160,255']]) {
    const x = sx + (cx - sx) * t * 1.2, y = sy + (cy - sy) * t * 1.2;
    g = ctx.createRadialGradient(x, y, 0, x, y, r * u);
    g.addColorStop(0, `rgba(${col},${0.35 * k})`); g.addColorStop(0.7, `rgba(${col},${0.2 * k})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * u, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
});
fx('Lumière', 'rayons', 'Rayons de soleil', '☀️', (ctx, k, l, d, W, H) => {
  const ox = W * (0.5 + 0.2 * Math.sin(l * 0.3)), oy = -H * 0.15, L = Math.hypot(W, H) * 1.3;
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.filter = `blur(${8 * sc(W)}px)`;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI / 2 + (i - 4) * 0.16 + Math.sin(l * 0.4 + i) * 0.03, w = 0.035 + hash(i) * 0.04;
    const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * L, oy + Math.sin(a) * L);
    g.addColorStop(0, `rgba(255,245,210,${0.45 * k})`); g.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a - w) * L, oy + Math.sin(a - w) * L); ctx.lineTo(ox + Math.cos(a + w) * L, oy + Math.sin(a + w) * L); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
});
fx('Lumière', 'projecteur', 'Projecteur', '🔦', (ctx, k, l, d, W, H) => {
  const x = W * (0.5 + 0.3 * Math.sin(l * 0.9)), y = H * (0.5 + 0.25 * Math.sin(l * 1.3 + 1)), r = Math.min(W, H) * 0.32;
  const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.4);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.88 * k})`);
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
});
fx('Lumière', 'halo', 'Halo lumineux', '🌟', (ctx, k, l, d, W, H) => put(ctx, copyOf(ctx), W, H, { a: 0.75 * k, op: 'screen', f: `blur(${14 * sc(W)}px) brightness(120%)` }));
fx('Lumière', 'neon', 'Lueur néon', '🟣', (ctx, k, l, d, W, H) => put(ctx, copyOf(ctx), W, H, { a: (0.35 + 0.3 * Math.sin(l * 5)) * k, op: 'lighter', f: `blur(${10 * sc(W)}px) saturate(300%) hue-rotate(${Math.round(l * 40)}deg)` }));
fx('Lumière', 'disco', 'Disco', '🪩', (ctx, k, l, d, W, H) => {
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 8; i++) {
    const a = l * 1.2 + (i * Math.PI) / 4, x = W / 2 + Math.cos(a) * W * 0.35, y = H / 2 + Math.sin(a * 1.3) * H * 0.35, r = Math.min(W, H) * 0.22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${i * 45 + l * 60},100%,60%,${0.55 * k})`); g.addColorStop(1, `hsla(${i * 45},100%,60%,0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
});
fx('Lumière', 'coucher-soleil', 'Coucher de soleil', '🌆', (ctx, k, l, d, W, H) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,140,50,1)'); g.addColorStop(0.55, 'rgba(255,70,120,1)'); g.addColorStop(1, 'rgba(90,40,160,1)');
  ctx.save(); ctx.globalAlpha = 0.75 * k; ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
});

// --- Rétro et glitch
fx('Rétro et glitch', 'glitch', 'Glitch', '👾', (ctx, k, l, d, W, H, env) => {
  const src = copyOf(ctx), f = Math.floor(l * env.fps), slices = 3 + Math.round(k * 8);
  for (let i = 0; i < slices; i++) {
    if (hash(f * 7 + i) > 0.55) continue;
    const y = hash(f * 3 + i) * H, h = (0.02 + hash(f + i * 5) * 0.08) * H;
    ctx.drawImage(src, 0, y, W, h, (hash(f * 11 + i) - 0.5) * k * 0.12 * W, y, W, h);
  }
  put(ctx, channel(src, W, H, '#ff0000'), W, H, { x: 0.006 * k, a: 0.5 * k, op: 'screen' });
});
fx('Rétro et glitch', 'bloc-glitch', 'Blocs glitch', '🧱', (ctx, k, l, d, W, H, env) => {
  const src = copyOf(ctx), f = Math.floor(l * env.fps / 2);
  ctx.save();
  for (let i = 0; i < 4 + k * 14; i++) {
    if (hash(f * 13 + i) > 0.6) continue;
    const w = W * (0.05 + hash(f + i * 3) * 0.25), h = H * (0.03 + hash(f * 2 + i) * 0.15), x = hash(f * 5 + i) * W, y = hash(f * 7 + i * 2) * H;
    ctx.filter = hash(i + f) > 0.5 ? `hue-rotate(${Math.round(hash(f + i) * 360)}deg) saturate(300%)` : 'invert(1)';
    ctx.drawImage(src, x + (hash(i * 9 + f) - 0.5) * W * 0.2, y, w, h, x, y, w, h);
  }
  ctx.restore();
});
fx('Rétro et glitch', 'rgb-split', 'Aberration RGB', '🔴', (ctx, k, l, d, W, H) => {
  const src = copyOf(ctx), o = 0.008 * k + 0.004 * k * Math.sin(l * 3);
  put(ctx, channel(src, W, H, '#ff0000'), W, H, { x: o, a: 0.8, op: 'screen' });
  put(ctx, channel(src, W, H, '#0000ff'), W, H, { x: -o, a: 0.8, op: 'screen' });
});
fx('Rétro et glitch', 'vhs', 'VHS', '📼', (ctx, k, l, d, W, H) => {
  put(ctx, copyOf(ctx), W, H, { x: k * 0.006 + Math.sin(l * 40) * 0.001, a: 0.3 * k, op: 'screen', f: 'saturate(180%) hue-rotate(-20deg)' });
  scanlines(ctx, W, H, 0.5 * k);
  const y = ((l * 0.25) % 1) * H;
  ctx.save(); ctx.globalAlpha = 0.25 * k; ctx.fillStyle = '#fff'; ctx.fillRect(0, y, W, H * 0.012); ctx.restore();
});
fx('Rétro et glitch', 'interference', 'Interférences', '📡', (ctx, k, l, d, W, H, env) => {
  const src = copyOf(ctx), f = Math.floor(l * env.fps);
  for (let i = 0; i < 3; i++) {
    const y = ((l * (0.2 + i * 0.13) + i * 0.3) % 1) * H, h = H * (0.04 + 0.04 * k);
    ctx.drawImage(src, 0, y, W, h, (hash(f + i) - 0.5) * W * 0.1 * k, y, W, h);
    noiseFill(ctx, W, h, 0.5 * k, f + i, 'overlay', 1, y);
  }
});
fx('Rétro et glitch', 'grain', 'Grain de film', '🎞️', (ctx, k, l, d, W, H, env) => noiseFill(ctx, W, H, 0.28 * k, Math.floor(l * env.fps), 'overlay'));
fx('Rétro et glitch', 'film-ancien', 'Film ancien', '📽️', (ctx, k, l, d, W, H, env) => {
  const f = Math.floor(l * env.fps);
  redraw(ctx, W, H, env, {}, `sepia(${80 * k}%) contrast(${100 + 15 * k}%) brightness(${100 + (hash(f) - 0.5) * 18 * k}%)`);
  noiseFill(ctx, W, H, 0.22 * k, f, 'overlay');
  ctx.save(); ctx.strokeStyle = 'rgba(30,20,10,.7)'; ctx.lineWidth = Math.max(1, 2 * sc(W));
  for (let i = 0; i < 3; i++) if (hash(f * 3 + i) < 0.5 * k) { const x = hash(f + i * 7) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (hash(i + f) - 0.5) * 20, H); ctx.stroke(); }
  ctx.fillStyle = 'rgba(20,15,10,.8)';
  for (let i = 0; i < 6; i++) if (hash(f * 5 + i) < 0.4 * k) { ctx.beginPath(); ctx.arc(hash(f + i * 11) * W, hash(f * 2 + i) * H, (1 + hash(i) * 4) * sc(W) * 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  vignette(ctx, W, H, 0.7 * k);
});
fx('Rétro et glitch', 'crt', 'Écran cathodique', '🖥️', (ctx, k, l, d, W, H) => {
  const src = copyOf(ctx);
  put(ctx, channel(src, W, H, '#ff0000'), W, H, { x: 0.003 * k, a: 0.5 * k, op: 'screen' });
  scanlines(ctx, W, H, 0.6 * k);
  vignette(ctx, W, H, 0.85 * k, 0.38);
  overlay(ctx, W, H, '#ffffff', 0.03 * k * Math.abs(Math.sin(l * 60)));
});
fx('Rétro et glitch', 'neige-tele', 'Neige télé', '📺', (ctx, k, l, d, W, H, env) => { noiseFill(ctx, W, H, 0.65 * k, Math.floor(l * env.fps), 'source-over', 0.7); scanlines(ctx, W, H, 0.4 * k); });
fx('Rétro et glitch', 'camescope', 'Caméscope', '📹', (ctx, k, l, d, W, H, env) => {
  const u = sc(W), m = 50 * u, L = 70 * u;
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.4 + k);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * u; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4 * u;
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); }
  ctx.stroke();
  ctx.font = `bold ${44 * u}px Consolas, monospace`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.fillText('REC', m + 80 * u, m + 30 * u);
  if (Math.floor(l * 2) % 2 === 0) { ctx.fillStyle = '#ff2d2d'; ctx.beginPath(); ctx.arc(m + 50 * u, m + 30 * u, 14 * u, 0, Math.PI * 2); ctx.fill(); }
  const fr = Math.floor(l * env.fps), tc = (n) => String(n).padStart(2, '0');
  ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
  ctx.fillText(`${tc(Math.floor(l / 3600))}:${tc(Math.floor(l / 60) % 60)}:${tc(Math.floor(l) % 60)}:${tc(fr % env.fps)}`, W - m - 30 * u, H - m - 30 * u);
  ctx.strokeRect(W - m - 160 * u, m + 12 * u, 90 * u, 36 * u); ctx.fillRect(W - m - 70 * u, m + 22 * u, 8 * u, 16 * u); ctx.fillRect(W - m - 154 * u, m + 18 * u, 60 * u, 24 * u);
  ctx.restore();
});
fx('Rétro et glitch', 'pixel', 'Pixelisation', '🟦', (ctx, k, l, d, W, H) => {
  const b = Math.max(2, Math.round((4 + k * 36) * sc(W) * 1.5)), w = Math.max(1, Math.round(W / b)), h = Math.max(1, Math.round(H / b));
  const [s, x] = scratch(3, w, h);
  x.drawImage(ctx.canvas, 0, 0, w, h);
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(s, 0, 0, W, H); ctx.restore();
});
fx('Rétro et glitch', 'huit-bits', 'Jeu vidéo 8 bits', '🕹️', (ctx, k, l, d, W, H) => {
  const b = Math.max(2, Math.round((6 + k * 10) * sc(W) * 1.5)), w = Math.max(1, Math.round(W / b)), h = Math.max(1, Math.round(H / b));
  const [s, x] = scratch(6, w, h, true);
  x.drawImage(ctx.canvas, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h), dd = img.data, q = (v) => Math.round(v / 85) * 85;
  for (let i = 0; i < dd.length; i += 4) { dd[i] = q(dd[i]); dd[i + 1] = q(dd[i + 1]); dd[i + 2] = q(dd[i + 2]); }
  x.putImageData(img, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(s, 0, 0, W, H); ctx.restore();
});
fx('Rétro et glitch', 'demi-teinte', 'Points BD (demi-teinte)', '🔘', (ctx, k, l, d, W, H) => {
  const cs = Math.max(4, Math.round((10 + 14 * k) * sc(W) * 1.4)), w = Math.ceil(W / cs), h = Math.ceil(H / cs);
  const [, x] = scratch(6, w, h, true);
  x.drawImage(ctx.canvas, 0, 0, w, h);
  const dd = x.getImageData(0, 0, w, h).data;
  overlay(ctx, W, H, '#fffbea', 0.85 * k + 0.1);
  ctx.save();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4, r = (1 - lum(dd[o], dd[o + 1], dd[o + 2])) * cs * 0.62;
    if (r < 0.4) continue;
    ctx.fillStyle = `rgb(${dd[o] * 0.8},${dd[o + 1] * 0.8},${dd[o + 2] * 0.8})`;
    ctx.beginPath(); ctx.arc(i * cs + cs / 2, j * cs + cs / 2, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
});

// --- Couleurs
fx('Couleurs', 'nb', 'Noir et blanc', '⚫', filt((k) => `grayscale(${k * 100}%)`));
fx('Couleurs', 'sepia', 'Sépia', '🟫', filt((k) => `sepia(${k * 100}%)`));
fx('Couleurs', 'negatif', 'Négatif', '🔄', filt((k) => `invert(${k * 100}%)`));
fx('Couleurs', 'arcenciel', 'Arc-en-ciel', '🌈', filt((k, l) => `hue-rotate(${Math.round(l * 160)}deg) saturate(${100 + k * 80}%)`));
fx('Couleurs', 'sature', 'Couleurs éclatantes', '🎨', filt((k) => `saturate(${100 + k * 160}%) contrast(${100 + k * 10}%)`));
fx('Couleurs', 'desature', 'Couleurs fanées', '🥀', filt((k) => `saturate(${100 - k * 75}%) brightness(${100 + k * 6}%)`));
fx('Couleurs', 'contraste', 'Contraste fort', '◐', filt((k) => `contrast(${100 + k * 90}%)`));
fx('Couleurs', 'froid', 'Teinte froide', '🧊', (ctx, k, l, d, W, H) => overlay(ctx, W, H, '#3a7bff', 0.45 * k, 'soft-light'));
fx('Couleurs', 'chaud', 'Teinte chaude', '🔥', (ctx, k, l, d, W, H) => overlay(ctx, W, H, '#ff9a3a', 0.5 * k, 'soft-light'));
fx('Couleurs', 'duotone', 'Duotone', '🟪', (ctx, k, l, d, W, H) => {
  const [c, x] = scratch(4, W, H);
  x.filter = 'grayscale(100%) contrast(115%)'; x.drawImage(ctx.canvas, 0, 0); x.filter = 'none';
  x.globalCompositeOperation = 'multiply'; x.fillStyle = '#ffd36e'; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'screen'; x.fillStyle = '#4b1d8f'; x.fillRect(0, 0, W, H);
  put(ctx, c, W, H, { a: k * 1.2 });
});
fx('Couleurs', 'thermique', 'Caméra thermique', '🌡️', (ctx, k, l, d, W, H) => {
  thermalLUT ||= gradientLUT(['#000010', '#2a00a0', '#a0009a', '#ff2030', '#ff9a00', '#ffff60', '#ffffff']);
  pixels(ctx, W, H, k, (r, g, b, x, y, o) => { const i = Math.min(255, Math.round(lum(r, g, b) * 255)) * 4; o[0] = thermalLUT[i]; o[1] = thermalLUT[i + 1]; o[2] = thermalLUT[i + 2]; });
});
fx('Couleurs', 'vision-nocturne', 'Vision nocturne', '🟢', (ctx, k, l, d, W, H, env) => {
  pixels(ctx, W, H, k, (r, g, b, x, y, o) => { const v = Math.min(1, lum(r, g, b) * 1.7 + 0.05); o[0] = v * 60; o[1] = v * 255; o[2] = v * 80; });
  noiseFill(ctx, W, H, 0.25 * k, Math.floor(l * env.fps), 'overlay');
  vignette(ctx, W, H, 0.9 * k, 0.25);
});
fx('Couleurs', 'pop-art', 'Pop art', '💥', (ctx, k, l, d, W, H) => pixels(ctx, W, H, k, (r, g, b, x, y, o) => { const q = (v) => (v > 170 ? 255 : v > 85 ? 160 : 30); o[0] = q(r * 1.1); o[1] = q(g * 1.05); o[2] = q(b * 1.15); }));
fx('Couleurs', 'couleur-selective', 'Rouge seul', '🍓', (ctx, k, l, d, W, H) => pixels(ctx, W, H, k, (r, g, b, x, y, o) => {
  const L = lum(r, g, b) * 255, red = cl((r - Math.max(g, b) - 40) / 60);
  o[0] = L + (r - L) * red; o[1] = L + (g - L) * red; o[2] = L + (b - L) * red;
}));
fx('Couleurs', 'seuil', 'Encre noire et blanche', '🖤', (ctx, k, l, d, W, H) => pixels(ctx, W, H, k, (r, g, b, x, y, o) => { const v = cl((lum(r, g, b) - 0.42) / 0.08) * 255; o[0] = o[1] = o[2] = v; }));

// --- Déformation
fx('Déformation', 'miroir', 'Miroir ⟷', '🪞', (ctx, k, l, d, W, H) => { const s = copyOf(ctx); ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(s, 0, 0, W / 2, H, 0, 0, W / 2, H); ctx.restore(); });
fx('Déformation', 'miroir-v', 'Miroir ↕', '🪞', (ctx, k, l, d, W, H) => { const s = copyOf(ctx); ctx.save(); ctx.translate(0, H); ctx.scale(1, -1); ctx.drawImage(s, 0, 0, W, H / 2, 0, 0, W, H / 2); ctx.restore(); });
fx('Déformation', 'kaleidoscope', 'Kaléidoscope', '🔮', (ctx, k, l, d, W, H) => {
  const s = copyOf(ctx), cx = W / 4 + Math.sin(l * 0.6) * W * 0.1 * k, cy = H / 4 + Math.cos(l * 0.5) * H * 0.1 * k;
  for (const [fx2, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(fx2, fy);
    ctx.drawImage(s, cx, cy, W / 2, H / 2, -W / 2, -H / 2, W / 2, H / 2);
    ctx.restore();
  }
});
fx('Déformation', 'quatre', 'Quatre écrans', '🔲', (ctx, k, l, d, W, H) => { const s = copyOf(ctx); for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) ctx.drawImage(s, (i * W) / 2, (j * H) / 2, W / 2, H / 2); });
fx('Déformation', 'neuf', 'Neuf écrans', '🔳', (ctx, k, l, d, W, H) => { const s = copyOf(ctx); for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) ctx.drawImage(s, (i * W) / 3, (j * H) / 3, W / 3 + 0.5, H / 3 + 0.5); });
fx('Déformation', 'flou', 'Flou', '🌫️', filt((k, l, u) => `blur(${k * 24 * u}px)`));
fx('Déformation', 'flou-mouvement', 'Flou de mouvement', '💨', (ctx, k, l, d, W, H) => { const s = copyOf(ctx); for (let i = 1; i <= 4; i++) put(ctx, s, W, H, { x: (i - 2.5) * 0.012 * k, a: 0.3 }); });
fx('Déformation', 'flou-radial', 'Flou radial', '🎯', (ctx, k, l, d, W, H) => { const s = copyOf(ctx); for (let i = 1; i <= 4; i++) put(ctx, s, W, H, { s: 1 + i * 0.025 * k, a: 0.28 }); });
fx('Déformation', 'vague', 'Vague', '🌊', (ctx, k, l, d, W, H, env) => {
  const s = copyOf(ctx), h = Math.max(2, Math.round(H / 140)), amp = W * 0.025 * k;
  ctx.save(); ctx.fillStyle = env.bg; ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += h) ctx.drawImage(s, 0, y, W, h, Math.sin((y / H) * Math.PI * 5 + l * 3) * amp, y, W, h + 0.5);
  ctx.restore();
});
fx('Déformation', 'ondulation', 'Ondulation verticale', '〰️', (ctx, k, l, d, W, H, env) => {
  const s = copyOf(ctx), w = Math.max(2, Math.round(W / 160)), amp = H * 0.03 * k;
  ctx.save(); ctx.fillStyle = env.bg; ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += w) ctx.drawImage(s, x, 0, w, H, x, Math.sin((x / W) * Math.PI * 6 + l * 4) * amp, w + 0.5, H);
  ctx.restore();
});
fx('Déformation', 'maquette', 'Effet maquette', '🏙️', (ctx, k, l, d, W, H) => {
  const [c, x] = scratch(4, W, H);
  x.filter = `blur(${10 * k * sc(W) * 1.5}px) saturate(130%)`; x.drawImage(ctx.canvas, 0, 0); x.filter = 'none';
  x.globalCompositeOperation = 'destination-in';
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#000'); g.addColorStop(0.35, 'rgba(0,0,0,0)'); g.addColorStop(0.65, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  ctx.drawImage(c, 0, 0);
});
fx('Déformation', 'envers', 'À l’envers', '🙃', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, { r: Math.PI }));
fx('Déformation', 'loupe', 'Loupe', '🔎', (ctx, k, l, d, W, H) => {
  const s = copyOf(ctx), r = Math.min(W, H) * (0.18 + 0.1 * k), x = W * (0.5 + 0.25 * Math.sin(l * 0.7)), y = H * (0.5 + 0.2 * Math.cos(l * 0.9)), z = 1.8 + 0.6 * k;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(x, y); ctx.scale(z, z); ctx.drawImage(s, -x, -y);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 6 * sc(W); ctx.shadowColor = '#000'; ctx.shadowBlur = 12 * sc(W);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
});

// --- Cadres
fx('Cadres', 'vignette', 'Vignette', '⭕', (ctx, k, l, d, W, H) => vignette(ctx, W, H, 0.9 * k, 0.25));
fx('Cadres', 'cinema', 'Bandes ciné', '🎬', (ctx, k, l, d, W, H) => {
  const h = H * 0.12 * k * Math.min(1, l / 0.4) * Math.min(1, (d - l) / 0.4);
  ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, h); ctx.fillRect(0, H - h, W, h); ctx.restore();
});
fx('Cadres', 'polaroid', 'Polaroïd', '🖼️', (ctx, k, l, d, W, H) => {
  const s = copyOf(ctx), m = Math.min(W, H) * 0.06, mb = m * 3.2;
  overlay(ctx, W, H, '#2a2a2a', 1);
  const fw = W * 0.7, fh = H * 0.86, fx2 = (W - fw) / 2, fy = (H - fh) / 2;
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(-0.03 * k); ctx.translate(-W / 2, -H / 2);
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30 * sc(W); ctx.fillStyle = '#f7f5ef'; ctx.fillRect(fx2, fy, fw, fh);
  ctx.shadowBlur = 0;
  const iw = fw - m * 2, ih = fh - m - mb, kk = Math.max(iw / W, ih / H);
  ctx.beginPath(); ctx.rect(fx2 + m, fy + m, iw, ih); ctx.clip();
  ctx.drawImage(s, fx2 + m + (iw - W * kk) / 2, fy + m + (ih - H * kk) / 2, W * kk, H * kk);
  ctx.restore();
});
fx('Cadres', 'bordure-neon', 'Bordure néon', '💠', (ctx, k, l, d, W, H) => {
  const u = sc(W), m = 30 * u;
  ctx.save(); ctx.strokeStyle = `hsl(${Math.round(l * 90) % 360},100%,62%)`; ctx.lineWidth = 10 * u; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = (30 + 20 * Math.sin(l * 6)) * u * k;
  ctx.globalAlpha = 0.5 + 0.5 * k;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(m, m, W - 2 * m, H - 2 * m, 30 * u) : ctx.rect(m, m, W - 2 * m, H - 2 * m); ctx.stroke(); ctx.stroke();
  ctx.restore();
});
fx('Cadres', 'viseur', 'Viseur photo', '📷', (ctx, k, l, d, W, H) => {
  const u = sc(W), cx = W / 2, cy = H / 2, s = 120 * u;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3 * u; ctx.globalAlpha = 0.5 + 0.5 * k;
  ctx.strokeRect(cx - s, cy - s * 0.7, s * 2, s * 1.4);
  ctx.beginPath(); ctx.moveTo(cx - 20 * u, cy); ctx.lineTo(cx + 20 * u, cy); ctx.moveTo(cx, cy - 20 * u); ctx.lineTo(cx, cy + 20 * u); ctx.stroke();
  ctx.setLineDash([10 * u, 10 * u]); ctx.strokeStyle = 'rgba(255,255,255,.45)';
  ctx.beginPath(); for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(W * f, 0); ctx.lineTo(W * f, H); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); } ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff'; ctx.font = `${30 * u}px Consolas, monospace`; ctx.fillText('ISO 400   1/125   f/2.8', 40 * u, H - 40 * u);
  if (Math.floor(l * 3) % 2 === 0) { ctx.fillStyle = '#5fd35f'; ctx.beginPath(); ctx.arc(W - 60 * u, 60 * u, 12 * u, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
});
fx('Cadres', 'cercle-focus', 'Cadre rond', '🔵', (ctx, k, l, d, W, H) => {
  const r = Math.min(W, H) * (0.62 - 0.2 * k);
  const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.92, W / 2, H / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
});
fx('Cadres', 'jumelles', 'Jumelles', '🔭', (ctx, k, l, d, W, H) => {
  const r = Math.min(W * 0.27, H * 0.46), dx = r * 0.82;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2 - dx, H / 2, r, 0, Math.PI * 2, true); ctx.moveTo(W / 2 + dx + r, H / 2); ctx.arc(W / 2 + dx, H / 2, r, 0, Math.PI * 2, true);
  ctx.globalAlpha = Math.min(1, 0.4 + k); ctx.fillStyle = '#000'; ctx.fill('evenodd');
  ctx.restore();
});
fx('Cadres', 'coins-arrondis', 'Coins arrondis', '▢', (ctx, k, l, d, W, H, env) => {
  const r = Math.min(W, H) * 0.12 * k, m = Math.min(W, H) * 0.04 * k;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H);
  if (ctx.roundRect) ctx.roundRect(m, m, W - 2 * m, H - 2 * m, r); else ctx.rect(m, m, W - 2 * m, H - 2 * m);
  ctx.fillStyle = env.bg; ctx.fill('evenodd'); ctx.restore();
});
fx('Cadres', 'cadre-dore', 'Cadre doré', '🏆', (ctx, k, l, d, W, H) => {
  const b = Math.min(W, H) * (0.03 + 0.04 * k), g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#8a6a1f'); g.addColorStop(0.3, '#f6e27a'); g.addColorStop(0.5, '#b8902c'); g.addColorStop(0.7, '#fff1a8'); g.addColorStop(1, '#7a5a14');
  ctx.save(); ctx.fillStyle = g; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(b, b, W - 2 * b, H - 2 * b); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = Math.max(1, b * 0.15); ctx.strokeRect(b, b, W - 2 * b, H - 2 * b); ctx.restore();
});
fx('Cadres', 'case-bd', 'Case de BD', '🗯️', (ctx, k, l, d, W, H) => {
  const m = Math.min(W, H) * 0.035, lw = Math.max(2, Math.min(W, H) * 0.012 * (0.5 + k));
  ctx.save(); ctx.fillStyle = '#fffbea'; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(m, m, W - 2 * m, H - 2 * m); ctx.fill('evenodd');
  ctx.strokeStyle = '#111'; ctx.lineWidth = lw; ctx.strokeRect(m, m, W - 2 * m, H - 2 * m); ctx.restore();
});

// --- Particules et météo
fx('Particules et météo', 'neige', 'Neige', '❄️', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { speed: [0.05, 0.15], size: [3, 10], draw: (x, X, Y, s) => { x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(X, Y, s / 2, 0, Math.PI * 2); x.fill(); } }));
fx('Particules et météo', 'pluie', 'Pluie', '🌧️', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [60, 400], speed: [0.9, 1.4], size: [30, 70], sway: 0, draw: (x, X, Y, s) => { x.strokeStyle = 'rgba(190,215,255,.55)'; x.lineWidth = Math.max(1, s / 25); x.beginPath(); x.moveTo(X, Y); x.lineTo(X - s * 0.15, Y + s); x.stroke(); } }));
fx('Particules et météo', 'orage', 'Orage', '⛈️', (ctx, k, l, d, W, H) => {
  overlay(ctx, W, H, '#0a1020', 0.35 * k);
  fall(ctx, W, H, l, k, { n: [120, 450], speed: [1.1, 1.6], size: [40, 80], sway: 0, draw: (x, X, Y, s) => { x.strokeStyle = 'rgba(200,220,255,.5)'; x.lineWidth = Math.max(1, s / 30); x.beginPath(); x.moveTo(X, Y); x.lineTo(X - s * 0.2, Y + s); x.stroke(); } });
  const t = l % 3.1;
  if (t < 0.08 || (t > 0.16 && t < 0.22)) overlay(ctx, W, H, '#e8f0ff', 0.7 * k);
});
fx('Particules et météo', 'confettis', 'Confettis', '🎉', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { speed: [0.08, 0.22], size: [14, 30], draw: (x, X, Y, s, i, r) => { x.fillStyle = CONF[i % CONF.length]; x.save(); x.translate(X, Y); x.rotate(l * (2 + r * 4) + i); x.fillRect(-s / 2, -s / 4, s, s / 2); x.restore(); } }));
fx('Particules et météo', 'coeurs', 'Cœurs', '💖', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [15, 90], speed: [0.06, 0.18], size: [30, 70], glyphs: ['💖', '💗', '❤️'], spin: 0.3 }));
fx('Particules et météo', 'etoiles', 'Étoiles', '✨', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [15, 90], speed: [0.03, 0.1], size: [24, 60], glyphs: ['✨', '⭐'], alpha: (i, t) => 0.3 + 0.7 * Math.abs(Math.sin(t * 3 + i)) }));
fx('Particules et météo', 'bulles', 'Bulles', '🫧', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { up: true, speed: [0.05, 0.15], size: [12, 40], draw: (x, X, Y, s) => { x.strokeStyle = 'rgba(200,230,255,.8)'; x.lineWidth = Math.max(1, s / 10); x.beginPath(); x.arc(X, Y, s, 0, Math.PI * 2); x.stroke(); x.fillStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.arc(X - s * 0.35, Y - s * 0.35, s * 0.2, 0, Math.PI * 2); x.fill(); } }));
fx('Particules et météo', 'feuilles', 'Feuilles d’automne', '🍂', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [10, 70], speed: [0.06, 0.14], size: [30, 64], sway: 0.06, glyphs: ['🍂', '🍁', '🍃'], spin: 1.2 }));
fx('Particules et météo', 'petales', 'Pétales', '🌸', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [10, 80], speed: [0.05, 0.12], size: [24, 50], sway: 0.07, glyphs: ['🌸', '💮'], spin: 1 }));
fx('Particules et météo', 'billets', 'Pluie de billets', '💸', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [10, 70], speed: [0.08, 0.18], size: [40, 80], glyphs: ['💸', '💵', '💶'], spin: 0.8 }));
fx('Particules et météo', 'rires', 'Pluie de rires', '😂', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [10, 60], speed: [0.1, 0.22], size: [50, 100], glyphs: ['😂', '🤣'], spin: 0.5 }));
fx('Particules et météo', 'notes', 'Notes de musique', '🎵', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [8, 50], up: true, speed: [0.06, 0.14], size: [36, 70], sway: 0.05, glyphs: ['🎵', '🎶', '🎼'], spin: 0.4 }));
fx('Particules et météo', 'ballons', 'Ballons', '🎈', (ctx, k, l, d, W, H) => fall(ctx, W, H, l, k, { n: [6, 40], up: true, speed: [0.08, 0.16], size: [60, 110], sway: 0.03, glyphs: ['🎈'] }));
fx('Particules et météo', 'braises', 'Braises', '🔥', (ctx, k, l, d, W, H) => {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  fall(ctx, W, H, l, k, { n: [30, 200], up: true, speed: [0.08, 0.25], size: [3, 9], sway: 0.04, draw: (x, X, Y, s, i) => { const a = 0.5 + 0.5 * Math.sin(l * 9 + i); x.fillStyle = `rgba(255,${120 + (i % 5) * 20},40,${a})`; x.shadowColor = '#ff7a20'; x.shadowBlur = s * 3; x.beginPath(); x.arc(X, Y, s, 0, Math.PI * 2); x.fill(); } });
  ctx.restore();
});
fx('Particules et météo', 'lucioles', 'Lucioles', '🪲', (ctx, k, l, d, W, H) => {
  const u = sc(W), n = Math.round(10 + 50 * k);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = (noise1(l * 0.15 + i * 7.3) * 1.4 - 0.2) * W, y = (noise1(l * 0.12 + i * 3.1 + 50) * 1.4 - 0.2) * H, a = 0.3 + 0.7 * Math.abs(Math.sin(l * (1 + hash(i)) + i)), r = 10 * u;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, `rgba(230,255,140,${a})`); g.addColorStop(1, 'rgba(180,255,80,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  ctx.restore();
});
fx('Particules et météo', 'paillettes', 'Paillettes', '🌟', (ctx, k, l, d, W, H) => {
  const u = sc(W), n = Math.round(20 + 120 * k);
  ctx.save(); ctx.fillStyle = '#fff'; ctx.shadowColor = '#ffe9a0'; ctx.shadowBlur = 10 * u;
  for (let i = 0; i < n; i++) {
    const tw = Math.max(0, Math.sin(l * (2 + hash(i) * 3) + i * 2)), r = (8 + hash(i + 5) * 20) * u * tw, x = hash(i) * W, y = hash(i + 30) * H;
    if (r < 0.5) continue;
    ctx.globalAlpha = tw;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
  }
  ctx.restore();
});
fx('Particules et météo', 'brouillard', 'Brouillard', '🌁', (ctx, k, l, d, W, H) => {
  ctx.save(); ctx.filter = `blur(${40 * sc(W)}px)`;
  for (let i = 0; i < 8; i++) {
    const x = (((hash(i) + l * (0.02 + hash(i + 9) * 0.04)) % 1.4) - 0.2) * W, y = (0.3 + hash(i + 3) * 0.7) * H, r = (0.2 + hash(i + 6) * 0.25) * W;
    ctx.fillStyle = `rgba(225,232,240,${0.22 * k})`; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
});
fx('Particules et météo', 'feux-artifice', 'Feux d’artifice', '🎆', (ctx, k, l, d, W, H) => {
  const u = sc(W);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 2 + Math.round(3 * k); b++) {
    const per = 1.6 + hash(b) * 0.8, t = (l + hash(b + 4) * per) % per, slot = Math.floor((l + hash(b + 4) * per) / per);
    if (t > 1.3) continue;
    const cx = (0.15 + hash(b * 7 + slot) * 0.7) * W, cy = (0.15 + hash(b * 3 + slot * 5) * 0.4) * H, hue = Math.round(hash(b + slot * 11) * 360), R = (220 + hash(slot + b) * 160) * u;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, q = eo(cl(t / 1.1)), x = cx + Math.cos(a) * R * q, y = cy + Math.sin(a) * R * q + t * t * 120 * u;
      ctx.fillStyle = `hsla(${hue},100%,${60 + 20 * hash(i)}%,${1 - t / 1.3})`;
      ctx.beginPath(); ctx.arc(x, y, 4 * u, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
});
fx('Particules et météo', 'poussiere', 'Poussière dorée', '✨', (ctx, k, l, d, W, H) => {
  const u = sc(W), n = Math.round(40 + 160 * k);
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < n; i++) {
    const x = (((hash(i) + l * 0.01 * (hash(i + 2) - 0.5)) % 1) + 1) % 1 * W, y = (((hash(i + 7) - l * 0.015 * (0.5 + hash(i + 3))) % 1) + 1) % 1 * H;
    ctx.fillStyle = `rgba(255,225,160,${0.25 + 0.6 * Math.abs(Math.sin(l * 2 + i))})`;
    ctx.beginPath(); ctx.arc(x, y, (1 + hash(i + 1) * 3) * u * 1.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
});

// --- Fondus (sur la durée de l'effet)
fx('Fondus', 'fondunoir', 'Fondu vers le noir', '🌑', (ctx, k, l, d, W, H) => overlay(ctx, W, H, '#000', k * cl(l / Math.max(0.1, d)) * 1.2));
fx('Fondus', 'fondublanc', 'Fondu vers le blanc', '⬜', (ctx, k, l, d, W, H) => overlay(ctx, W, H, '#fff', k * cl(l / Math.max(0.1, d)) * 1.2));
fx('Fondus', 'ouverture-noir', 'Ouverture depuis le noir', '🌒', (ctx, k, l, d, W, H) => overlay(ctx, W, H, '#000', Math.min(1, k * 1.2) * (1 - cl(l / Math.max(0.1, d)))));
fx('Fondus', 'iris-fermeture', 'Iris qui se ferme', '⚫', (ctx, k, l, d, W, H) => {
  const r = (Math.hypot(W, H) / 2) * (1 - ease(cl(l / d)) * Math.min(1, k * 1.3));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, Math.max(0, r), 0, Math.PI * 2, true); ctx.fillStyle = '#000'; ctx.fill('evenodd'); ctx.restore();
});
fx('Fondus', 'iris-ouverture', 'Iris qui s’ouvre', '⚪', (ctx, k, l, d, W, H) => {
  const r = (Math.hypot(W, H) / 2) * ease(cl(l / d));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, Math.max(0, r), 0, Math.PI * 2, true); ctx.globalAlpha = Math.min(1, k * 1.3); ctx.fillStyle = '#000'; ctx.fill('evenodd'); ctx.restore();
});
fx('Fondus', 'mise-au-point', 'Mise au point', '🎯', (ctx, k, l, d, W, H, env) => redraw(ctx, W, H, env, {}, `blur(${(1 - ease(cl(l / d))) * 30 * k * sc(W)}px)`));

export const EFFECT_LIST = E;
export const EFFECT_BY_ID = Object.fromEntries(E.map((e) => [e.id, e]));

/** Applique l'effet `id` sur l'image composée dans ctx */
export function applyFx(ctx, id, k, local, duration, W, H, env) {
  const e = EFFECT_BY_ID[id];
  if (!e) return;
  ctx.save();
  try {
    e.apply(ctx, Math.max(0, Math.min(1, k)), local, Math.max(0.05, duration), W, H, env);
  } finally {
    ctx.restore();
  }
}
/** Applique la transition `id` (A = image avant, B = image après) */
export function applyTransition(ctx, id, A, B, p, W, H) {
  const t = TRANSITION_BY_ID[id];
  ctx.save();
  try {
    if (t) t.draw(ctx, A, B, Math.max(0, Math.min(1, p)), W, H);
    else ctx.drawImage(B, 0, 0);
  } finally {
    ctx.restore();
  }
}

/** Catégories dans l'ordre d'apparition */
export const groupsOf = (list) => {
  const out = new Map();
  for (const it of list) (out.get(it.cat) || out.set(it.cat, []).get(it.cat)).push(it);
  return [...out];
};
