// Mode Montage : export rapide (bien plus vite que la lecture)
// - les vidéos sources sont décodées image par image par la carte graphique (WebCodecs, via Mediabunny)
// - chaque image du montage est composée puis encodée tout de suite (H.264 / VP9…), sans attendre le temps réel
// - le son est mixé hors ligne (OfflineAudioContext), avec la vitesse sans voix de « chipmunk »
import { M, trackById } from './model.js';
import { playsAt, mediaTimeAt, renderFrame, frameSource } from './engine.js';
import { settle } from './player.js';
import { makeCanvas } from '../util.js';

const SR = 48000;
let MB = null;
export const lib = async () => (MB ||= await import('../vendor/mediabunny.min.mjs'));
export const fastAvailable = () => typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function';
export class Cancelled extends Error {}
const breath = () => new Promise((r) => setTimeout(r, 0)); // laisse l'interface se redessiner

// ---------------------------------------------------------- images des vidéos, décodées dans l'ordre
/** Prépare le décodage des clips vidéo pour la liste des instants `times` (croissants) */
export async function frameProvider(times, maxSide) {
  const B = await lib();
  const inputs = new Map();
  const entries = [];
  for (const c of M.project.clips) {
    if (c.type !== 'video' || trackById(c.track)?.hidden || !M.media.get(c.media)?.bytes) continue;
    const list = [];
    for (const t of times) if (playsAt(c, t)) list.push(Math.max(0, mediaTimeAt(c, t)));
    if (list.length) entries.push({ c, list, it: null, n: 0, last: null, failed: false });
  }
  const trackOf = (id) => {
    if (!inputs.has(id)) {
      inputs.set(id, (async () => {
        try {
          const input = new B.Input({ source: new B.BufferSource(M.media.get(id).bytes), formats: B.ALL_FORMATS });
          const vt = await input.getPrimaryVideoTrack();
          return { input, vt: vt && (await vt.canDecode()) ? vt : null };
        } catch {
          return { input: null, vt: null };
        }
      })());
    }
    return inputs.get(id);
  };
  const cur = new Map();
  return {
    /** Avance à l'instant t. Renvoie true si un clip n'a pas pu être décodé (il faudra passer par l'élément <video>) */
    async step(t) {
      cur.clear();
      let fallback = false;
      for (const e of entries) {
        if (!playsAt(e.c, t)) continue;
        if (e.failed) { fallback = true; continue; }
        if (e.n >= e.list.length) continue;
        try {
          if (!e.it) {
            const { vt } = await trackOf(e.c.media);
            if (!vt) throw new Error('décodage impossible');
            const dw = vt.displayWidth, dh = vt.displayHeight, k = Math.min(1, maxSide / Math.max(dw, dh));
            const sink = new B.CanvasSink(vt, { poolSize: 3, ...(k < 1 ? { width: Math.max(2, Math.round(dw * k)) } : {}) });
            e.it = sink.canvasesAtTimestamps(e.list);
          }
          const r = await e.it.next();
          e.n++;
          if (r.value?.canvas) e.last = r.value.canvas;
          cur.set(e.c.id, e.last);
          if (e.n >= e.list.length) {
            e.it.return?.();
            e.it = null;
          }
        } catch {
          e.failed = true;
          e.it = null;
          fallback = true;
        }
      }
      return fallback;
    },
    /** canvas de l'image du clip à l'instant courant (undefined : utiliser l'élément <video>) */
    get: (c) => (cur.has(c.id) ? cur.get(c.id) : undefined),
    dispose() {
      for (const e of entries) e.it?.return?.();
      for (const p of inputs.values()) p.then((x) => x.input?.dispose?.()).catch(() => {});
    },
  };
}

/** Compose les images du montage de `from` à `to` et appelle onFrame(canvas, k, n) pour chacune */
export async function renderFrames({ from, to, fps, W, H, onFrame, onProgress, isCancelled, willRead = false, canvas = null }) {
  const n = Math.max(1, Math.round((to - from) * fps));
  const times = Array.from({ length: n }, (_, k) => from + k / fps);
  const cv = canvas || makeCanvas(W, H);
  const ctx = cv.getContext('2d', { willReadFrequently: willRead });
  const fp = fastAvailable() ? await frameProvider(times, Math.max(W, H) * 1.5) : null;
  frameSource.get = fp ? fp.get : null;
  const t0 = performance.now();
  let lastBreath = t0;
  try {
    for (let k = 0; k < n; k++) {
      if (isCancelled?.()) throw new Cancelled();
      const t = times[k];
      if (!fp || (await fp.step(t))) await settle(t, 1500);
      renderFrame(ctx, t, W, H);
      await onFrame(cv, k, n, t);
      const now = performance.now();
      if (now - lastBreath > 120) {
        lastBreath = now;
        const el = (now - t0) / 1000;
        onProgress?.((k + 1) / n, { k: k + 1, n, speed: (k + 1) / fps / Math.max(0.001, el), left: (el / (k + 1)) * (n - k - 1) });
        await breath();
      }
    }
  } finally {
    frameSource.get = null;
    fp?.dispose();
  }
}

// ---------------------------------------------------------- son : mixage hors ligne
const gainAt = (c, t) => {
  const local = t - c.start;
  let g = c.volume;
  if (c.fadeIn > 0 && local < c.fadeIn) g *= Math.max(0, local / c.fadeIn);
  if (c.fadeOut > 0 && c.duration - local < c.fadeOut) g *= Math.max(0, (c.duration - local) / c.fadeOut);
  return g;
};

async function decodeAudio(id) {
  const rt = M.media.get(id);
  if (!rt?.bytes) return null;
  if (rt.pcm === undefined) {
    try {
      rt.pcm = await new OfflineAudioContext(2, 1, SR).decodeAudioData(rt.bytes.slice().buffer);
    } catch {
      rt.pcm = null; // vidéo sans piste son
    }
  }
  return rt.pcm;
}

/** Change la vitesse d'un son sans changer sa hauteur (WSOLA : on recolle des petits morceaux qui se ressemblent) */
function wsola(chans, rate, outLen) {
  const N = 2048, Hs = N / 2, tol = 512;
  const inLen = chans[0].length;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  let mono = chans[0];
  if (chans.length > 1) {
    mono = new Float32Array(inLen);
    for (const c of chans) for (let i = 0; i < inLen; i++) mono[i] += c[i];
  }
  const outs = chans.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  let prev = -1;
  for (let o = 0; o < outLen; o += Hs) {
    let p = Math.round(o * rate);
    if (prev >= 0 && prev + Hs + Hs <= inLen && inLen > N) {
      // cherche autour de la position idéale le morceau qui prolonge le mieux le précédent
      const nat = prev + Hs;
      let best = p, bs = -Infinity;
      const lo = Math.max(0, p - tol), hi = Math.min(inLen - N, p + tol);
      for (let q = lo; q <= hi; q += 4) {
        let s = 0;
        for (let i = 0; i < Hs; i += 8) s += mono[nat + i] * mono[q + i];
        if (s > bs) { bs = s; best = q; }
      }
      p = best;
    }
    p = Math.max(0, Math.min(p, inLen - N));
    for (let k = 0; k < chans.length; k++) {
      const src = chans[k], dst = outs[k];
      for (let i = 0; i < N && p + i < inLen; i++) dst[o + i] += src[p + i] * win[i];
    }
    for (let i = 0; i < N; i++) norm[o + i] += win[i];
    prev = p;
  }
  for (const d of outs) for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) d[i] /= norm[i];
  return outs;
}

function stretchClip(pcm, c) {
  const start = Math.min(pcm.length - 1, Math.max(0, Math.round(c.in * SR)));
  const inLen = Math.max(1, Math.min(pcm.length - start, Math.round(c.duration * c.speed * SR) + 4096));
  const outLen = Math.max(1, Math.round(c.duration * SR));
  const chans = [];
  for (let ch = 0; ch < pcm.numberOfChannels; ch++) chans.push(pcm.getChannelData(ch).subarray(start, start + inLen));
  const outs = wsola(chans, c.speed, outLen);
  const buf = new AudioBuffer({ numberOfChannels: outs.length, length: outLen, sampleRate: SR });
  outs.forEach((o, i) => buf.copyToChannel(o.subarray(0, outLen), i));
  return buf;
}

/** Mixe le son du montage entre from et to, par morceaux de 20 s : onChunk(AudioBuffer) */
export async function mixAudio({ from, to, onChunk, onProgress, isCancelled }) {
  const clips = M.project.clips.filter((c) => (c.type === 'audio' || c.type === 'video') && c.media && !c.muted && c.volume > 0
    && !trackById(c.track)?.muted && c.start < to && c.start + c.duration > from);
  const pcm = new Map();
  for (const c of clips) if (!pcm.has(c.media)) pcm.set(c.media, await decodeAudio(c.media));
  const stretched = new Map();
  const CH = 20;
  try {
    for (let a = from; a < to - 1e-6; a += CH) {
      if (isCancelled?.()) throw new Cancelled();
      const b = Math.min(to, a + CH);
      const ac = new OfflineAudioContext(2, Math.max(1, Math.round((b - a) * SR)), SR);
      for (const c of clips) {
        const src0 = pcm.get(c.media);
        if (!src0) continue;
        const s0 = Math.max(a, c.start), s1 = Math.min(b, c.start + c.duration);
        if (s1 - s0 < 2 / SR) continue;
        let buf = src0, offset = c.in + (s0 - c.start);
        if (Math.abs(c.speed - 1) > 1e-3) {
          if (!stretched.has(c.id)) stretched.set(c.id, stretchClip(src0, c));
          buf = stretched.get(c.id);
          offset = s0 - c.start;
        }
        if (offset >= buf.duration) continue;
        const node = ac.createBufferSource();
        node.buffer = buf;
        const g = ac.createGain();
        const n = Math.max(2, Math.ceil((s1 - s0) * 50));
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) curve[i] = gainAt(c, s0 + ((s1 - s0) * i) / (n - 1));
        g.gain.setValueCurveAtTime(curve, s0 - a, s1 - s0);
        node.connect(g).connect(ac.destination);
        node.start(s0 - a, offset, s1 - s0);
      }
      await onChunk(await ac.startRendering());
      onProgress?.((b - from) / (to - from));
      await breath();
    }
  } finally {
    for (const id of pcm.keys()) delete M.media.get(id)?.pcm; // libère la mémoire
  }
}

// ---------------------------------------------------------- vidéo complète
const VIDEO_CODECS = { mp4: ['avc', 'hevc', 'vp9', 'av1'], webm: ['vp9', 'vp8', 'av1'] };
const AUDIO_CODECS = { mp4: ['aac', 'opus'], webm: ['opus', 'vorbis'] };

/** Encode le montage. o = { kind, from, to, fps, W, H, bitrate, sound }. Renvoie les octets du fichier, ou null si l'export rapide n'est pas possible ici. */
export async function encodeVideo(o, { onProgress, isCancelled }) {
  if (!fastAvailable()) return null;
  const B = await lib();
  const vCodec = await B.getFirstEncodableVideoCodec(VIDEO_CODECS[o.kind], { width: o.W, height: o.H, bitrate: o.bitrate, frameRate: o.fps });
  if (!vCodec) return null;
  const aCodec = o.sound && typeof AudioEncoder === 'function' ? await B.getFirstEncodableAudioCodec(AUDIO_CODECS[o.kind], { numberOfChannels: 2, sampleRate: SR, bitrate: 192e3 }) : null;
  const output = new B.Output({
    format: o.kind === 'mp4' ? new B.Mp4OutputFormat({ fastStart: 'in-memory' }) : new B.WebMOutputFormat(),
    target: new B.BufferTarget(),
  });
  const cv = makeCanvas(o.W, o.H);
  const video = new B.CanvasSource(cv, { codec: vCodec, bitrate: o.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: o.fps });
  let audioSrc = null;
  if (aCodec) {
    audioSrc = new B.AudioBufferSource({ codec: aCodec, bitrate: 192e3 });
    output.addAudioTrack(audioSrc);
  }
  await output.start();
  try {
    // 1) le son (rapide), 2) les images
    if (audioSrc) {
      onProgress?.(0, 'Mixage du son…');
      await mixAudio({ from: o.from, to: o.to, isCancelled, onChunk: (buf) => audioSrc.add(buf), onProgress: (q) => onProgress?.(q * 0.05, 'Mixage du son…') });
      audioSrc.close();
    }
    await renderFrames({
      from: o.from, to: o.to, fps: o.fps, W: o.W, H: o.H, isCancelled, canvas: cv,
      onFrame: (_, k) => video.add(k / o.fps, 1 / o.fps),
      onProgress: (q, s) => onProgress?.(0.05 + q * 0.93, s),
    });
    video.close();
    onProgress?.(0.99, 'Finalisation du fichier…');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return { bytes: new Uint8Array(output.target.buffer), codec: vCodec, audio: aCodec };
}
