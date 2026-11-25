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

  static async load(o) {
    if (!o || o.app !== 'animotion') throw new Error("Ce fichier n'est pas un projet Animotion");
    const d = new Doc(o.mode === 'vector' ? 'vector' : 'pixel', o.width, o.height, o.fps || 12);
    d.layers = o.layers?.length ? o.layers : [d.makeLayer('Calque 1')];
    d.frames = o.frames?.length ? o.frames : [d.makeFrame()];
    for (const [k, v] of Object.entries(o.cels || {})) {
      if (d.mode === 'pixel') {
        const img = await loadImage(v);
        const c = makeCanvas(d.width, d.height);
        ctx2d(c).drawImage(img, 0, 0);
        d.cels.set(k, c);
        d.flags.set(k, true);
      } else d.cels.set(k, { shapes: v });
    }
    return d;
  }
}
