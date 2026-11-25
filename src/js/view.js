import { app, emit } from './state.js';
import { drawFrame, setImageLoadCallback } from './render.js';
import { makeCanvas } from './util.js';
import { drawToolOverlay, viewExtra } from './tools.js';

const vp = document.getElementById('viewport');
const vctx = vp.getContext('2d');
const rulerTop = document.getElementById('rulerTop');
const rulerLeft = document.getElementById('rulerLeft');
let W = 0, H = 0, dpr = 1;

setImageLoadCallback(() => requestRender());

export const viewSize = () => ({ w: W, h: H });

export function screenToDoc(clientX, clientY) {
  const r = vp.getBoundingClientRect();
  return { x: (clientX - r.left - app.panX) / app.zoom, y: (clientY - r.top - app.panY) / app.zoom };
}

export function resizeViewport() {
  const r = vp.parentElement.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width;
  H = r.height;
  vp.width = Math.max(1, Math.round(W * dpr));
  vp.height = Math.max(1, Math.round(H * dpr));
  for (const [c, w, h] of [[rulerTop, W, 20], [rulerLeft, 20, H]]) {
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
  }
  renderNow();
}

const PIXEL_ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];

export function fitView() {
  const d = app.doc;
  if (!d || !W) return;
  const m = 48;
  let z = Math.min((W - m * 2) / d.width, (H - m * 2) / d.height);
  if (d.mode === 'pixel') z = [...PIXEL_ZOOMS].reverse().find((v) => v <= z) || PIXEL_ZOOMS[0];
  app.zoom = Math.max(0.02, z);
  centerView();
}

export function centerView() {
  const d = app.doc;
  app.panX = Math.round((W - d.width * app.zoom) / 2);
  app.panY = Math.round((H - d.height * app.zoom) / 2);
  emit('status');
  requestRender();
}

export function setZoom(nz, cx = W / 2, cy = H / 2) {
  const dx = (cx - app.panX) / app.zoom;
  const dy = (cy - app.panY) / app.zoom;
  app.zoom = nz;
  app.panX = cx - dx * nz;
  app.panY = cy - dy * nz;
  if (app.mode === 'pixel') {
    app.panX = Math.round(app.panX);
    app.panY = Math.round(app.panY);
  }
  emit('status');
  requestRender();
}

export function zoomStep(dir, cx = W / 2, cy = H / 2) {
  let nz;
  if (app.mode === 'pixel') {
    const i = PIXEL_ZOOMS.findIndex((z) => z >= app.zoom - 1e-9);
    const cur = i < 0 ? PIXEL_ZOOMS.length - 1 : i;
    if (dir > 0) nz = PIXEL_ZOOMS[Math.min(PIXEL_ZOOMS.length - 1, PIXEL_ZOOMS[cur] > app.zoom + 1e-9 ? cur : cur + 1)];
    else nz = PIXEL_ZOOMS[Math.max(0, cur - 1)];
  } else nz = Math.max(0.05, Math.min(40, app.zoom * (dir > 0 ? 1.2 : 1 / 1.2)));
  setZoom(nz, cx, cy);
}

let pending = false;
export function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    renderNow();
  });
}

function renderNow() {
  renderView();
  renderRulers();
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let checker = null;
function checkerPattern(ctx) {
  if (!checker) {
    const c = makeCanvas(16, 16);
    const x = c.getContext('2d');
    x.fillStyle = '#161a22';
    x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#1f2430';
    x.fillRect(0, 0, 8, 8);
    x.fillRect(8, 8, 8, 8);
    checker = c;
  }
  return ctx.createPattern(checker, 'repeat');
}

let onionCanvas = null;
function drawOnion(ctx, T) {
  const d = app.doc;
  const n = d.frames.length;
  const fi = app.frameIndex;
  if (!onionCanvas) onionCanvas = makeCanvas(1, 1);
  if (onionCanvas.width !== vp.width || onionCanvas.height !== vp.height) {
    onionCanvas.width = vp.width;
    onionCanvas.height = vp.height;
  }
  const octx = onionCanvas.getContext('2d');
  const layer = (k, col, alpha) => {
    const idx = fi + k;
    if (idx < 0 || idx >= n) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    octx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
    drawFrame(octx, d, idx, T);
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-atop';
    octx.globalAlpha = 0.6;
    octx.fillStyle = col;
    octx.fillRect(0, 0, onionCanvas.width, onionCanvas.height);
    octx.globalAlpha = 1;
    octx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(onionCanvas, 0, 0);
    ctx.restore();
  };
  for (let k = app.onion.before; k >= 1; k--) layer(-k, '#ff4d6d', 0.4 / k);
  for (let k = app.onion.after; k >= 1; k--) layer(k, css('--accent') || '#2f8cff', 0.4 / k);
}

function renderView() {
  const ctx = vctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = css('--canvas-bg') || '#05070a';
  ctx.fillRect(0, 0, vp.width, vp.height);
  const d = app.doc;
  if (!d) return;
  const z = app.zoom * dpr;
  const ox = Math.round(app.panX * dpr);
  const oy = Math.round(app.panY * dpr);
  const dw = d.width * z, dh = d.height * z;

  // ombre du canevas
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(ox + 6 * dpr, oy + 6 * dpr, dw, dh);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, dw, dh);
  ctx.clip();
  if (app.grid.checker) {
    const pat = checkerPattern(ctx);
    pat.setTransform(new DOMMatrix().translate(ox, oy).scale(dpr));
    ctx.fillStyle = pat;
  } else ctx.fillStyle = app.grid.bg;
  ctx.fillRect(ox, oy, dw, dh);
  const T = [z, 0, 0, z, ox, oy];
  if (app.onion.enabled && !app.playing) drawOnion(ctx, T);
  drawFrame(ctx, d, app.frameIndex, T, viewExtra());
  ctx.restore();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (app.showGrid) drawGrid(ctx, z, ox, oy, dw, dh);
  ctx.strokeStyle = 'rgba(' + (css('--accent-rgb') || '47,140,255') + ',.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 0.5, oy - 0.5, dw + 1, dh + 1);
  drawToolOverlay(ctx, z, ox, oy, dpr);
}

const rgba = (hex, a) => {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};

/** Pas de la grille en mode dessin (en unités du document) */
export function gridStep() {
  if (app.grid.step > 0) return app.grid.step;
  let step = 25;
  while (step * app.zoom < 14) step *= 2;
  return step;
}

function drawGrid(ctx, z, ox, oy, dw, dh) {
  const d = app.doc;
  const g = app.grid;
  const op = g.opacity / 50;
  const minorCol = rgba(g.color, (d.mode === 'pixel' ? 0.16 : 0.1) * op);
  const majorCol = g.majorColor ? rgba(g.majorColor, 0.38 * op) : `rgba(${css('--accent-rgb') || '47,140,255'},${Math.min(1, 0.38 * op)})`;
  const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(d.width, Math.ceil((vp.width - ox) / z));
  const y0 = Math.max(0, Math.floor(-oy / z)), y1 = Math.min(d.height, Math.ceil((vp.height - oy) / z));
  const line = (step, color) => {
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const sx = Math.round(ox + x * z) + 0.5;
      ctx.moveTo(sx, Math.max(oy, 0));
      ctx.lineTo(sx, Math.min(oy + dh, vp.height));
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const sy = Math.round(oy + y * z) + 0.5;
      ctx.moveTo(Math.max(ox, 0), sy);
      ctx.lineTo(Math.min(ox + dw, vp.width), sy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  const dots = (step, color, major) => {
    if (step * z < 6) return;
    const r = major || step * z >= 16 ? 1 : 0;
    ctx.fillStyle = color;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        ctx.fillRect(Math.round(ox + x * z) - r, Math.round(oy + y * z) - r, r * 2 + 1, r * 2 + 1);
      }
    }
  };
  const draw = (step, color, major) => (g.style === 'dots' ? dots(step, color.replace(/[\d.]+\)$/, (m) => Math.min(1, parseFloat(m) * (major ? 2.2 : 3.5)) + ')'), major) : line(step, color));
  if (d.mode === 'pixel') {
    if (g.pixelLines && z >= 5 * dpr) draw(1, minorCol, false);
    if (app.gridMajor > 1 && z * app.gridMajor >= 8) draw(app.gridMajor, majorCol, true);
  } else {
    const step = gridStep();
    if (step * z >= 4) draw(step, minorCol, false);
    if (g.subdiv > 1) draw(step * g.subdiv, majorCol, true);
  }
}

function renderRulers() {
  if (!app.showRulers || !app.doc) return;
  const accent = css('--accent') || '#2f8cff';
  const pick = () => {
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    return steps.find((s) => s * app.zoom >= 48) || 10000;
  };
  const step = pick();
  const minor = step / (step % 5 === 0 ? 5 : 2);
  for (const horiz of [true, false]) {
    const c = horiz ? rulerTop : rulerLeft;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css('--bg2') || '#0b0e14';
    ctx.fillRect(0, 0, c.width, c.height);
    const len = horiz ? W : H;
    const pan = horiz ? app.panX : app.panY;
    const start = Math.floor(-pan / app.zoom / minor) * minor;
    const end = (len - pan) / app.zoom;
    ctx.strokeStyle = '#3a4560';
    ctx.fillStyle = '#7f8ba3';
    ctx.font = '9px Segoe UI, sans-serif';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = start; v <= end; v += minor) {
      const p = Math.round(pan + v * app.zoom) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const t = major ? 10 : 5;
      if (horiz) {
        ctx.moveTo(p, 20);
        ctx.lineTo(p, 20 - t);
      } else {
        ctx.moveTo(20, p);
        ctx.lineTo(20 - t, p);
      }
      if (major) {
        const label = String(Math.round(v));
        if (horiz) ctx.fillText(label, p + 3, 9);
        else {
          ctx.save();
          ctx.translate(9, p - 3);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.stroke();
    // limites du document
    const a = pan, b = pan + (horiz ? app.doc.width : app.doc.height) * app.zoom;
    ctx.fillStyle = `rgba(${css('--accent-rgb') || '47,140,255'},.12)`;
    if (horiz) ctx.fillRect(a, 0, b - a, 20);
    else ctx.fillRect(0, a, 20, b - a);
    if (app.hover) {
      const hp = pan + (horiz ? app.hover.x : app.hover.y) * app.zoom;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      if (horiz) {
        ctx.moveTo(hp, 0);
        ctx.lineTo(hp, 20);
      } else {
        ctx.moveTo(0, hp);
        ctx.lineTo(20, hp);
      }
      ctx.stroke();
    }
  }
}
