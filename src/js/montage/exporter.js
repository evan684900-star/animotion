// Mode Montage : export vidéo (avec le son), GIF et image
import { M, projectDuration, fmtTime } from './model.js';
import { renderFrame, hooks } from './engine.js';
import { audio, syncMedia, settle, pause } from './player.js';
import { encodeGIF } from '../gif.js';
import { saveFile } from '../platform.js';
import { modal, toast, progress } from '../dialogs.js';
import { el, escapeHtml, makeCanvas, canvasToBytes, sleep } from '../util.js';
import { store } from '../state.js';
import { fixWebmDuration } from './webm.js';
import { encodeVideo, renderFrames, fastAvailable, Cancelled } from './fastexport.js';

const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const safe = () => (M.name || 'montage').replace(/[\\/:*?"<>|]/g, '_');
export const videoMime = (kind) =>
  window.MediaRecorder
    ? (kind === 'mp4' ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']).find((t) => MediaRecorder.isTypeSupported(t))
    : null;

export async function showMontageExport() {
  pause();
  const dur = projectDuration();
  if (dur <= 0) return toast('Le montage est vide : ajoute d’abord des médias 🎬');
  const p = M.project;
  const saved = store('montageExport') || {};
  const fast = fastAvailable();
  const o = { tab: 'video', kind: fast || videoMime('mp4') ? 'mp4' : 'webm', scale: 1, fps: p.fps, quality: 'normale', sound: true, gifWidth: 480, gifFps: 15, loop: true, from: 0, to: dur, ...saved };
  o.from = 0;
  o.to = dur;
  const box = el('div', 'mx');
  const tabs = el('div', 'xp-tabs');
  const opts = el('div', 'mx-opts');
  const info = el('span', 'xp-info');
  box.append(tabs, opts);
  const row = (label, input, unit) => {
    const r = el('div', 'xp-row');
    r.append(el('label', null, escapeHtml(label)), input);
    if (unit) r.appendChild(el('span', 'muted', unit));
    opts.appendChild(r);
  };
  const sel = (options, val, on) => {
    const s = el('select');
    for (const [v, l, dis] of options) { const op = el('option', null, escapeHtml(l)); op.value = v; op.disabled = !!dis; op.selected = String(v) === String(val); s.appendChild(op); }
    s.onchange = () => { on(s.value); update(); };
    return s;
  };
  const num = (val, min, max, step, on) => {
    const i = el('input');
    Object.assign(i, { type: 'number', value: val, min, max, step });
    i.onchange = () => { on(Math.max(min, Math.min(max, +i.value))); update(); };
    return i;
  };
  const QUAL = { basse: 4e6, normale: 10e6, haute: 20e6, max: 40e6 };
  function build() {
    tabs.innerHTML = '';
    for (const [id, label] of [['video', '🎬 Vidéo'], ['gif', '🎞️ GIF'], ['image', '🖼️ Image']]) {
      const b = el('button', 'xp-tab' + (o.tab === id ? ' active' : ''), label);
      b.onclick = () => { o.tab = id; build(); };
      tabs.appendChild(b);
    }
    opts.innerHTML = '';
    if (o.tab === 'video') {
      row('Format', sel([['mp4', 'MP4 (le plus compatible)', !fast && !videoMime('mp4')], ['webm', 'WebM', !fast && !videoMime('webm')]], o.kind, (v) => (o.kind = v)));
      row('Résolution', sel([1, 0.75, 0.5, 0.25].map((s) => [s, `${even(p.width * s)} × ${even(p.height * s)}${s === 1 ? ' (originale)' : ''}`]), o.scale, (v) => (o.scale = +v)));
      row('Images / s', sel([[24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']], o.fps, (v) => (o.fps = +v)));
      row('Qualité', sel([['basse', 'Basse (fichier léger)'], ['normale', 'Normale'], ['haute', 'Haute'], ['max', 'Maximale (fichier lourd)']], o.quality, (v) => (o.quality = v)));
      const c = el('label', 'rcheck');
      c.innerHTML = `<input type="checkbox" ${o.sound ? 'checked' : ''}><span>Inclure le son</span>`;
      c.querySelector('input').onchange = (e) => (o.sound = e.target.checked);
      row('Son', c);
    } else if (o.tab === 'gif') {
      row('Largeur', sel([240, 320, 480, 640, 800, 1080].map((w) => [w, `${w} px`]), o.gifWidth, (v) => (o.gifWidth = +v)));
      row('Images / s', sel([[8, '8'], [10, '10'], [12, '12'], [15, '15'], [20, '20'], [25, '25']], o.gifFps, (v) => (o.gifFps = +v)));
      const c = el('label', 'rcheck');
      c.innerHTML = `<input type="checkbox" ${o.loop ? 'checked' : ''}><span>Boucle infinie</span>`;
      c.querySelector('input').onchange = (e) => (o.loop = e.target.checked);
      row('Boucle', c);
    } else {
      row('Résolution', sel([1, 0.5, 2].map((s) => [s, `${even(p.width * s)} × ${even(p.height * s)}`]), o.scale, (v) => (o.scale = +v)));
      opts.appendChild(el('p', 'mt-tip', `Exporte l’image à la tête de lecture (${fmtTime(M.time)}).`));
    }
    if (o.tab !== 'image') {
      const r = el('div', 'mx-range');
      r.append(num(+o.from.toFixed(2), 0, dur, 0.1, (v) => (o.from = Math.min(v, o.to - 0.1))), el('span', 'muted', 'à'), num(+o.to.toFixed(2), 0.1, dur, 0.1, (v) => (o.to = Math.max(v, o.from + 0.1))), el('span', 'muted', 's'));
      row('Passage', r);
    }
    update();
  }
  function update() {
    const len = o.to - o.from;
    info.textContent = o.tab === 'video' ? `${fmtTime(len)} · ~${Math.max(1, Math.round((QUAL[o.quality] * len) / 8e6))} Mo · ${fast ? '⚡ export rapide (carte graphique)' : 'enregistré en temps réel'}`
      : o.tab === 'gif' ? `${Math.round(len * o.gifFps)} images · ${o.gifWidth} px de large` : 'Image PNG';
  }
  build();
  const go = await modal({
    title: 'Exporter le montage',
    content: box,
    wide: true,
    onOpen: (b) => b.querySelector('.modal-foot')?.prepend(info),
    buttons: [{ label: 'Annuler', value: false }, { label: 'Exporter', value: true, primary: true }],
  });
  store('montageExport', { tab: o.tab, kind: o.kind, scale: o.scale, fps: o.fps, quality: o.quality, sound: o.sound, gifWidth: o.gifWidth, gifFps: o.gifFps, loop: o.loop });
  if (!go) return;
  try {
    if (o.tab === 'video') await exportVideo({ ...o, bitrate: QUAL[o.quality] });
    else if (o.tab === 'gif') await exportGif(o);
    else await exportImage(o);
  } catch (e) {
    console.error(e);
    toast('Erreur pendant l’export : ' + (e.message || e), 'error', 7000);
  }
}

async function save(bytes, name, label, ext, extra = '') {
  const path = await saveFile(bytes, name, [{ name: label, extensions: [ext] }]);
  if (path) toast(`Exporté : ${name} ✔${extra}`, 'ok', extra ? 6000 : 2600);
  return path;
}

// textes de progression
const dureeTxt = (s) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
const vitesseTxt = (v) => (v >= 1.05 ? `${v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ',')}× plus vite que la lecture` : 'à peu près en temps réel');
const etape = (s) => (typeof s === 'string' ? s : s ? `Image ${s.k} / ${s.n} · ${vitesseTxt(s.speed)} · reste ~${dureeTxt(s.left)}` : undefined);

/** Export vidéo : rapide (décodage + encodage par la carte graphique), sinon enregistrement en temps réel */
export async function exportVideo(o) {
  const p = M.project;
  const W = even(p.width * o.scale), H = even(p.height * o.scale);
  let cancelled = false;
  const pr = progress('Export vidéo', { onCancel: () => (cancelled = true) });
  pr.set(0, 'Préparation de l’export rapide…');
  const t0 = performance.now();
  let res;
  try {
    res = await encodeVideo({ ...o, W, H }, { isCancelled: () => cancelled, onProgress: (q, s) => pr.set(q, etape(s)) });
  } catch (e) {
    pr.close();
    if (e instanceof Cancelled) return toast('Export annulé');
    console.error(e);
    toast(`Export rapide impossible (${e.message || e}) : export en temps réel à la place ⏱️`, 'error', 6000);
    return exportVideoRealtime(o);
  }
  pr.close();
  if (!res) return exportVideoRealtime(o);
  const took = (performance.now() - t0) / 1000;
  return save(res.bytes, `${safe()}.${o.kind}`, `Vidéo ${o.kind.toUpperCase()}`, o.kind, ` en ${dureeTxt(took)} (${vitesseTxt((o.to - o.from) / took)})`);
}

/** Ancien export : on lit le montage et on l'enregistre pendant la lecture (aussi long que la vidéo) */
export async function exportVideoRealtime(o) {
  const mime = videoMime(o.kind);
  if (!mime) throw new Error(`${o.kind.toUpperCase()} non supporté sur ce PC`);
  const p = M.project;
  const W = even(p.width * o.scale), H = even(p.height * o.scale);
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const stream = cv.captureStream(o.fps);
  const tracks = [...stream.getVideoTracks()];
  const { actx, master } = audio();
  let dest = null;
  if (o.sound) {
    dest = actx.createMediaStreamDestination();
    master.connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  }
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: o.bitrate, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  let cancelled = false;
  const pr = progress('Export vidéo (temps réel)', { onCancel: () => (cancelled = true) });
  pr.set(0, 'Préparation…');
  await settle(o.from);
  renderFrame(ctx, o.from, W, H);
  await sleep(150);
  rec.start(250);
  const len = o.to - o.from;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = o.from + (performance.now() - t0) / 1000;
      if (t >= o.to || cancelled) return resolve();
      M.time = t;
      syncMedia(t, true);
      renderFrame(ctx, t, W, H);
      hooks.redraw();
      pr.set((t - o.from) / len, `Enregistrement en temps réel… ${fmtTime(t - o.from)} / ${fmtTime(len)} (garde la fenêtre ouverte)`);
      requestAnimationFrame(tick);
    };
    tick();
  });
  syncMedia(o.to, false);
  renderFrame(ctx, Math.max(o.from, o.to - 0.001), W, H);
  await sleep(120);
  rec.stop();
  await stopped;
  if (dest) master.disconnect(dest);
  if (cancelled) {
    pr.close();
    return toast('Export annulé');
  }
  pr.set(1, 'Enregistrement du fichier…');
  const blob = new Blob(chunks, { type: mime });
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (mime.includes('webm')) bytes = fixWebmDuration(bytes, len * 1000);
  pr.close();
  return save(bytes, `${safe()}.${o.kind}`, `Vidéo ${o.kind.toUpperCase()}`, o.kind);
}

export async function exportGif(o) {
  const p = M.project;
  const W = even(o.gifWidth), H = even((o.gifWidth * p.height) / p.width);
  const frames = [];
  let cancelled = false;
  const pr = progress('Export GIF', { onCancel: () => (cancelled = true) });
  try {
    await renderFrames({
      from: o.from, to: o.to, fps: o.gifFps, W, H, willRead: true, isCancelled: () => cancelled,
      onFrame: (cv) => { frames.push({ data: cv.getContext('2d').getImageData(0, 0, W, H).data, delay: 1000 / o.gifFps }); },
      onProgress: (q, s) => pr.set(q * 0.5, `Images… ${s.k}/${s.n}`),
    });
  } catch (e) {
    pr.close();
    if (e instanceof Cancelled) return toast('Export annulé');
    throw e;
  }
  const bytes = await encodeGIF(frames, W, H, { loop: o.loop, onProgress: (q) => pr.set(0.5 + q * 0.5, `Encodage du GIF… ${Math.round(q * 100)} %`) });
  pr.close();
  return save(bytes, `${safe()}.gif`, 'GIF animé', 'gif');
}

export async function exportImage(o) {
  const p = M.project;
  const W = even(p.width * o.scale), H = even(p.height * o.scale);
  const cv = makeCanvas(W, H);
  await settle(M.time);
  renderFrame(cv.getContext('2d'), M.time, W, H);
  return save(await canvasToBytes(cv), `${safe()}_${fmtTime(M.time).replace(/[:.]/g, '-')}.png`, 'Image PNG', 'png');
}
