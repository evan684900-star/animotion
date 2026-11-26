// Mode Montage : import des médias (vidéo, audio, image, GIF animé, animation Animotion), miniatures, ondes sonores
import { M, mediaById, emitChange } from './model.js';
import { newId, Doc } from '../doc.js';
import { isTauri, readPath } from '../platform.js';
import { makeCanvas, ctx2d, loadImage, parseLooseJSON, bytesToDataURL } from '../util.js';
import { compositeFrame } from '../render.js';

const T = window.__TAURI__;
export const EXT = {
  video: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg', 'avif'],
  gif: ['gif'],
  anim: ['animo'],
};
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', gif: 'image/gif',
};
const ext = (name) => (String(name).split('.').pop() || '').toLowerCase();
export const kindOf = (name) => Object.keys(EXT).find((k) => EXT[k].includes(ext(name))) || null;
export const ALL_EXT = Object.values(EXT).flat();

const once = (el, ev, ms = 8000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('délai dépassé')), ms);
    el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); rej(new Error('fichier illisible')); }, { once: true });
  });

/** Ajoute un média au projet à partir de ses octets. file = { name, bytes, path } */
export async function addMedia(file, extra = {}) {
  const kind = extra.kind || kindOf(file.name);
  if (!kind) throw new Error(`format non pris en charge (${file.name})`);
  const entry = { id: newId(), kind, name: file.name, path: file.path || null, duration: 0, width: 0, height: 0, hasAudio: false, ...extra.entry };
  const rt = { bytes: file.bytes, thumbs: [] };
  M.media.set(entry.id, rt);
  await hydrate(entry, rt, file.bytes, extra.animo);
  // dans l'appli : on garde une copie des fichiers sans chemin (glisser-déposer, voix off, image figée…)
  if (isTauri && !entry.path && kind !== 'anim') {
    try { entry.path = await storeCopy(entry, file.bytes); } catch {}
  }
  M.project.media.push(entry);
  emitChange('media');
  return entry;
}

/** Ajoute l'animation Animotion ouverte (ou un projet .animo) comme média */
export async function addAnimation(obj, name) {
  return addMedia({ name: name || 'Animation', bytes: null }, { kind: 'anim', animo: obj });
}

async function storeCopy(entry, bytes) {
  const dir = await T.path.appDataDir();
  const safe = entry.name.replace(/[\\/:*?"<>|]/g, '_');
  const path = await T.path.join(dir, 'montage-medias', `${entry.id}_${safe}`);
  await T.core.invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
  return path;
}

/** Prépare un média en mémoire (adresse lisible, taille, durée, miniatures, onde) */
async function hydrate(entry, rt, bytes, animo) {
  const k = entry.kind;
  if (k === 'anim') {
    const obj = animo || entry.animo;
    if (!obj || obj.mode === 'montage') throw new Error('ce projet n’est pas une animation');
    entry.animo = obj;
    const doc = await Doc.load(obj);
    rt.doc = doc;
    rt.cum = [];
    let acc = 0;
    doc.frames.forEach((_, i) => { acc += doc.duration(i); rt.cum.push(acc); });
    rt.total = acc / 1000;
    rt.frameCache = new Map();
    entry.duration = rt.total;
    entry.width = doc.width;
    entry.height = doc.height;
    entry.pixel = doc.mode === 'pixel';
    const s = Math.max(1, Math.floor(96 / Math.max(doc.width, doc.height))) || 96 / Math.max(doc.width, doc.height);
    rt.thumbs = [{ t: 0, c: compositeFrame(doc, 0, doc.mode === 'pixel' ? s : Math.min(1, 96 / doc.width)) }];
    return;
  }
  rt.url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext(entry.name)] || '' }));
  if (k === 'image') {
    rt.img = await loadImage(rt.url);
    entry.width = rt.img.naturalWidth || rt.img.width;
    entry.height = rt.img.naturalHeight || rt.img.height;
    rt.thumbs = [{ t: 0, c: thumbOf(rt.img, entry.width, entry.height) }];
    return;
  }
  if (k === 'gif') {
    if ('ImageDecoder' in window) {
      try {
        const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
        await dec.tracks.ready;
        const n = Math.min(dec.tracks.selectedTrack.frameCount, 400);
        rt.frames = [];
        let acc = 0;
        for (let i = 0; i < n; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          const c = makeCanvas(image.displayWidth, image.displayHeight);
          c.getContext('2d').drawImage(image, 0, 0);
          const dur = (image.duration || 100000) / 1e6; // microsecondes -> secondes
          image.close();
          acc += Math.max(0.02, dur);
          rt.frames.push({ c, end: acc });
        }
        rt.total = acc;
        entry.duration = acc;
        entry.width = rt.frames[0].c.width;
        entry.height = rt.frames[0].c.height;
        rt.thumbs = [{ t: 0, c: thumbOf(rt.frames[0].c, entry.width, entry.height) }];
        return;
      } catch {}
    }
    // pas de décodeur d'animation : image fixe
    entry.kind = 'image';
    return hydrate(entry, rt, bytes);
  }
  if (k === 'video' || k === 'audio') {
    const el = document.createElement(k);
    el.preload = 'auto';
    el.muted = true;
    el.src = rt.url;
    await once(el, 'loadedmetadata');
    if (!Number.isFinite(el.duration)) {
      // fichier sans durée dans son en-tête (enregistrement du navigateur) : un saut tout au bout la fait calculer
      await new Promise((res) => {
        const t = setTimeout(res, 4000);
        el.addEventListener('durationchange', () => Number.isFinite(el.duration) && (clearTimeout(t), res()));
        el.currentTime = 1e9;
      });
      el.currentTime = 0;
    }
    entry.duration = Number.isFinite(el.duration) ? el.duration : 0;
    if (k === 'video') {
      entry.width = el.videoWidth;
      entry.height = el.videoHeight;
      makeThumbs(entry, rt, el).catch(() => {});
    }
    makePeaks(entry, rt, bytes).then((ok) => {
      if (k === 'video') entry.hasAudio = ok;
      emitChange('media');
    });
    if (k === 'audio') entry.hasAudio = true;
  }
}

function thumbOf(src, w, h, H = 54) {
  const c = makeCanvas(Math.max(1, Math.round((w / h) * H)), H);
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function makeThumbs(entry, rt, el) {
  if (el.readyState < 2) await once(el, 'loadeddata');
  const n = Math.max(1, Math.min(24, Math.ceil(entry.duration / 2)));
  for (let i = 0; i < n; i++) {
    const t = (entry.duration * (i + 0.5)) / n;
    el.currentTime = t;
    try { await once(el, 'seeked', 4000); } catch { break; }
    rt.thumbs.push({ t, c: thumbOf(el, entry.width, entry.height) });
    if (i === 0 || i === n - 1) emitChange('media');
  }
  el.removeAttribute('src');
  el.load();
}

async function makePeaks(entry, rt, bytes) {
  try {
    const ac = new OfflineAudioContext(1, 44100, 44100);
    const buf = await ac.decodeAudioData(bytes.slice().buffer);
    const rate = 60; // pics par seconde
    const ch = buf.getChannelData(0);
    const per = Math.max(1, Math.floor(buf.sampleRate / rate));
    const data = new Float32Array(Math.ceil(ch.length / per));
    for (let i = 0; i < data.length; i++) {
      let m = 0;
      for (let j = i * per, e = Math.min(ch.length, j + per); j < e; j++) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      data[i] = m;
    }
    rt.peaks = { rate, data };
    if (!entry.duration) entry.duration = buf.duration;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------- frames d'une animation / d'un GIF
/** Canvas de la frame d'animation au temps t (secondes, déjà décalé par in/vitesse), mis en cache */
export function animFrame(entry, rt, t, W, H, loop = true) {
  if (!rt?.doc) return null;
  const total = rt.total || 0.001;
  let ms = (loop ? ((t % total) + total) % total : Math.min(t, total - 0.0001)) * 1000;
  let fi = rt.cum.findIndex((c) => ms < c);
  if (fi < 0) fi = rt.cum.length - 1;
  const d = rt.doc;
  const fit = Math.min(W / d.width, H / d.height);
  const s = d.mode === 'pixel' ? Math.max(1, Math.floor(fit)) : Math.min(fit, 4);
  const key = fi + '|' + s;
  let c = rt.frameCache.get(key);
  if (!c) {
    c = compositeFrame(d, fi, s);
    if (rt.frameCache.size > 400) rt.frameCache.clear();
    rt.frameCache.set(key, c);
  }
  return c;
}
export function gifFrame(rt, t, loop = true) {
  if (!rt?.frames?.length) return null;
  const total = rt.total;
  const x = loop ? ((t % total) + total) % total : Math.min(t, total - 0.0001);
  return (rt.frames.find((f) => x < f.end) || rt.frames[rt.frames.length - 1]).c;
}

// ---------------------------------------------------------- ouverture / enregistrement d'un projet
export async function loadProjectMedia(project, onProgress) {
  let i = 0;
  for (const entry of project.media) {
    onProgress?.(i++ / Math.max(1, project.media.length), entry.name);
    const rt = { thumbs: [] };
    M.media.set(entry.id, rt);
    try {
      if (entry.kind === 'anim') {
        await hydrate(entry, rt, null);
        continue;
      }
      let bytes = null;
      if (entry.data) bytes = new Uint8Array(await (await fetch(entry.data)).arrayBuffer());
      else if (entry.path && isTauri) bytes = (await readPath(entry.path)).bytes;
      if (!bytes) throw new Error('introuvable');
      rt.bytes = bytes;
      await hydrate(entry, rt, bytes);
    } catch {
      rt.missing = true;
    }
  }
}

/** Projet prêt à être écrit dans un fichier (dans le navigateur, les médias sans chemin sont intégrés) */
export async function serializeProject() {
  const p = structuredClone(M.project);
  let embedded = 0;
  for (const m of p.media) {
    delete m.data;
    if (m.kind === 'anim' || m.path) continue;
    const rt = M.media.get(m.id);
    if (rt?.bytes && embedded + rt.bytes.length < 60e6) {
      m.data = await bytesToDataURL(rt.bytes, MIME[ext(m.name)] || 'application/octet-stream');
      embedded += rt.bytes.length;
    }
  }
  return p;
}

export const isMissing = (id) => !!M.media.get(id)?.missing;
export const runtime = (id) => M.media.get(id);
export { mediaById };
export const parseAnimo = (bytes) => parseLooseJSON(new TextDecoder().decode(bytes));
