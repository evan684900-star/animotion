export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c) {
  return c.getContext('2d', { willReadFrequently: true });
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hexToRgba(hex) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function normalizeHex(v) {
  let h = String(v || '').trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return '#' + h.toLowerCase();
}

export function canvasToBytes(c, type = 'image/png') {
  return new Promise((res, rej) =>
    c.toBlob(async (b) => {
      if (!b) return rej(new Error('Image vide'));
      res(new Uint8Array(await b.arrayBuffer()));
    }, type)
  );
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Impossible de lire l'image"));
    i.src = src;
  });
}

export function bytesToDataURL(bytes, mime) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}

export function mimeFromName(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[ext] || 'application/octet-stream';
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function baseName(path) {
  return String(path).split(/[\\/]/).pop();
}

export function cloneCanvas(c) {
  const n = makeCanvas(c.width, c.height);
  ctx2d(n).drawImage(c, 0, 0);
  return n;
}

/**
 * JSON « tolérant » : accepte les blocs ```json, les commentaires (// et bloc) et les virgules en trop
 * (ce qu'une IA ou un humain écrit souvent à la main).
 */
export function parseLooseJSON(text) {
  let t = String(text).trim().replace(/^﻿/, '');
  const fence = t.match(/```(?:json|animo)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  try {
    return JSON.parse(t);
  } catch {}
  let out = '', inStr = false, q = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') out += t[++i] ?? '';
      else if (c === q) inStr = false;
    } else if (c === '"') {
      inStr = true;
      q = c;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < t.length && t[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  const start = out.indexOf('{'), end = out.lastIndexOf('}');
  if (start > 0 || (end >= 0 && end < out.length - 1)) out = out.slice(start, end + 1);
  return JSON.parse(out);
}
