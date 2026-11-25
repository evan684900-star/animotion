import { app, store } from './state.js';
import { compositeFrame } from './render.js';
import { encodeGIF } from './gif.js';
import { makeZip } from './zip.js';
import { saveFile } from './platform.js';
import { progress, toast } from './dialogs.js';
import { commitFloating } from './tools.js';
import { canvasToBytes, makeCanvas, sleep } from './util.js';

export const baseName = () => (app.fileName && app.fileName !== 'Sans titre' ? app.fileName : 'animation').replace(/[\\/:*?"<>|]/g, '_');

/** Options d'export par défaut (celles de la fenêtre d'export, mémorisées) */
export function exportOptions(over = {}) {
  const d = app.doc;
  const saved = store('exportOpts') || {};
  const o = {
    scale: app.render.scale,
    transparent: app.render.transparent,
    bg: app.render.bg,
    loop: app.render.gifLoop,
    speed: 1,
    repeat: 1,
    cols: 0,
    padding: 0,
    json: false,
    prefix: baseName(),
    ...saved,
    from: 0,
    to: d.frames.length - 1,
    frame: app.frameIndex,
    ...over,
  };
  o.from = Math.max(0, Math.min(d.frames.length - 1, Math.round(o.from)));
  o.to = Math.max(o.from, Math.min(d.frames.length - 1, Math.round(o.to)));
  o.frame = Math.max(0, Math.min(d.frames.length - 1, Math.round(o.frame)));
  o.speed = o.speed > 0 ? o.speed : 1;
  return o;
}

const indices = (o) => Array.from({ length: o.to - o.from + 1 }, (_, k) => o.from + k);
const frameCanvas = (i, o, forceBg = null) => compositeFrame(app.doc, i, o.scale, forceBg || (o.transparent ? null : o.bg));
export const outSize = (o) => [Math.max(1, Math.round(app.doc.width * o.scale)), Math.max(1, Math.round(app.doc.height * o.scale))];

// Chemin imposé (ex. demandé par Claude) : pas de boîte de dialogue
let target = null, lastSaved = null, lastError = null;

async function save(bytes, name, label, ext) {
  const p = await saveFile(bytes, name, [{ name: label, extensions: [ext] }], target);
  lastSaved = p;
  if (p) toast(`Exporté : ${name} ✔`, 'ok');
  return p;
}

async function guarded(title, fn) {
  commitFloating();
  const pr = progress(title);
  try {
    return await fn(pr);
  } catch (err) {
    console.error(err);
    lastError = err;
    toast('Erreur pendant l’export : ' + (err.message || err), 'error', 6000);
  } finally {
    pr.close();
  }
}

/** Lance un export vers un chemin précis (sans dialogue). Renvoie le chemin écrit, ou lève l'erreur. */
export async function exportTo(path, fn) {
  target = path;
  lastSaved = null;
  lastError = null;
  try {
    await fn();
  } finally {
    target = null;
  }
  if (lastError) throw lastError;
  return lastSaved;
}

export function exportPNG(over = {}) {
  const o = exportOptions(over);
  return guarded('Export PNG', async () => {
    const bytes = await canvasToBytes(frameCanvas(o.frame, o));
    return save(bytes, `${o.prefix}_frame${o.frame + 1}.png`, 'Image PNG', 'png');
  });
}

export function exportGIF(over = {}) {
  const o = exportOptions(over);
  return guarded('Export GIF', async (pr) => {
    const d = app.doc;
    const list = indices(o);
    const frames = [];
    let w = 0, h = 0;
    for (const [k, i] of list.entries()) {
      const c = frameCanvas(i, o);
      w = c.width;
      h = c.height;
      frames.push({ data: c.getContext('2d').getImageData(0, 0, w, h).data, delay: d.duration(i) / o.speed });
      pr.set((k / list.length) * 0.25, `Préparation des frames… ${k + 1}/${list.length}`);
      await sleep(0);
    }
    const bytes = await encodeGIF(frames, w, h, {
      loop: o.loop,
      onProgress: (p) => pr.set(0.25 + p * 0.75, `Encodage du GIF… ${Math.round(p * 100)} %`),
    });
    return save(bytes, `${o.prefix}.gif`, 'GIF animé', 'gif');
  });
}

export function exportSequence(over = {}) {
  const o = exportOptions(over);
  return guarded('Export séquence PNG', async (pr) => {
    const list = indices(o);
    const files = [];
    for (const [k, i] of list.entries()) {
      files.push({ name: `${o.prefix}_${String(k + 1).padStart(4, '0')}.png`, data: await canvasToBytes(frameCanvas(i, o)) });
      pr.set((k + 1) / list.length, `Frame ${k + 1}/${list.length}`);
    }
    return save(makeZip(files), `${o.prefix}_frames.zip`, 'Archive ZIP', 'zip');
  });
}

export function sheetLayout(o) {
  const n = o.to - o.from + 1;
  const cols = o.cols > 0 ? Math.min(o.cols, n) : n <= 8 ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const [fw, fh] = outSize(o);
  const pad = Math.max(0, Math.round(o.padding));
  return { n, cols, rows, fw, fh, pad, w: cols * fw + (cols - 1) * pad, h: rows * fh + (rows - 1) * pad };
}

export function exportSpritesheet(over = {}) {
  const o = exportOptions(over);
  return guarded('Export spritesheet', async (pr) => {
    const L = sheetLayout(o);
    const sheet = makeCanvas(L.w, L.h);
    const ctx = sheet.getContext('2d');
    if (!o.transparent) {
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, L.w, L.h);
    }
    const meta = [];
    for (const [k, i] of indices(o).entries()) {
      const x = (k % L.cols) * (L.fw + L.pad), y = Math.floor(k / L.cols) * (L.fh + L.pad);
      ctx.drawImage(frameCanvas(i, o), x, y);
      meta.push({ frame: k, x, y, w: L.fw, h: L.fh, duration: Math.round(app.doc.duration(i) / o.speed) });
      pr.set((k + 1) / L.n);
    }
    const png = await canvasToBytes(sheet);
    if (!o.json) return save(png, `${o.prefix}_spritesheet.png`, 'Image PNG', 'png');
    // PNG + description JSON des positions (pour les moteurs de jeu), réunis dans un .zip
    const info = { image: `${o.prefix}_spritesheet.png`, size: { w: L.w, h: L.h }, frameSize: { w: L.fw, h: L.fh }, columns: L.cols, rows: L.rows, padding: L.pad, frames: meta };
    const files = [
      { name: info.image, data: png },
      { name: `${o.prefix}_spritesheet.json`, data: new TextEncoder().encode(JSON.stringify(info, null, 2)) },
    ];
    return save(makeZip(files), `${o.prefix}_spritesheet.zip`, 'Archive ZIP', 'zip');
  });
}

export const videoMime = (kind) =>
  window.MediaRecorder
    ? (kind === 'mp4'
        ? ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      ).find((t) => MediaRecorder.isTypeSupported(t))
    : null;

export function exportVideo(kind, over = {}) {
  const mime = videoMime(kind);
  if (!mime) {
    lastError = new Error(kind === 'mp4' ? 'MP4 non supporté sur ce système, essaie le WebM' : 'WebM non supporté ici');
    toast(lastError.message + ' 🙏', 'error', 4500);
    return Promise.resolve(null);
  }
  const o = exportOptions(over);
  return guarded(`Export vidéo ${kind.toUpperCase()}`, async (pr) => {
    const d = app.doc;
    let [w, h] = outSize(o);
    w += w % 2; // les vidéos veulent des dimensions paires
    h += h % 2;
    const fill = o.transparent ? '#000000' : o.bg;
    const list = indices(o);
    const frames = list.map((i) => frameCanvas(i, o, fill));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const stream = c.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const draw = (k) => {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(frames[k], 0, 0);
      track.requestFrame?.();
    };
    const repeat = Math.max(1, Math.min(50, Math.round(o.repeat)));
    const total = list.length * repeat;
    rec.start();
    for (let r = 0, step = 0; r < repeat; r++) {
      for (let k = 0; k < list.length; k++, step++) {
        draw(k);
        pr.set(step / total, `Enregistrement en temps réel… ${step + 1}/${total}`);
        await sleep(d.duration(list[k]) / o.speed);
      }
    }
    draw(list.length - 1);
    await sleep(50);
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    return save(new Uint8Array(await blob.arrayBuffer()), `${o.prefix}.${kind}`, `Vidéo ${kind.toUpperCase()}`, kind);
  });
}
