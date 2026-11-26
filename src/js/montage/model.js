// Mode Montage : modèle du projet (pistes, clips, médias), sélection et historique
import { newId } from '../doc.js';

export const FORMATS = [
  ['16:9', 1920, 1080, 'YouTube, écran'],
  ['9:16', 1080, 1920, 'TikTok, Reels, Shorts'],
  ['1:1', 1080, 1080, 'Instagram carré'],
  ['4:5', 1080, 1350, 'Instagram portrait'],
  ['4:3', 1440, 1080, 'Classique'],
  ['21:9', 2560, 1080, 'Cinéma'],
];

/** État global du mode montage */
export const M = {
  project: null,
  media: new Map(), // id -> données en mémoire { url, img, doc, frames, thumbs, peaks, bytes, missing }
  sel: new Set(), // ids des clips sélectionnés
  time: 0,
  playing: false,
  zoom: 80, // pixels par seconde dans la timeline
  snap: true,
  loop: false,
  undo: [],
  redo: [],
  last: null, // dernier état enregistré dans l'historique
  path: null,
  name: 'Mon montage',
  clipboard: null,
  listeners: new Set(),
};

export const emitChange = (what = 'all') => M.listeners.forEach((fn) => fn(what));
export const onChange = (fn) => M.listeners.add(fn);

export function makeTrack(kind, name) {
  return { id: newId(), kind, name, muted: false, hidden: false, locked: false };
}

export function createProject(w = 1920, h = 1080, fps = 30) {
  return {
    app: 'animotion',
    version: 1,
    mode: 'montage',
    width: w,
    height: h,
    fps,
    background: { type: 'color', color: '#000000', blur: 30 },
    media: [],
    // lignes universelles (vidéo, son, texte, effet… sur n'importe laquelle), de la Ligne 1 (en bas) vers le haut :
    // les lignes du haut passent devant celles du bas
    tracks: [makeTrack('line', 'Ligne 1'), makeTrack('line', 'Ligne 2'), makeTrack('line', 'Ligne 3')],
    clips: [],
    markers: [],
  };
}

export const TRANSFORM = () => ({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false });
export const ADJUST = () => ({ brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 });

export function makeClip(type, track, props = {}) {
  return {
    id: newId(),
    type, // video | image | gif | anim | color | shape | text | effect | audio
    track,
    media: null,
    name: '',
    start: 0,
    duration: 5,
    in: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    muted: false,
    loop: true,
    transform: TRANSFORM(),
    fit: 'contain',
    crop: { l: 0, r: 0, t: 0, b: 0 },
    adjust: ADJUST(),
    filter: { name: 'none', amount: 100 },
    blend: 'source-over',
    chroma: { enabled: false, color: '#00ff00', tolerance: 35, softness: 12 },
    animIn: { type: 'none', duration: 0.5 },
    animOut: { type: 'none', duration: 0.5 },
    motion: { enabled: false, ease: 'ease', to: { x: 0.5, y: 0.5, scale: 1.25, rotation: 0, opacity: 1 } },
    transition: { type: 'none', duration: 0.6 },
    ...props,
  };
}

export const TEXT_DEFAULT = () => ({
  content: 'Ton texte',
  font: 'Segoe UI',
  size: 110,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  spacing: 0,
  outline: true,
  outlineColor: '#000000',
  outlineWidth: 8,
  shadow: true,
  shadowColor: '#000000',
  glow: false,
  bg: false,
  bgColor: '#000000',
  bgOpacity: 0.6,
  typewriter: false,
});

// ---------------------------------------------------------- accès
export const P = () => M.project;
export const trackById = (id) => M.project.tracks.find((t) => t.id === id);
export const clipById = (id) => M.project.clips.find((c) => c.id === id);
export const mediaById = (id) => M.project.media.find((m) => m.id === id);
export const clipEnd = (c) => c.start + c.duration;
export const clipsOn = (trackId) => M.project.clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start);
export const projectDuration = () => Math.max(0, ...M.project.clips.map(clipEnd));
export const selectedClips = () => M.project.clips.filter((c) => M.sel.has(c.id));
export const firstTrack = () => M.project.tracks.find((t) => !t.locked);
/** Pistes dans l'ordre d'affichage : visuelles/effets du haut vers le bas, puis l'audio */
export const displayTracks = () => [...M.project.tracks].reverse();
/** Toujours au moins 3 lignes, et une ligne vide en plus dès que toutes sont occupées */
export function ensureLines() {
  const p = M.project;
  if (!p) return;
  while (p.tracks.length < 3) p.tracks.push(makeTrack('line', `Ligne ${p.tracks.length + 1}`));
  if (p.tracks.every((t) => p.clips.some((c) => c.track === t.id))) p.tracks.push(makeTrack('line', `Ligne ${p.tracks.length + 1}`));
}
/** Le type de piste qui accepte un type de clip */
export const kindFor = () => 'line'; // toutes les lignes acceptent tout
/** Clips qui s'affichent (ni son, ni effet) */
export const isVisual = (c) => c.type !== 'audio' && c.type !== 'effect';

/** Durée exploitable d'un média (Infinity pour une image, un texte…) */
export function mediaLength(c) {
  const m = c.media && mediaById(c.media);
  if (!m) return Infinity;
  if ((m.kind === 'video' || m.kind === 'audio') && m.duration) return m.duration;
  if ((m.kind === 'anim' || m.kind === 'gif') && !c.loop) return m.duration || Infinity;
  return Infinity;
}

/** Trouve une place libre sur une piste à partir de `start` (décale après les clips qui gênent) */
export function freeStart(trackId, start, duration, ignoreId = null) {
  let s = Math.max(0, start);
  const clips = clipsOn(trackId).filter((c) => c.id !== ignoreId);
  for (let guard = 0; guard < 500; guard++) {
    const hit = clips.find((c) => s < clipEnd(c) - 1e-6 && s + duration > c.start + 1e-6);
    if (!hit) return s;
    s = clipEnd(hit);
  }
  return s;
}

// ---------------------------------------------------------- historique (instantanés du projet)
export function resetHistory() {
  M.undo = [];
  M.redo = [];
  M.last = JSON.stringify(M.project);
}
/** À appeler après chaque modification terminée : l'état précédent part dans l'historique */
export function commit() {
  ensureLines();
  const now = JSON.stringify(M.project);
  if (now === M.last) return;
  if (M.last) M.undo.push(M.last);
  if (M.undo.length > 150) M.undo.shift();
  M.redo = [];
  M.last = now;
  emitChange('commit');
}
export function undo() {
  if (!M.undo.length) return false;
  M.redo.push(JSON.stringify(M.project));
  M.project = JSON.parse(M.undo.pop());
  M.last = JSON.stringify(M.project);
  for (const id of [...M.sel]) if (!clipById(id)) M.sel.delete(id);
  emitChange('history');
  return true;
}
export function redo() {
  if (!M.redo.length) return false;
  M.undo.push(JSON.stringify(M.project));
  M.project = JSON.parse(M.redo.pop());
  M.last = JSON.stringify(M.project);
  for (const id of [...M.sel]) if (!clipById(id)) M.sel.delete(id);
  emitChange('history');
  return true;
}

export const fmtTime = (s, withFrames = true) => {
  const total = Math.floor(Math.max(0, s) * 100 + 1e-6); // en centièmes (évite les 1,19 au lieu de 1,20)
  const m = Math.floor(total / 6000), sec = Math.floor(total / 100) % 60, cs = total % 100;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${withFrames ? '.' + String(cs).padStart(2, '0') : ''}`;
};
