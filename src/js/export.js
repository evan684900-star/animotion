import { app } from './state.js';
import { compositeFrame } from './render.js';
import { encodeGIF } from './gif.js';
import { makeZip } from './zip.js';
import { saveFile } from './platform.js';
import { progress, toast } from './dialogs.js';
import { commitFloating } from './tools.js';
import { canvasToBytes, makeCanvas, sleep } from './util.js';

const base = () => (app.fileName && app.fileName !== 'Sans titre' ? app.fileName : 'animation');
const bg = () => (app.render.transparent ? null : app.render.bg);
const frameCanvas = (i, forceBg = null) => compositeFrame(app.doc, i, app.render.scale, forceBg || bg());

async function save(bytes, name, label, ext) {
  const p = await saveFile(bytes, name, [{ name: label, extensions: [ext] }]);
  if (p) toast(`Exporté : ${name.split('.').pop().toUpperCase()} ✔`, 'ok');
}

async function guarded(title, fn) {
  commitFloating();
  const pr = progress(title);
  try {
    await fn(pr);
  } catch (err) {
    console.error(err);
    toast('Erreur pendant l’export : ' + (err.message || err), 'error', 5000);
  } finally {
    pr.close();
  }
}

export function exportPNG() {
  return guarded('Export PNG', async () => {
    const bytes = await canvasToBytes(frameCanvas(app.frameIndex));
    await save(bytes, `${base()}_frame${app.frameIndex + 1}.png`, 'Image PNG', 'png');
  });
}

export function exportGIF() {
  return guarded('Export GIF', async (pr) => {
    const d = app.doc;
    const n = d.frames.length;
    const frames = [];
    let w = 0, h = 0;
    for (let i = 0; i < n; i++) {
      const c = frameCanvas(i);
      w = c.width;
      h = c.height;
      frames.push({ data: c.getContext('2d').getImageData(0, 0, w, h).data, delay: d.duration(i) });
      pr.set((i / n) * 0.25, `Préparation des frames… ${i + 1}/${n}`);
      await sleep(0);
    }
    const bytes = await encodeGIF(frames, w, h, {
      loop: app.render.gifLoop,
      onProgress: (p) => pr.set(0.25 + p * 0.75, `Encodage du GIF… ${Math.round(p * 100)} %`),
    });
    await save(bytes, `${base()}.gif`, 'GIF animé', 'gif');
  });
}

export function exportSequence() {
  return guarded('Export séquence PNG', async (pr) => {
    const n = app.doc.frames.length;
    const files = [];
    for (let i = 0; i < n; i++) {
      files.push({ name: `${base()}_${String(i + 1).padStart(4, '0')}.png`, data: await canvasToBytes(frameCanvas(i)) });
      pr.set((i + 1) / n, `Frame ${i + 1}/${n}`);
    }
    await save(makeZip(files), `${base()}_frames.zip`, 'Archive ZIP', 'zip');
  });
}

export function exportSpritesheet() {
  return guarded('Export spritesheet', async (pr) => {
    const n = app.doc.frames.length;
    const cols = n <= 8 ? n : Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const fw = app.doc.width * app.render.scale, fh = app.doc.height * app.render.scale;
    const sheet = makeCanvas(fw * cols, fh * rows);
    const ctx = sheet.getContext('2d');
    if (bg()) {
      ctx.fillStyle = bg();
      ctx.fillRect(0, 0, sheet.width, sheet.height);
    }
    for (let i = 0; i < n; i++) {
      ctx.drawImage(frameCanvas(i), (i % cols) * fw, Math.floor(i / cols) * fh);
      pr.set((i + 1) / n);
    }
    await save(await canvasToBytes(sheet), `${base()}_spritesheet.png`, 'Image PNG', 'png');
    toast(`Spritesheet : ${cols} × ${rows} cases de ${fw} × ${fh} px`, 'info', 4000);
  });
}

export function exportVideo(kind) {
  if (!window.MediaRecorder) return toast('L’export vidéo n’est pas disponible ici', 'error');
  const types = kind === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) return toast(kind === 'mp4' ? 'Le MP4 n’est pas supporté sur ce système, essaie le WebM 🙏' : 'WebM non supporté ici', 'error', 4500);
  return guarded(`Export vidéo ${kind.toUpperCase()}`, async (pr) => {
    const d = app.doc;
    const n = d.frames.length;
    const s = app.render.scale;
    let w = d.width * s, h = d.height * s;
    w += w % 2;
    h += h % 2;
    const fill = app.render.transparent ? '#000000' : app.render.bg;
    const frames = [];
    for (let i = 0; i < n; i++) frames.push(frameCanvas(i, fill));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = d.mode !== 'pixel';
    const stream = c.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const draw = (i) => {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(frames[i], 0, 0);
      track.requestFrame?.();
    };
    rec.start();
    for (let i = 0; i < n; i++) {
      draw(i);
      pr.set(i / n, `Enregistrement en temps réel… frame ${i + 1}/${n}`);
      await sleep(d.duration(i));
    }
    draw(n - 1);
    await sleep(50);
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    await save(new Uint8Array(await blob.arrayBuffer()), `${base()}.${kind}`, `Vidéo ${kind.toUpperCase()}`, kind);
  });
}
