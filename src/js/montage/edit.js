// Mode Montage : opérations d'édition (ajout, découpe, suppression, duplication, vitesse, pistes…)
import {
  M, makeClip, makeTrack, TEXT_DEFAULT, clipById, mediaById, freeStart, clipEnd, commit, emitChange, selectedClips,
  trackById, clipsOn, kindFor, mediaLength,
} from './model.js';
import { addMedia } from './media.js';
import { elementFor } from './engine.js';
import { newId } from '../doc.js';
import { canvasToBytes, makeCanvas } from '../util.js';
import { toast, confirmDialog } from '../dialogs.js';

const VISUAL_MEDIA = ['video', 'image', 'gif', 'anim', 'color'];
const freeOn = (trackId, start, dur, ignore = null) => !clipsOn(trackId).some((c) => c.id !== ignore && start < clipEnd(c) - 1e-6 && start + dur > c.start + 1e-6);

/** Ligne qui accueille un clip : celle demandée si possible, sinon la plus basse libre à cet endroit, sinon une nouvelle */
export function trackFor(type, preferId = null, start = M.time, dur = 0.5) {
  const pref = preferId && trackById(preferId);
  if (pref && !pref.locked) return pref;
  return M.project.tracks.find((t) => !t.locked && freeOn(t.id, start, dur)) || addTrack();
}

function place(c, trackId, start) {
  // sans position imposée : les vidéos et images s'enchaînent sur la Ligne 1 (comme CapCut), le reste va à la tête de lecture
  if (start === undefined && !trackId && VISUAL_MEDIA.includes(c.type) && M.project.tracks[0] && !M.project.tracks[0].locked) {
    trackId = M.project.tracks[0].id;
    start = Math.max(0, ...clipsOn(trackId).map(clipEnd));
  }
  if (start === undefined) start = M.time;
  c.track = trackFor(c.type, trackId, start, c.duration).id;
  c.start = freeStart(c.track, start, c.duration);
  M.project.clips.push(c);
  M.sel = new Set([c.id]);
  commit();
  return c;
}

export function addMediaClip(entry, { track, start } = {}) {
  const type = entry.kind;
  let dur = type === 'image' ? 4 : entry.duration > 0 ? entry.duration : 4;
  // GIF / animation très courts : on répète la boucle pour qu'elle dure au moins 3 s
  if ((type === 'gif' || type === 'anim') && entry.duration > 0 && dur < 3) dur = Math.max(0.1, entry.duration) * Math.ceil(3 / Math.max(0.1, entry.duration));
  const c = makeClip(type, null, { media: entry.id, name: entry.name, duration: Math.max(0.2, dur), loop: type === 'gif' || type === 'anim' });
  return place(c, track || null, start);
}

export const TEXT_PRESETS = {
  titre: { label: 'Titre', text: { content: 'Mon titre', size: 140 } },
  soustitre: { label: 'Sous-titre', text: { content: 'Sous-titre', size: 64, bold: false, outline: false, bg: true, bgColor: '#000000', bgOpacity: 0.55 }, y: 0.82 },
  legende: { label: 'Légende', text: { content: 'Légende', size: 58, color: '#ffec27', outlineWidth: 5 }, y: 0.88 },
  neon: { label: 'Néon', text: { content: 'NÉON', size: 150, color: '#7ef9ff', outline: false, glow: true, font: 'Segoe UI' } },
  gaming: { label: 'Gaming', text: { content: 'GAME OVER', size: 150, color: '#ffec27', outlineColor: '#7e2553', outlineWidth: 12, font: 'Impact' } },
  elegant: { label: 'Élégant', text: { content: 'Élégance', size: 120, bold: false, italic: true, font: 'Georgia', outline: false } },
  machine: { label: 'Machine à écrire', text: { content: 'Il était une fois…', size: 80, font: 'Courier New', bold: true, outline: false, typewriter: true } },
  bulle: { label: 'Bulle', text: { content: 'Coucou !', size: 90, color: '#111111', outline: false, shadow: false, bg: true, bgColor: '#ffffff', bgOpacity: 1 } },
  alerte: { label: 'Alerte', text: { content: 'ATTENTION', size: 110, color: '#ffffff', outline: false, bg: true, bgColor: '#ff004d', bgOpacity: 1 } },
  comic: { label: 'BD', text: { content: 'BOUM !', size: 160, color: '#ffa300', outlineColor: '#000000', outlineWidth: 10, font: 'Comic Sans MS' }, anim: 'pop' },
};
export function addText(presetId = 'titre') {
  const pr = TEXT_PRESETS[presetId] || TEXT_PRESETS.titre;
  const c = makeClip('text', null, { name: pr.label, duration: 3, text: { ...TEXT_DEFAULT(), ...pr.text } });
  if (pr.y) c.transform.y = pr.y;
  c.animIn = { type: pr.anim || 'fade', duration: 0.4 };
  c.animOut = { type: 'fade', duration: 0.3 };
  return place(c, null, M.time);
}
export function addSticker(emoji) {
  const c = makeClip('text', null, {
    name: emoji, duration: 3,
    text: { ...TEXT_DEFAULT(), content: emoji, size: 260, outline: false, shadow: false, font: 'Segoe UI Emoji' },
  });
  c.animIn = { type: 'pop', duration: 0.4 };
  return place(c, null, M.time);
}
export function addShape(kind, color = '#2f8cff') {
  const c = makeClip('shape', null, { name: 'Forme', duration: 4, color, shape: { kind, w: kind === 'arrow' ? 500 : 400, h: kind === 'arrow' ? 260 : 400 } });
  return place(c, null, M.time);
}
export function addColor(color = '#000000') {
  const c = makeClip('color', null, { name: 'Fond de couleur', duration: 5, color });
  return place(c, null, undefined);
}
export function addEffect(type) {
  const c = makeClip('effect', null, { name: type, duration: 2, effect: { type, intensity: 0.6 } });
  return place(c, null, M.time);
}

/** Clips visuels collés juste après un autre clip de la même piste (là où une transition est possible) */
export function cuts() {
  const out = [];
  for (const tr of M.project.tracks) {
    if (tr.locked) continue;
    const list = clipsOn(tr.id).filter((c) => c.type !== 'audio' && c.type !== 'effect');
    for (let i = 1; i < list.length; i++) if (Math.abs(clipEnd(list[i - 1]) - list[i].start) < 0.08) out.push(list[i]);
  }
  return out;
}
/** Change la transition d'entrée de plusieurs clips : pick(c) renvoie { type, duration } ou null pour retirer */
export function setTransitions(list, pick) {
  for (const c of list) {
    const t = pick(c);
    c.transition = t ? { type: t.type, duration: t.duration } : { type: 'none', duration: c.transition?.duration || 0.6 };
  }
  commit();
  return list.length;
}

/** Applique une transition (et/ou un filtre…) aux clips sélectionnés */
export function applyToSelection(fn, msg) {
  const list = selectedClips();
  if (!list.length) return toast('Sélectionne d’abord un clip dans la timeline');
  list.forEach(fn);
  commit();
  if (msg) toast(msg, 'ok');
}

// ---------------------------------------------------------- découpe
const lerp = (a, b, p) => a + (b - a) * p;
export function split(t = M.time) {
  let targets = selectedClips().filter((c) => t > c.start + 0.03 && t < clipEnd(c) - 0.03);
  if (!targets.length) targets = M.project.clips.filter((c) => t > c.start + 0.03 && t < clipEnd(c) - 0.03 && !trackById(c.track)?.locked);
  if (!targets.length) return toast('Place la tête de lecture au milieu d’un clip pour le couper ✂️');
  const created = [];
  for (const a of targets) {
    const b = structuredClone(a);
    b.id = newId();
    const cut = t - a.start, oldDur = a.duration;
    a.duration = cut;
    b.start = t;
    b.duration = oldDur - cut;
    b.in = a.in + cut * a.speed;
    a.fadeOut = 0;
    a.animOut = { ...a.animOut, type: 'none' };
    b.fadeIn = 0;
    b.animIn = { ...b.animIn, type: 'none' };
    b.transition = { ...b.transition, type: 'none' };
    if (a.motion?.enabled) {
      // le mouvement continue sans à-coup sur les deux morceaux
      const p = cut / oldDur;
      const mid = {};
      for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) mid[k] = lerp(a.transform[k], a.motion.to[k], p);
      b.transform = { ...b.transform, ...mid };
      a.motion.to = { ...mid };
    }
    M.project.clips.push(b);
    created.push(b.id);
  }
  M.sel = new Set(created);
  commit();
}

export function removeSelected(ripple = false) {
  const list = selectedClips();
  if (!list.length) return;
  for (const c of list) {
    M.project.clips = M.project.clips.filter((x) => x.id !== c.id);
    if (ripple) for (const x of M.project.clips) if (x.track === c.track && x.start >= clipEnd(c) - 1e-6) x.start -= c.duration;
  }
  M.sel.clear();
  commit();
}

export function duplicateSelected() {
  const list = selectedClips();
  if (!list.length) return;
  const created = [];
  for (const c of list) {
    const d = structuredClone(c);
    d.id = newId();
    d.start = freeStart(c.track, clipEnd(c), c.duration);
    M.project.clips.push(d);
    created.push(d.id);
  }
  M.sel = new Set(created);
  commit();
}

export function copySelected() {
  const list = selectedClips();
  if (!list.length) return false;
  M.clipboard = structuredClone(list);
  toast(`${list.length} clip${list.length > 1 ? 's' : ''} copié${list.length > 1 ? 's' : ''} 📋`);
  return true;
}
export function paste() {
  if (!M.clipboard?.length) return toast('Rien à coller');
  const first = Math.min(...M.clipboard.map((c) => c.start));
  const created = [];
  for (const src of M.clipboard) {
    const c = structuredClone(src);
    c.id = newId();
    if (!trackById(c.track)) c.track = trackFor(c.type).id;
    c.start = freeStart(c.track, M.time + (src.start - first), c.duration);
    M.project.clips.push(c);
    created.push(c.id);
  }
  M.sel = new Set(created);
  commit();
}

// ---------------------------------------------------------- vitesse, audio, image figée
export function setSpeed(c, speed) {
  speed = Math.max(0.1, Math.min(10, speed));
  const span = c.duration * c.speed, oldEnd = clipEnd(c);
  c.speed = speed;
  c.duration = Math.max(0.05, Math.min(span / speed, (mediaLength(c) - c.in) / speed));
  const delta = clipEnd(c) - oldEnd;
  // les clips suivants de la même piste suivent (pas de trou, pas de chevauchement)
  for (const x of M.project.clips) if (x.id !== c.id && x.track === c.track && x.start >= oldEnd - 1e-6) x.start = Math.max(0, x.start + delta);
}

export function extractAudio() {
  const list = selectedClips().filter((c) => c.type === 'video');
  if (!list.length) return toast('Sélectionne un clip vidéo pour en extraire le son 🎵');
  const created = [];
  for (const c of list) {
    if (mediaById(c.media)?.hasAudio === false) { toast(`« ${c.name} » n’a pas de son`); continue; }
    const tr = trackFor('audio', null, c.start, c.duration);
    const a = makeClip('audio', tr.id, { media: c.media, name: '🎵 ' + c.name, start: c.start, duration: c.duration, in: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
    a.start = freeStart(tr.id, c.start, c.duration);
    M.project.clips.push(a);
    c.muted = true;
    created.push(a.id);
  }
  if (created.length) {
    M.sel = new Set(created);
    commit();
    toast('Son extrait sur une ligne libre 🎵 (la vidéo est maintenant muette)', 'ok');
  }
}

export async function freezeFrame(seconds = 2) {
  const t = M.time;
  const c = selectedClips().find((x) => x.type === 'video' && t >= x.start && t < clipEnd(x))
    || M.project.clips.find((x) => x.type === 'video' && t >= x.start && t < clipEnd(x));
  if (!c) return toast('Place la tête de lecture sur une vidéo pour figer l’image ❄️');
  const el = elementFor(c);
  if (!el?.videoWidth) return toast('La vidéo n’est pas encore prête, réessaie dans un instant');
  const cv = makeCanvas(el.videoWidth, el.videoHeight);
  cv.getContext('2d').drawImage(el, 0, 0);
  const entry = await addMedia({ name: `Image figée ${c.name}.png`, bytes: await canvasToBytes(cv) });
  // on coupe la vidéo, on décale la suite, et on glisse l'image figée au milieu
  if (t > c.start + 0.03) { M.sel = new Set([c.id]); split(t); }
  for (const x of M.project.clips) if (x.track === c.track && x.start >= t - 1e-6) x.start += seconds;
  const img = makeClip('image', c.track, { media: entry.id, name: '❄️ Image figée', start: t, duration: seconds, transform: { ...c.transform }, fit: c.fit, crop: { ...c.crop }, filter: { ...c.filter }, adjust: { ...c.adjust } });
  M.project.clips.push(img);
  M.sel = new Set([img.id]);
  commit();
  toast('Image figée ajoutée ❄️', 'ok');
}

// ---------------------------------------------------------- pistes et marqueurs
export function addTrack() {
  const tr = makeTrack('line', `Ligne ${M.project.tracks.length + 1}`);
  M.project.tracks.push(tr);
  emitChange('tracks');
  return tr;
}
export async function removeTrack(id) {
  const tr = trackById(id);
  if (!tr) return;
  if (M.project.tracks.length <= 3) return toast('Il faut garder au moins 3 lignes');
  if (M.project.clips.some((c) => c.track === id) && !(await confirmDialog('Supprimer la ligne ?', `« ${tr.name} » et tout ce qu’elle contient seront supprimés.`, 'Supprimer', true))) return;
  M.project.clips = M.project.clips.filter((c) => c.track !== id);
  M.project.tracks = M.project.tracks.filter((t) => t.id !== id);
  commit();
}
export function toggleMarker(t = M.time) {
  const i = M.project.markers.findIndex((m) => Math.abs(m - t) < 0.08);
  if (i >= 0) M.project.markers.splice(i, 1);
  else M.project.markers.push(+t.toFixed(3));
  M.project.markers.sort((a, b) => a - b);
  commit();
}
export { clipById };
