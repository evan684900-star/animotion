import { app, hooks, curLayer, curFrame, refreshUI, emit } from './state.js';
import { requestRender, screenToDoc, gridStep } from './view.js';

// Magnétisme : en mode dessin, arrondit un point (ou un déplacement) au pas de la grille
const snapOn = () => app.mode === 'vector' && app.grid.snap;
const snapV = (v) => {
  if (!snapOn()) return v;
  const s = gridStep();
  return Math.round(v / s) * s;
};
import { pushHistory, celEntry } from './history.js';
import { makeCanvas, ctx2d, hexToRgba, rgbToHex, clamp, cloneCanvas } from './util.js';
import { shapePath, compositeFrame, bbox } from './render.js';
import { newId } from './doc.js';
import { toast } from './dialogs.js';
import { setColor, recentColor } from './actions.js';

export const TOOL_DEFS = {
  pencil: { label: 'Crayon', icon: 'pencil', key: 'B' },
  brush: { label: 'Pinceau', icon: 'brush', key: 'B' },
  eraser: { label: 'Gomme', icon: 'eraser', key: 'E' },
  bucket: { label: 'Remplissage', icon: 'bucket', key: 'G' },
  picker: { label: 'Pipette', icon: 'picker', key: 'I' },
  line: { label: 'Ligne', icon: 'line', key: 'L' },
  rect: { label: 'Rectangle', icon: 'rect', key: 'R' },
  ellipse: { label: 'Ellipse', icon: 'ellipse', key: 'O' },
  select: { label: 'Sélection', icon: 'select', key: 'M' },
};
export const toolsFor = (mode) =>
  mode === 'pixel'
    ? ['pencil', 'eraser', 'bucket', 'picker', 'line', 'rect', 'ellipse', 'select']
    : ['brush', 'eraser', 'bucket', 'picker', 'line', 'rect', 'ellipse', 'select'];

export function setTool(t) {
  if (t === 'pencil' && app.mode === 'vector') t = 'brush';
  if (t === 'brush' && app.mode === 'pixel') t = 'pencil';
  if (app.tool === t) return;
  if (app.mode === 'pixel' && t !== 'select') commitFloating();
  app.tool = t;
  refreshUI();
  requestRender();
}

function editable() {
  const l = curLayer();
  if (!l.visible) {
    toast('Ce calque est masqué 👻 — affiche-le pour dessiner dessus', 'warn');
    return false;
  }
  if (l.locked) {
    toast('Ce calque est verrouillé 🔒', 'warn');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- Gestes
let active = null;
export function pointerDown(e) {
  const p = screenToDoc(e.clientX, e.clientY);
  active = (app.mode === 'pixel' ? pixelDown : vectorDown)(p, e) || null;
  requestRender();
}
export function pointerMove(e) {
  const p = screenToDoc(e.clientX, e.clientY);
  app.hover = p;
  if (active?.move) active.move(p, e);
  requestRender();
}
export function pointerUp(e) {
  if (active?.up) active.up(screenToDoc(e.clientX, e.clientY), e);
  active = null;
  requestRender();
}
export const isDrawing = () => !!active;

function pickColor(x, y, secondary) {
  const d = app.doc;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  const c = compositeFrame(d, app.frameIndex, 1);
  const px = c.getContext('2d').getImageData(x, y, 1, 1).data;
  if (px[3] === 0) return;
  setColor(rgbToHex(px[0], px[1], px[2]), secondary);
}

// ================================================================ PIXEL
const W = () => app.doc.width;
const H = () => app.doc.height;
function celCtx(layerId = curLayer().id, frameId = curFrame().id) {
  return ctx2d(app.doc.getCel(layerId, frameId));
}
function commitPixel(before, layerId = curLayer().id, frameId = curFrame().id) {
  const after = celCtx(layerId, frameId).getImageData(0, 0, W(), H());
  pushHistory(celEntry(layerId, frameId, before, after));
  app.doc.updateFlag(layerId, frameId);
  refreshUI();
}

function stamp(ctx, x, y, erase, color) {
  const s = app.pixelSize, o = Math.floor((s - 1) / 2);
  if (erase) ctx.clearRect(x - o, y - o, s, s);
  else {
    ctx.fillStyle = color;
    ctx.fillRect(x - o, y - o, s, s);
  }
}

function bresenham(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function constrain(tool, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  if (tool === 'line') {
    if (Math.abs(dx) > 2 * Math.abs(dy)) return [x1, y0];
    if (Math.abs(dy) > 2 * Math.abs(dx)) return [x0, y1];
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return [x0 + Math.sign(dx) * m, y0 + Math.sign(dy) * m];
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + (Math.sign(dx) || 1) * m, y0 + (Math.sign(dy) || 1) * m];
}

function pixelShape(ctx, tool, x0, y0, x1, y1, color) {
  if (tool === 'line') return bresenham(x0, y0, x1, y1, (a, b) => stamp(ctx, a, b, false, color));
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  const fill = app.fillShapes ? app.color2 : null;
  if (tool === 'rect') {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(l, t, r - l + 1, b - t + 1);
    }
    const st = (a, c) => stamp(ctx, a, c, false, color);
    bresenham(l, t, r, t, st);
    bresenham(r, t, r, b, st);
    bresenham(r, b, l, b, st);
    bresenham(l, b, l, t, st);
    return;
  }
  // ellipse
  const cx = (l + r + 1) / 2, cy = (t + b + 1) / 2, rx = (r - l + 1) / 2, ry = (b - t + 1) / 2;
  const inside = (px, py) => {
    const dx = (px + 0.5 - cx) / rx, dy = (py + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1.0001;
  };
  for (let py = t; py <= b; py++) {
    for (let px = l; px <= r; px++) {
      if (!inside(px, py)) continue;
      const edge = !inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1);
      if (edge) stamp(ctx, px, py, false, color);
      else if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

function floodFill(ctx, x, y, rgba) {
  const w = W(), h = H();
  const img = ctx.getImageData(0, 0, w, h);
  const d = new Uint32Array(img.data.buffer);
  const target = d[y * w + x];
  const rep = new Uint32Array(new Uint8ClampedArray(rgba).buffer)[0];
  if (target === rep) return;
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop();
    let px = stack.pop();
    let i = py * w + px;
    while (px > 0 && d[i - 1] === target) { px--; i--; }
    let up = false, down = false;
    while (px < w && d[i] === target) {
      d[i] = rep;
      if (py > 0) {
        if (d[i - w] === target) { if (!up) { stack.push(px, py - 1); up = true; } } else up = false;
      }
      if (py < h - 1) {
        if (d[i + w] === target) { if (!down) { stack.push(px, py + 1); down = true; } } else down = false;
      }
      px++;
      i++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

let lastPoint = null;
function pixelDown(p, e) {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  const alt = e.button === 2;
  const color = alt ? app.color2 : app.color;
  const tool = app.tool;
  if (tool === 'picker') {
    pickColor(x, y, alt);
    return { move: (q) => pickColor(q.x, q.y, alt) };
  }
  if (tool === 'select') return pixelSelectDown(x, y);
  if (!editable()) return null;
  const ctx = celCtx();
  const before = ctx.getImageData(0, 0, W(), H());
  const layerId = curLayer().id, frameId = curFrame().id;

  if (tool === 'pencil' || tool === 'eraser') {
    const erase = tool === 'eraser';
    let lx = x, ly = y;
    if (e.shiftKey && lastPoint) bresenham(lastPoint.x, lastPoint.y, x, y, (a, b) => stamp(ctx, a, b, erase, color));
    else stamp(ctx, x, y, erase, color);
    lastPoint = { x, y };
    return {
      move(q) {
        const nx = Math.floor(q.x), ny = Math.floor(q.y);
        if (nx === lx && ny === ly) return;
        bresenham(lx, ly, nx, ny, (a, b) => stamp(ctx, a, b, erase, color));
        lx = nx;
        ly = ny;
        lastPoint = { x: nx, y: ny };
      },
      up() {
        commitPixel(before, layerId, frameId);
        if (!erase) recentColor(color);
      },
    };
  }
  if (tool === 'bucket') {
    if (x < 0 || y < 0 || x >= W() || y >= H()) return null;
    floodFill(ctx, x, y, hexToRgba(color));
    commitPixel(before, layerId, frameId);
    recentColor(color);
    return null;
  }
  // ligne / rectangle / ellipse avec aperçu en direct
  const draw = (q, ev) => {
    ctx.putImageData(before, 0, 0);
    let ex = Math.floor(q.x), ey = Math.floor(q.y);
    if (ev.shiftKey) [ex, ey] = constrain(tool, x, y, ex, ey);
    pixelShape(ctx, tool, x, y, ex, ey, color);
  };
  draw(p, e);
  return {
    move: draw,
    up() {
      commitPixel(before, layerId, frameId);
      recentColor(color);
    },
  };
}

// --- Sélection pixel
const inRect = (x, y, r) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const floatRect = (f) => ({ x: f.x, y: f.y, w: f.canvas.width, h: f.canvas.height });

function pixelSelectDown(x, y) {
  if (app.floating && inRect(x, y, floatRect(app.floating))) return dragFloating(x, y);
  if (app.sel && !app.floating && inRect(x, y, app.sel)) {
    if (!editable()) return null;
    lift();
    return dragFloating(x, y);
  }
  commitFloating();
  const sx = clamp(x, 0, W() - 1), sy = clamp(y, 0, H() - 1);
  app.sel = { x: sx, y: sy, w: 1, h: 1 };
  let moved = false;
  return {
    move(q) {
      const ex = clamp(Math.floor(q.x), 0, W() - 1), ey = clamp(Math.floor(q.y), 0, H() - 1);
      if (ex !== sx || ey !== sy) moved = true;
      app.sel = { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx) + 1, h: Math.abs(ey - sy) + 1 };
    },
    up() {
      if (!moved) app.sel = null;
      refreshUI();
    },
  };
}

function dragFloating(x, y) {
  const f = app.floating;
  const ox = x - f.x, oy = y - f.y;
  return {
    move(q) {
      f.x = Math.floor(q.x) - ox;
      f.y = Math.floor(q.y) - oy;
      app.sel = floatRect(f);
    },
  };
}

function lift() {
  const s = app.sel;
  const ctx = celCtx();
  const before = ctx.getImageData(0, 0, W(), H());
  const c = makeCanvas(s.w, s.h);
  ctx2d(c).drawImage(ctx.canvas, -s.x, -s.y);
  ctx.clearRect(s.x, s.y, s.w, s.h);
  app.floating = { canvas: c, x: s.x, y: s.y, before, layerId: curLayer().id, frameId: curFrame().id };
}

export function commitFloating() {
  const f = app.floating;
  if (!f) return;
  app.floating = null;
  if (!app.doc.layers.some((l) => l.id === f.layerId) || !app.doc.frames.some((fr) => fr.id === f.frameId)) return;
  const ctx = celCtx(f.layerId, f.frameId);
  ctx.drawImage(f.canvas, f.x, f.y);
  commitPixel(f.before, f.layerId, f.frameId);
  const r = floatRect(f);
  const x0 = clamp(r.x, 0, W()), y0 = clamp(r.y, 0, H());
  const x1 = clamp(r.x + r.w, 0, W()), y1 = clamp(r.y + r.h, 0, H());
  app.sel = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  requestRender();
}
hooks.commitPending = commitFloating;

export function viewExtra() {
  const f = app.floating;
  if (!f || f.frameId !== curFrame()?.id) return null;
  return { layerId: f.layerId, draw: (ctx) => ctx.drawImage(f.canvas, f.x, f.y) };
}

// ================================================================ VECTORIEL
const hctx = makeCanvas(2, 2).getContext('2d');
const R2 = (v) => Math.round(v * 100) / 100;

function pointInPoly(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function hit(s, x, y, tol) {
  if (s.img) return pointInPoly(s.pts, x, y);
  if (s.pts.length === 1) return Math.hypot(x - s.pts[0][0], y - s.pts[0][1]) <= s.width / 2 + tol;
  const p = shapePath(s);
  if (s.fill && hctx.isPointInPath(p, x, y)) return true;
  if (s.stroke && s.width > 0) {
    hctx.lineWidth = s.width + tol * 2;
    hctx.lineCap = 'round';
    hctx.lineJoin = 'round';
    return hctx.isPointInStroke(p, x, y);
  }
  return false;
}
function topHit(shapes, x, y, tol) {
  for (let i = shapes.length - 1; i >= 0; i--) if (hit(shapes[i], x, y, tol)) return shapes[i];
  return null;
}

const vcel = () => app.doc.getCel(curLayer().id, curFrame().id);
export const selectedShapes = () => (app.mode === 'vector' ? vcel().shapes.filter((s) => app.vsel.has(s.id)) : []);

function commitVector(before) {
  const l = curLayer().id, f = curFrame().id;
  pushHistory(celEntry(l, f, before, structuredClone(vcel().shapes)));
  refreshUI();
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    const dd = len < 1e-6 ? Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) : d;
    if (dd > dmax) { dmax = dd; idx = i; }
  }
  if (dmax > eps) {
    const left = rdp(pts.slice(0, idx + 1), eps);
    const right = rdp(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function vectorShapePts(tool, x0, y0, x1, y1) {
  if (tool === 'line') return [[x0, y0], [x1, y1]];
  if (tool === 'rect') return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

function vectorDown(p, e) {
  const tool = app.tool;
  const alt = e.button === 2;
  const color = alt ? app.color2 : app.color;
  if (tool === 'picker') {
    pickColor(p.x, p.y, alt);
    return { move: (q) => pickColor(q.x, q.y, alt) };
  }
  if (tool === 'select') return vectorSelectDown(p, e);
  if (!editable()) return null;
  const cel = vcel();
  const before = structuredClone(cel.shapes);

  if (tool === 'brush') {
    const s = { id: newId(), pts: [[R2(p.x), R2(p.y)]], smooth: false, closed: false, stroke: color, width: app.vectorSize, fill: null };
    cel.shapes.push(s);
    const raw = [[p.x, p.y]];
    return {
      move(q) {
        const last = raw[raw.length - 1];
        if (Math.hypot(q.x - last[0], q.y - last[1]) < 0.75 / app.zoom) return;
        raw.push([q.x, q.y]);
        s.pts = raw.map((r) => [R2(r[0]), R2(r[1])]);
      },
      up() {
        if (raw.length > 2) {
          const eps = (app.smoothing ? 1.6 : 0.5) / app.zoom;
          s.pts = rdp(raw, eps).map((r) => [R2(r[0]), R2(r[1])]);
          s.smooth = app.smoothing && s.pts.length > 2;
        }
        commitVector(before);
        recentColor(color);
      },
    };
  }
  if (tool === 'eraser') {
    let changed = false;
    const er = (q) => {
      for (let i = cel.shapes.length - 1; i >= 0; i--) {
        if (hit(cel.shapes[i], q.x, q.y, app.vectorSize / 2)) {
          app.vsel.delete(cel.shapes[i].id);
          cel.shapes.splice(i, 1);
          changed = true;
        }
      }
    };
    er(p);
    return { move: er, up: () => changed && commitVector(before) };
  }
  if (tool === 'bucket') {
    for (let i = cel.shapes.length - 1; i >= 0; i--) {
      const s = cel.shapes[i];
      if (s.img || s.pts.length < 3) continue;
      if (hctx.isPointInPath(shapePath(s), p.x, p.y)) {
        s.fill = color;
        commitVector(before);
        recentColor(color);
        return null;
      }
    }
    toast('Clique à l’intérieur d’une forme pour la remplir 🪣');
    return null;
  }
  // ligne / rectangle / ellipse
  p = { x: snapV(p.x), y: snapV(p.y) };
  const s = {
    id: newId(), pts: [], smooth: tool === 'ellipse', closed: tool !== 'line',
    stroke: color, width: app.vectorSize, fill: app.fillShapes && tool !== 'line' ? app.color2 : null,
  };
  cel.shapes.push(s);
  const upd = (q, ev) => {
    let ex = snapV(q.x), ey = snapV(q.y);
    if (ev.shiftKey) [ex, ey] = constrain(tool, p.x, p.y, ex, ey);
    s.pts = vectorShapePts(tool, p.x, p.y, ex, ey).map((r) => [R2(r[0]), R2(r[1])]);
  };
  upd(p, e);
  return {
    move: upd,
    up(q) {
      if (Math.hypot(q.x - p.x, q.y - p.y) * app.zoom < 2) {
        cel.shapes = before;
        return;
      }
      commitVector(before);
      recentColor(color);
    },
  };
}

function vectorSelectDown(p, e) {
  const cel = vcel();
  const tol = 5 / app.zoom;
  // poignée d'un point (une seule forme sélectionnée)
  if (app.vsel.size === 1) {
    const s = cel.shapes.find((sh) => app.vsel.has(sh.id));
    if (s && !s.img) {
      const ni = s.pts.findIndex((q) => Math.hypot(q[0] - p.x, q[1] - p.y) <= 7 / app.zoom);
      if (ni >= 0) {
        if (!editable()) return null;
        const before = structuredClone(cel.shapes);
        return {
          move(q) {
            s.pts[ni] = [R2(snapV(q.x)), R2(snapV(q.y))];
          },
          up: () => commitVector(before),
        };
      }
    }
  }
  const h = topHit(cel.shapes, p.x, p.y, tol);
  if (h) {
    if (e.shiftKey) {
      if (app.vsel.has(h.id)) {
        app.vsel.delete(h.id);
        refreshUI();
        return null;
      }
      app.vsel.add(h.id);
    } else if (!app.vsel.has(h.id)) {
      app.vsel.clear();
      app.vsel.add(h.id);
    }
    refreshUI();
    if (curLayer().locked) return null;
    const before = structuredClone(cel.shapes);
    const sel = cel.shapes.filter((s) => app.vsel.has(s.id));
    const orig = sel.map((s) => s.pts.map((q) => [...q]));
    let moved = false;
    return {
      move(q) {
        const dx = snapV(q.x - p.x), dy = snapV(q.y - p.y);
        moved = true;
        sel.forEach((s, i) => (s.pts = orig[i].map((r) => [R2(r[0] + dx), R2(r[1] + dy)])));
      },
      up: () => moved && commitVector(before),
    };
  }
  if (!e.shiftKey) app.vsel.clear();
  app.marquee = { x: p.x, y: p.y, w: 0, h: 0 };
  refreshUI();
  return {
    move(q) {
      app.marquee = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
    },
    up() {
      const m = app.marquee;
      app.marquee = null;
      if (m && (m.w > 0 || m.h > 0)) {
        for (const s of cel.shapes) {
          const b = bbox(s);
          if (b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y) app.vsel.add(s.id);
        }
      }
      refreshUI();
    },
  };
}

export function applyToSelection(prop, value) {
  if (app.mode !== 'vector' || app.tool !== 'select' || !app.vsel.size || curLayer().locked) return;
  const cel = vcel();
  const before = structuredClone(cel.shapes);
  for (const s of cel.shapes) if (app.vsel.has(s.id) && !s.img) s[prop] = value;
  commitVector(before);
  requestRender();
}

export function nudge(dx, dy) {
  if (app.mode === 'pixel') {
    if (!app.sel) return false;
    if (!app.floating) {
      if (!editable()) return true;
      lift();
    }
    app.floating.x += dx;
    app.floating.y += dy;
    app.sel = floatRect(app.floating);
    requestRender();
    return true;
  }
  if (!app.vsel.size) return false;
  if (!editable()) return true;
  const cel = vcel();
  const before = structuredClone(cel.shapes);
  for (const s of cel.shapes) if (app.vsel.has(s.id)) s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
  commitVector(before);
  requestRender();
  return true;
}

// ================================================================ Édition (copier, coller…)
export function copySel(silent = false) {
  if (app.mode === 'pixel') {
    let c;
    if (app.floating) c = cloneCanvas(app.floating.canvas);
    else if (app.sel) {
      c = makeCanvas(app.sel.w, app.sel.h);
      ctx2d(c).drawImage(celCtx().canvas, -app.sel.x, -app.sel.y);
    } else {
      toast('Rien de sélectionné (outil Sélection, touche M)');
      return false;
    }
    app.clipboard = { mode: 'pixel', canvas: c };
  } else {
    const sh = selectedShapes();
    if (!sh.length) {
      toast('Rien de sélectionné (outil Sélection, touche M)');
      return false;
    }
    app.clipboard = { mode: 'vector', shapes: structuredClone(sh) };
  }
  if (!silent) toast('Copié 📋');
  return true;
}

export function deleteSel() {
  if (app.mode === 'pixel') {
    if (app.floating) {
      const f = app.floating;
      app.floating = null;
      commitPixel(f.before, f.layerId, f.frameId);
      app.sel = null;
    } else if (app.sel) {
      if (!editable()) return;
      const ctx = celCtx();
      const before = ctx.getImageData(0, 0, W(), H());
      ctx.clearRect(app.sel.x, app.sel.y, app.sel.w, app.sel.h);
      commitPixel(before);
    }
  } else if (app.vsel.size) {
    if (!editable()) return;
    const cel = vcel();
    const before = structuredClone(cel.shapes);
    cel.shapes = cel.shapes.filter((s) => !app.vsel.has(s.id));
    app.vsel.clear();
    commitVector(before);
  }
  requestRender();
}

export function cutSel() {
  if (copySel(true)) {
    deleteSel();
    toast('Coupé ✂️');
  }
}

export function paste() {
  const cb = app.clipboard;
  if (!cb) return toast('Le presse-papiers est vide');
  if (cb.mode !== app.mode) return toast('Impossible de coller entre un projet Dessin et un projet Pixel');
  if (!editable()) return;
  if (app.mode === 'pixel') {
    commitFloating();
    const ctx = celCtx();
    const before = ctx.getImageData(0, 0, W(), H());
    const x = app.sel ? app.sel.x : 0, y = app.sel ? app.sel.y : 0;
    app.floating = { canvas: cloneCanvas(cb.canvas), x, y, before, layerId: curLayer().id, frameId: curFrame().id };
    app.sel = floatRect(app.floating);
  } else {
    const cel = vcel();
    const before = structuredClone(cel.shapes);
    const copies = cb.shapes.map((s) => ({ ...structuredClone(s), id: newId(), pts: s.pts.map(([x, y]) => [x + 10, y + 10]) }));
    cb.shapes = structuredClone(copies);
    cel.shapes.push(...copies);
    app.vsel = new Set(copies.map((s) => s.id));
    commitVector(before);
  }
  setTool('select');
  requestRender();
  refreshUI();
}

export function selectAll() {
  if (app.mode === 'pixel') {
    commitFloating();
    app.sel = { x: 0, y: 0, w: W(), h: H() };
  } else app.vsel = new Set(vcel().shapes.map((s) => s.id));
  setTool('select');
  requestRender();
  refreshUI();
}

export function deselect() {
  commitFloating();
  app.sel = null;
  app.vsel.clear();
  requestRender();
  refreshUI();
}

export function transform(kind) {
  if (!editable()) return;
  if (app.mode === 'pixel') {
    if (app.sel && !app.floating) lift();
    const rot = kind === 'rotCW' || kind === 'rotCCW';
    const apply = (x, w, h) => {
      if (kind === 'flipH') { x.translate(w, 0); x.scale(-1, 1); }
      else if (kind === 'flipV') { x.translate(0, h); x.scale(1, -1); }
    };
    if (app.floating) {
      const f = app.floating;
      const c = f.canvas;
      const n = rot ? makeCanvas(c.height, c.width) : makeCanvas(c.width, c.height);
      const x = ctx2d(n);
      if (kind === 'rotCW') { x.translate(n.width, 0); x.rotate(Math.PI / 2); }
      else if (kind === 'rotCCW') { x.translate(0, n.height); x.rotate(-Math.PI / 2); }
      else apply(x, c.width, c.height);
      x.drawImage(c, 0, 0);
      if (rot) {
        f.x += Math.floor((c.width - c.height) / 2);
        f.y += Math.floor((c.height - c.width) / 2);
      }
      f.canvas = n;
      app.sel = floatRect(f);
    } else {
      const ctx = celCtx();
      const before = ctx.getImageData(0, 0, W(), H());
      const tmp = cloneCanvas(ctx.canvas);
      ctx.clearRect(0, 0, W(), H());
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (rot) {
        ctx.translate(Math.floor(W() / 2), Math.floor(H() / 2));
        ctx.rotate(kind === 'rotCW' ? Math.PI / 2 : -Math.PI / 2);
        ctx.translate(-Math.floor(W() / 2), -Math.floor(H() / 2));
      } else apply(ctx, W(), H());
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
      commitPixel(before);
    }
    requestRender();
    return;
  }
  const cel = vcel();
  let targets = cel.shapes.filter((s) => app.vsel.has(s.id));
  let cx = app.doc.width / 2, cy = app.doc.height / 2;
  if (targets.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of targets) {
      const b = bbox(s);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
  } else targets = cel.shapes;
  if (!targets.length) return toast('Rien à transformer sur cette frame');
  const before = structuredClone(cel.shapes);
  const f = {
    flipH: ([x, y]) => [2 * cx - x, y],
    flipV: ([x, y]) => [x, 2 * cy - y],
    rotCW: ([x, y]) => [cx - (y - cy), cy + (x - cx)],
    rotCCW: ([x, y]) => [cx + (y - cy), cy - (x - cx)],
  }[kind];
  for (const s of targets) s.pts = s.pts.map((q) => f(q).map(R2));
  commitVector(before);
  requestRender();
}

// ================================================================ Superposition (curseur, sélection…)
function ants(ctx, x, y, w, h) {
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#000';
  ctx.lineDashOffset = 0;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineDashOffset = 4;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

export function drawToolOverlay(ctx, z, ox, oy) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const X = (v) => ox + v * z, Y = (v) => oy + v * z;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f8cff';
  if (app.mode === 'pixel') {
    if (app.sel) ants(ctx, Math.round(X(app.sel.x)) + 0.5, Math.round(Y(app.sel.y)) + 0.5, Math.round(app.sel.w * z) - 1, Math.round(app.sel.h * z) - 1);
    if (app.hover && !app.playing && app.tool !== 'select' && app.tool !== 'picker') {
      const s = app.tool === 'bucket' ? 1 : app.pixelSize;
      const o = Math.floor((s - 1) / 2);
      const hx = Math.floor(app.hover.x) - o, hy = Math.floor(app.hover.y) - o;
      const rx = Math.round(X(hx)) + 0.5, ry = Math.round(Y(hy)) + 0.5, rw = Math.round(s * z) - 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeRect(rx - 1, ry - 1, rw + 2, rw + 2);
      ctx.strokeStyle = app.tool === 'eraser' ? '#fff' : accent;
      ctx.strokeRect(rx, ry, rw, rw);
    }
    return;
  }
  const cel = app.doc.cels.get(app.doc.key(curLayer().id, curFrame().id));
  if (cel && app.vsel.size) {
    const sel = cel.shapes.filter((s) => app.vsel.has(s.id));
    ctx.lineWidth = 1;
    for (const s of sel) {
      const b = bbox(s);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = accent;
      ctx.strokeRect(Math.round(X(b.x)) + 0.5, Math.round(Y(b.y)) + 0.5, Math.round(b.w * z), Math.round(b.h * z));
      ctx.setLineDash([]);
    }
    if (sel.length === 1 && !sel[0].img) {
      for (const [x, y] of sel[0].pts) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(Math.round(X(x)) - 4, Math.round(Y(y)) - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  if (app.marquee) {
    const m = app.marquee;
    ctx.fillStyle = 'rgba(47,140,255,.08)';
    ctx.fillRect(X(m.x), Y(m.y), m.w * z, m.h * z);
    ants(ctx, Math.round(X(m.x)) + 0.5, Math.round(Y(m.y)) + 0.5, Math.round(m.w * z), Math.round(m.h * z));
  }
  if (app.hover && !app.playing && (app.tool === 'brush' || app.tool === 'eraser')) {
    const r = Math.max(1.5, (app.vectorSize / 2) * z);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.arc(X(app.hover.x), Y(app.hover.y), r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = app.tool === 'eraser' ? '#fff' : accent;
    ctx.beginPath();
    ctx.arc(X(app.hover.x), Y(app.hover.y), r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

