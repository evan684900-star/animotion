// Encodeur GIF animé fait maison (palette globale + LZW)
import { sleep } from './util.js';

function medianCut(colors, k) {
  // colors: [{r,g,b,n}]
  let boxes = [colors];
  while (boxes.length < k) {
    let best = -1, bestScore = -1, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      let mn = [255, 255, 255], mx = [0, 0, 0], cnt = 0;
      for (const c of b) {
        const v = [c.r, c.g, c.b];
        for (let j = 0; j < 3; j++) {
          if (v[j] < mn[j]) mn[j] = v[j];
          if (v[j] > mx[j]) mx[j] = v[j];
        }
        cnt += c.n;
      }
      const ranges = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      const ch = ranges.indexOf(Math.max(...ranges));
      const score = ranges[ch] * Math.sqrt(cnt);
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestCh = ch;
      }
    });
    if (best < 0 || bestScore <= 0) break;
    const key = ['r', 'g', 'b'][bestCh];
    const b = boxes[best].sort((x, y) => x[key] - y[key]);
    const total = b.reduce((s, c) => s + c.n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) {
      acc += b[i].n;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const c of b) {
      r += c.r * c.n;
      g += c.g * c.n;
      bl += c.b * c.n;
      n += c.n;
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
}

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();
  const out = [];
  let cur = 0, bits = 0;
  const emit = (code) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const v = dict.get(key);
    if (v !== undefined) {
      prefix = v;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

/** frames: [{ data: Uint8ClampedArray RGBA, delay: ms }] */
export async function encodeGIF(frames, w, h, { loop = true, onProgress } = {}) {
  // 1. Histogramme des couleurs
  const hist = new Map();
  let transparent = false;
  const total = w * h * frames.length;
  const stride = total > 4e6 ? Math.ceil(total / 4e6) : 1;
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * stride) {
      if (d[i + 3] < 128) {
        transparent = true;
        continue;
      }
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  const maxColors = transparent ? 255 : 256;
  let palette;
  if (hist.size <= maxColors) palette = [...hist.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  else palette = medianCut([...hist].map(([k, n]) => ({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255, n })), maxColors);
  if (!palette.length) palette.push([0, 0, 0]);
  const transIndex = transparent ? palette.length : -1;
  if (transparent) palette.push([0, 0, 0]);
  let bitsPer = 1;
  while (1 << bitsPer < palette.length) bitsPer++;
  const tableSize = 1 << bitsPer;
  const minCode = Math.max(2, bitsPer);

  // 2. En-têtes
  const out = [];
  const push16 = (v) => out.push(v & 255, (v >> 8) & 255);
  for (const c of 'GIF89a') out.push(c.charCodeAt(0));
  push16(w);
  push16(h);
  out.push(0x80 | ((bitsPer - 1) << 4) | (bitsPer - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] || [0, 0, 0];
    out.push(c[0], c[1], c[2]);
  }
  if (loop) {
    out.push(0x21, 0xff, 0x0b);
    for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0));
    out.push(0x03, 0x01, 0, 0, 0);
  }

  // 3. Frames
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx !== undefined) return idx;
    let best = 0, bd = Infinity;
    const n = transparent ? palette.length - 1 : palette.length;
    for (let i = 0; i < n; i++) {
      const p = palette[i];
      const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (dist < bd) {
        bd = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    cache.set(key, best);
    return best;
  };

  for (let fi = 0; fi < frames.length; fi++) {
    const { data, delay } = frames[fi];
    const idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < idx.length; i += 4, p++) {
      idx[p] = data[i + 3] < 128 ? transIndex : nearest(data[i], data[i + 1], data[i + 2]);
    }
    const cs = Math.max(2, Math.round(delay / 10));
    out.push(0x21, 0xf9, 0x04, (transparent ? 2 << 2 : 1 << 2) | (transparent ? 1 : 0));
    push16(cs);
    out.push(transparent ? transIndex : 0, 0);
    out.push(0x2c);
    push16(0);
    push16(0);
    push16(w);
    push16(h);
    out.push(0);
    out.push(minCode);
    const data2 = lzw(idx, minCode);
    for (let i = 0; i < data2.length; i += 255) {
      const chunk = data2.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
    onProgress?.((fi + 1) / frames.length);
    await sleep(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
