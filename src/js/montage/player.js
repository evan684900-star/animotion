// Mode Montage : lecture (horloge, synchronisation des vidéos/sons) et mixage audio
import { M, projectDuration, trackById } from './model.js';
import { elementFor, playsAt, mediaTimeAt, hooks } from './engine.js';

// ---------------------------------------------------------- audio (WebAudio : volume > 100 %, mixage pour l'export)
let actx = null, master = null, out = null;
const gains = new Map(), pending = new Set();
hooks.onElement = (el) => (actx ? connect(el) : pending.add(el));
function connect(el) {
  if (gains.has(el)) return;
  try {
    const src = actx.createMediaElementSource(el);
    const g = actx.createGain();
    src.connect(g);
    g.connect(master);
    gains.set(el, g);
  } catch {}
}
/** Crée (au premier clic) le mixeur audio : sources -> master -> sortie (haut-parleurs) */
export function audio() {
  if (!actx) {
    actx = new AudioContext();
    master = actx.createGain();
    out = actx.createGain();
    master.connect(out);
    out.connect(actx.destination);
    for (const el of pending) connect(el);
    pending.clear();
  }
  if (actx.state === 'suspended') actx.resume();
  return { actx, master, out };
}
export function setPreviewMuted(v) {
  M.previewMuted = v;
  if (out) out.gain.value = v ? 0 : 1;
}
function setVolume(el, v) {
  const g = gains.get(el);
  if (g) { el.volume = 1; g.gain.value = v; }
  else el.volume = Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------- synchronisation des médias au temps t
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function syncMedia(t, playing) {
  for (const c of M.project.clips) {
    if (c.type !== 'video' && c.type !== 'audio') continue;
    const el = elementFor(c);
    if (!el) continue;
    const tr = trackById(c.track);
    const local = t - c.start;
    let vol = c.muted || tr?.muted ? 0 : c.volume;
    if (c.fadeIn > 0 && local < c.fadeIn) vol *= clamp(local / c.fadeIn, 0, 1);
    if (c.fadeOut > 0 && c.duration - local < c.fadeOut) vol *= clamp((c.duration - local) / c.fadeOut, 0, 1);
    if (local > c.duration) vol = 0; // pendant la transition vers le clip suivant : l'image seulement
    setVolume(el, vol);
    if (!playsAt(c, t)) {
      if (!el.paused) el.pause();
      continue;
    }
    const mt = Math.max(0, mediaTimeAt(c, t));
    const rate = clamp(c.speed, 0.0625, 16);
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (playing) {
      if (el.paused) {
        if (Math.abs(el.currentTime - mt) > 0.05) el.currentTime = mt;
        el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - mt) > 0.25) el.currentTime = mt;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - mt) > 0.5 / M.project.fps) el.currentTime = mt;
    }
  }
}

/** Positionne tout au temps t et attend que les vidéos aient l'image demandée (export image par image) */
export async function settle(t, timeout = 2500) {
  syncMedia(t, false);
  const t0 = performance.now();
  for (;;) {
    let busy = false;
    for (const c of M.project.clips) {
      if (c.type !== 'video' || !playsAt(c, t)) continue;
      const el = elementFor(c);
      if (el && (el.seeking || el.readyState < 2)) busy = true;
    }
    if (!busy || performance.now() - t0 > timeout) return;
    await new Promise((r) => setTimeout(r, 15));
  }
}

// ---------------------------------------------------------- lecture
export const player = { onFrame: () => {}, onState: () => {} };
let raf = 0, t0 = 0, p0 = 0;

export function play(from = M.time) {
  audio();
  const end = projectDuration();
  if (end <= 0) return;
  if (from >= end - 0.01) from = 0;
  M.playing = true;
  p0 = from;
  t0 = performance.now();
  player.onState();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}
function tick() {
  if (!M.playing) return;
  const end = projectDuration();
  let t = p0 + (performance.now() - t0) / 1000;
  if (t >= end) {
    if (M.loop) {
      p0 = 0;
      t0 = performance.now();
      t = 0;
    } else {
      M.time = end;
      pause();
      return;
    }
  }
  M.time = t;
  syncMedia(t, true);
  player.onFrame(t);
  raf = requestAnimationFrame(tick);
}
export function pause() {
  M.playing = false;
  cancelAnimationFrame(raf);
  syncMedia(M.time, false);
  player.onFrame(M.time);
  player.onState();
}
export const toggle = () => (M.playing ? pause() : play());
export function seek(t) {
  M.time = Math.max(0, Math.min(t, Math.max(projectDuration(), 0)));
  if (M.playing) {
    p0 = M.time;
    t0 = performance.now();
  }
  syncMedia(M.time, M.playing);
  player.onFrame(M.time);
}
