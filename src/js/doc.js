import { makeCanvas, ctx2d, loadImage } from './util.js';

let counter = 0;
export const newId = () =>
  Date.now().toString(36).slice(-4) + (counter++).toString(36) + Math.random().toString(36).slice(2, 5);

export class Doc {
  constructor(mode, width, height, fps = 12) {
    this.mode = mode;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.layers = []; // index 0 = calque du bas
    this.frames = [];
    this.cels = new Map(); // "layerId:frameId" -> canvas (pixel) | {shapes} (vectoriel)
    this.flags = new Map(); // pixel : la cel contient-elle quelque chose ?
  }

  static create(mode, w, h, fps) {
    const d = new Doc(mode, w, h, fps);
    d.layers.push(d.makeLayer('Calque 1'));
    d.frames.push(d.makeFrame());
    return d;
  }

  makeLayer(name) {
    return { id: newId(), name, visible: true, locked: false, opacity: 1 };
  }
  makeFrame(duration = null) {
    return { id: newId(), duration };
  }
  key(l, f) {
    return l + ':' + f;
  }
  newCel() {
    return this.mode === 'pixel' ? makeCanvas(this.width, this.height) : { shapes: [] };
  }
  getCel(l, f, create = true) {
    const k = this.key(l, f);
    let c = this.cels.get(k);
    if (!c && create) {
      c = this.newCel();
      this.cels.set(k, c);
    }
    return c;
  }
  copyCel(c) {
    if (this.mode === 'pixel') {
      const n = makeCanvas(c.width, c.height);
      ctx2d(n).drawImage(c, 0, 0);
      return n;
    }
    return { shapes: structuredClone(c.shapes) };
  }
  hasContent(l, f) {
    const k = this.key(l, f);
    if (this.mode === 'pixel') return !!this.flags.get(k);
    const c = this.cels.get(k);
    return !!(c && c.shapes.length);
  }
  updateFlag(l, f) {
    if (this.mode !== 'pixel') return;
    const k = this.key(l, f);
    const c = this.cels.get(k);
    if (!c) return this.flags.delete(k);
    const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
    let any = false;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { any = true; break; }
    this.flags.set(k, any);
  }
  updateAllFlags() {
    for (const k of this.cels.keys()) {
      const [l, f] = k.split(':');
      this.updateFlag(l, f);
    }
  }
  getCelData(l, f) {
    const c = this.getCel(l, f);
    return this.mode === 'pixel' ? ctx2d(c).getImageData(0, 0, c.width, c.height) : structuredClone(c.shapes);
  }
  setCelData(l, f, data) {
    const c = this.getCel(l, f);
    if (this.mode === 'pixel') {
      ctx2d(c).putImageData(data, 0, 0);
      this.updateFlag(l, f);
    } else c.shapes = structuredClone(data);
  }
  removeCels({ layerId, frameId }) {
    for (const k of [...this.cels.keys()]) {
      const [l, f] = k.split(':');
      if (l === layerId || f === frameId) {
        this.cels.delete(k);
        this.flags.delete(k);
      }
    }
  }
  duration(i) {
    return this.frames[i]?.duration || 1000 / this.fps;
  }

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      fps: this.fps,
      layers: structuredClone(this.layers),
      frames: structuredClone(this.frames),
      cels: new Map([...this.cels].map(([k, c]) => [k, this.copyCel(c)])),
      flags: new Map(this.flags),
    };
  }
  restore(s) {
    this.width = s.width;
    this.height = s.height;
    this.fps = s.fps;
    this.layers = structuredClone(s.layers);
    this.frames = structuredClone(s.frames);
    this.cels = new Map([...s.cels].map(([k, c]) => [k, this.copyCel(c)]));
    this.flags = new Map(s.flags);
  }

  resize(w, h, anchor = 'center') {
    const ox = anchor === 'center' ? Math.round((w - this.width) / 2) : 0;
    const oy = anchor === 'center' ? Math.round((h - this.height) / 2) : 0;
    for (const [k, c] of this.cels) {
      if (this.mode === 'pixel') {
        const n = makeCanvas(w, h);
        ctx2d(n).drawImage(c, ox, oy);
        this.cels.set(k, n);
      } else {
        for (const s of c.shapes) s.pts = s.pts.map(([x, y]) => [x + ox, y + oy]);
      }
    }
    this.width = w;
    this.height = h;
    this.updateAllFlags();
  }

  serialize() {
    const cels = {};
    for (const [k, c] of this.cels) {
      if (this.mode === 'pixel') {
        if (this.flags.get(k)) cels[k] = c.toDataURL('image/png');
      } else if (c.shapes.length) cels[k] = c.shapes;
    }
    return {
      app: 'animotion',
      version: 1,
      mode: this.mode,
      width: this.width,
      height: this.height,
      fps: this.fps,
      layers: this.layers,
      frames: this.frames,
      cels,
    };
  }

  /**
   * Charge un projet .animo. Le chargement est tolérant pour qu'un humain ou une IA puisse écrire le fichier à la main :
   * - champs manquants = valeurs par défaut
   * - clés de cels "calque:frame" avec les ids OU les numéros (0, 1, 2…)
   * - pixel : image PNG (data URL) ou texte { rows: ["..##.."], palette: { "#": "#ff0000" } }
   * - dessin : formes { pts: [[x,y]…] } ou simples { type: "rect"|"ellipse"|"circle"|"line"|"path", … }
   */
  static async load(o) {
    if (!o || o.app !== 'animotion') throw new Error("Ce fichier n'est pas un projet Animotion (il manque \"app\": \"animotion\")");
    const mode = o.mode === 'vector' || o.mode === 'dessin' ? 'vector' : 'pixel';
    const num = (v, def, min, max) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(min, Math.min(max, Math.round(+v))) : def);
    const d = new Doc(mode, num(o.width, mode === 'pixel' ? 32 : 800, 1, 8192), num(o.height, mode === 'pixel' ? 32 : 600, 1, 8192), num(o.fps, 12, 1, 60));
    const layers = Array.isArray(o.layers) && o.layers.length ? o.layers : [{}];
    d.layers = layers.map((l, i) => ({
      id: String(l.id ?? 'calque' + (i + 1)).replace(/:/g, '_'),
      name: String(l.name ?? 'Calque ' + (i + 1)),
      visible: l.visible !== false,
      locked: !!l.locked,
      opacity: Math.max(0, Math.min(1, Number.isFinite(+l.opacity) && l.opacity !== null ? +l.opacity : 1)),
    }));
    const frames = Array.isArray(o.frames) && o.frames.length ? o.frames : typeof o.frames === 'number' ? Array.from({ length: o.frames }, () => ({})) : [{}];
    d.frames = frames.map((f, i) => ({
      id: String(f?.id ?? 'f' + (i + 1)).replace(/:/g, '_'),
      duration: Number.isFinite(+f?.duration) && f?.duration ? Math.max(10, Math.round(+f.duration)) : null,
    }));
    // "calque:frame" -> clé interne (accepte les ids ou les numéros)
    const resolve = (key) => {
      const [lk, fk] = String(key).split(':');
      const l = d.layers.find((x) => x.id === lk) || (/^\d+$/.test(lk) ? d.layers[+lk] : null);
      const f = d.frames.find((x) => x.id === fk) || (/^\d+$/.test(fk) ? d.frames[+fk] : null);
      return l && f ? d.key(l.id, f.id) : null;
    };
    for (const [k, v] of Object.entries(o.cels || {})) {
      const key = resolve(k);
      if (!key || v == null) continue;
      if (mode === 'pixel') {
        const c = makeCanvas(d.width, d.height);
        if (typeof v === 'string') ctx2d(c).drawImage(await loadImage(v), 0, 0);
        else drawRows(ctx2d(c), Array.isArray(v) ? { rows: v } : v, o.palette);
        d.cels.set(key, c);
        d.flags.set(key, true);
      } else {
        const list = Array.isArray(v) ? v : Array.isArray(v.shapes) ? v.shapes : [];
        d.cels.set(key, { shapes: list.map(normalizeShape).filter(Boolean) });
      }
    }
    d.updateAllFlags();
    return d;
  }
}

// ---------------------------------------------------------- Aides au chargement « écrit à la main »
const CLEAR = new Set(['.', ' ', '_', '-', '0']);
export function drawRows(ctx, cel, globalPal) {
  const pal = { ...(globalPal || {}), ...(cel.palette || {}) };
  const ox = Math.round(+cel.x || 0), oy = Math.round(+cel.y || 0);
  (cel.rows || []).forEach((row, y) => {
    const cells = typeof row === 'string' ? [...row] : Array.isArray(row) ? row : [];
    cells.forEach((ch, x) => {
      const key = String(ch);
      let col = Object.prototype.hasOwnProperty.call(pal, key) ? pal[key] : CLEAR.has(key) ? null : '#ff00ff'; // magenta = caractère sans couleur
      if (!col) return;
      if (col === 'transparent') return ctx.clearRect(ox + x, oy + y, 1, 1);
      ctx.fillStyle = col;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    });
  });
}

function ellipsePts(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export function normalizeShape(s) {
  if (!s || typeof s !== 'object') return null;
  const n = (v, def = 0) => (Number.isFinite(+v) ? +v : def);
  let pts = Array.isArray(s.pts) ? s.pts : Array.isArray(s.points) ? s.points : null;
  let closed = !!s.closed, smooth = !!s.smooth;
  switch (s.type) {
    case 'rect': {
      const x = n(s.x), y = n(s.y), w = n(s.w ?? s.width, 10), h = n(s.h ?? s.height, 10);
      pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      closed = true; smooth = false;
      break;
    }
    case 'circle':
    case 'ellipse':
      pts = ellipsePts(n(s.cx), n(s.cy), n(s.rx ?? s.r, 10), n(s.ry ?? s.r, 10));
      closed = true; smooth = true;
      break;
    case 'line':
      pts = [[n(s.x1), n(s.y1)], [n(s.x2), n(s.y2)]];
      closed = false; smooth = false;
      break;
    case 'polygon':
      closed = true;
      break;
    case 'path':
    default:
      if (s.smooth === undefined && pts && pts.length > 2) smooth = true;
  }
  if (!pts || !pts.length) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  pts = pts.map((p) => (Array.isArray(p) ? [r2(n(p[0])), r2(n(p[1]))] : [r2(n(p.x)), r2(n(p.y))]));
  const filled = s.fill && s.fill !== 'none' && s.fill !== 'transparent' ? s.fill : null;
  return {
    id: s.id ? String(s.id) : newId(),
    pts, smooth, closed,
    stroke: s.stroke === null || s.stroke === 'none' ? null : s.stroke || (filled ? null : '#000000'),
    // épaisseur du trait : strokeWidth (pour rect, « width » désigne la largeur du rectangle)
    width: n(s.strokeWidth ?? (s.type === 'rect' ? undefined : s.width), 3),
    fill: filled,
  };
}
