// Mode Montage : bibliothèque (médias, textes, stickers, formes, effets, transitions, filtres, audio)
import { M, emitChange, selectedClips, commit, fmtTime, clipEnd } from './model.js';
import { addMedia, addAnimation, ALL_EXT, EXT, kindOf, parseAnimo } from './media.js';
import { addMediaClip, addText, addSticker, addShape, addColor, addEffect, applyToSelection, TEXT_PRESETS } from './edit.js';
import { EFFECTS, TRANSITIONS, FILTERS } from './engine.js';
import { openFiles } from '../platform.js';
import { el, escapeHtml } from '../util.js';
import { toast, progress } from '../dialogs.js';
import { app } from '../state.js';

const TABS = [
  ['media', '📁', 'Médias'], ['text', '🔤', 'Texte'], ['stickers', '😀', 'Stickers'], ['shapes', '🔷', 'Formes'],
  ['effects', '✨', 'Effets'], ['transitions', '⇋', 'Transitions'], ['filters', '🎨', 'Filtres'], ['audio', '🎵', 'Audio'],
];
const STICKERS = '😀 😂 🤣 😍 🥰 😎 🤩 🥳 😭 😡 🤯 😱 🤔 🙄 😴 🤡 👻 💀 👽 🤖 👾 🎃 💩 🙈 👍 👎 👏 🙌 💪 🤝 ✌️ 🤞 👀 💯 🔥 ✨ ⭐ 🌟 💥 💫 ⚡ 💧 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💕 🎉 🎊 🎁 🏆 🥇 🎮 🕹️ 🎬 🎵 🎶 🎤 📸 💡 💰 💎 🚀 🌈 ☀️ 🌙 ⛄ 🍕 🍔 🍩 🍿 🐱 🐶 🦊 🐸 🐉 🦄 🐝 🌸 🌵 🍀 ⚽ 🏀 ❓ ❗ ✅ ❌ ⚠️ ➡️ ⬅️ ⬆️ ⬇️'.split(' ');
const SHAPES = [['rect', '⬛', 'Rectangle'], ['round', '▢', 'Arrondi'], ['circle', '⚫', 'Cercle'], ['triangle', '🔺', 'Triangle'], ['star', '⭐', 'Étoile'], ['heart', '❤️', 'Cœur'], ['arrow', '➡️', 'Flèche']];
const COLORS = ['#000000', '#ffffff', '#2f8cff', '#ff004d', '#ffec27', '#00e436', '#ff77a8', '#ffa300', '#7e2553', '#1d2b53', '#29adff', '#5fd35f'];

let root, current = 'media', recorder = null;

export function initLibrary(container) {
  root = container;
  render();
}

export async function importMediaFiles(files) {
  if (!files?.length) return;
  const pr = files.length > 1 || files.some((f) => kindOf(f.name) === 'video') ? progress('Import des médias') : null;
  const added = [];
  let i = 0;
  for (const f of files) {
    pr?.set(i++ / files.length, `Import de ${f.name}…`);
    try {
      if (kindOf(f.name) === 'anim') {
        const obj = parseAnimo(f.bytes);
        if (obj.mode === 'montage') { toast('Ce fichier est un montage : ouvre-le avec Fichier › Ouvrir'); continue; }
        added.push(await addAnimation(obj, f.name.replace(/\.animo$/i, '')));
      } else added.push(await addMedia(f));
    } catch (e) {
      toast(`Impossible d’importer ${f.name} : ${e.message || e}`, 'error', 6000);
    }
  }
  pr?.close();
  // premier import d'un projet vide : on place directement les médias visuels sur la timeline
  if (added.length && !M.project.clips.length) for (const m of added) addMediaClip(m);
  if (added.length) toast(`${added.length} média${added.length > 1 ? 's' : ''} importé${added.length > 1 ? 's' : ''} 📁`, 'ok');
  current = added.some((m) => m.kind === 'audio') && added.every((m) => m.kind === 'audio') ? 'audio' : 'media';
  render();
}

async function pickAndImport(kinds) {
  const exts = kinds ? kinds.flatMap((k) => EXT[k]) : ALL_EXT;
  importMediaFiles(await openFiles([{ name: 'Médias', extensions: exts }]));
}

export function render() {
  if (!root) return;
  root.innerHTML = '';
  const tabs = el('div', 'mt-lib-tabs');
  for (const [id, ic, label] of TABS) {
    const b = el('button', 'mt-lib-tab' + (id === current ? ' active' : ''), `<span>${ic}</span>${label}`);
    b.onclick = () => { current = id; render(); };
    tabs.appendChild(b);
  }
  const body = el('div', 'mt-lib-body');
  root.append(tabs, body);
  ({ media, text, stickers, shapes, effects, transitions, filters, audio })[current](body);
}

const heading = (body, t, sub) => {
  body.appendChild(el('h4', 'mt-lib-h', escapeHtml(t)));
  if (sub) body.appendChild(el('p', 'mt-tip', escapeHtml(sub)));
};
const card = (body, html, title, fn, cls = '') => {
  const b = el('button', 'mt-card ' + cls, html);
  b.title = title;
  b.onclick = fn;
  body.appendChild(b);
  return b;
};

function mediaItem(m) {
  const rt = M.media.get(m.id);
  const it = el('div', 'mt-media' + (rt?.missing ? ' missing' : ''));
  it.draggable = true;
  it.ondragstart = (e) => e.dataTransfer.setData('text/animotion-media', m.id);
  const th = el('div', 'mt-media-th');
  const thumb = rt?.thumbs?.[0]?.c;
  if (thumb) { const c = el('canvas'); c.width = thumb.width; c.height = thumb.height; c.getContext('2d').drawImage(thumb, 0, 0); th.appendChild(c); }
  else th.textContent = { audio: '🎵', video: '🎬', anim: '✏️' }[m.kind] || '🖼️';
  if (m.duration) th.appendChild(el('span', 'mt-media-dur', fmtTime(m.duration, false)));
  const add = el('button', 'mt-media-add', '+');
  add.title = 'Ajouter à la timeline';
  add.onclick = () => addMediaClip(m);
  it.ondblclick = () => addMediaClip(m);
  it.append(th, el('span', 'mt-media-name', escapeHtml(rt?.missing ? '⚠ ' + m.name : m.name)), add);
  return it;
}

function media(body) {
  const top = el('div', 'mt-lib-actions');
  const imp = el('button', 'btn primary', '＋ Importer des médias');
  imp.onclick = () => pickAndImport();
  top.appendChild(imp);
  if (app.doc && app.doc.frames.length) {
    const cur = el('button', 'btn', '✏️ Animation en cours');
    cur.title = 'Ajouter l’animation Animotion que tu étais en train de faire';
    cur.onclick = async () => {
      const m = await addAnimation(app.doc.serialize(), app.fileName || 'Animation');
      addMediaClip(m);
      render();
    };
    top.appendChild(cur);
  }
  body.appendChild(top);
  body.appendChild(el('p', 'mt-tip', 'Vidéos, images, GIF animés, sons et projets .animo. Tu peux aussi les glisser sur la fenêtre. Glisse un média sur une piste, ou clique sur ＋.'));
  const list = M.project.media.filter((m) => m.kind !== 'audio');
  if (!list.length) body.appendChild(el('div', 'mt-empty', 'Aucun média pour l’instant 📭'));
  const grid = el('div', 'mt-media-grid');
  for (const m of list) grid.appendChild(mediaItem(m));
  body.appendChild(grid);
  heading(body, 'Fonds de couleur');
  const cols = el('div', 'mt-swatches');
  for (const c of COLORS) {
    const s = el('button', 'mt-sw');
    s.style.background = c;
    s.title = 'Ajouter un fond ' + c;
    s.onclick = () => addColor(c);
    cols.appendChild(s);
  }
  body.appendChild(cols);
}

function text(body) {
  heading(body, 'Styles de texte', 'Clique pour ajouter un texte à la tête de lecture, puis modifie-le à droite.');
  const grid = el('div', 'mt-cards');
  for (const [id, p] of Object.entries(TEXT_PRESETS)) {
    const t = p.text;
    const style = `font-family:'${t.font || 'Segoe UI'}';color:${t.color || '#fff'};font-weight:${t.bold === false ? 400 : 800};font-style:${t.italic ? 'italic' : 'normal'};${t.bg ? `background:${t.bgColor};padding:2px 6px;border-radius:5px;` : ''}${t.glow ? `text-shadow:0 0 8px ${t.color};` : t.outline === false ? '' : `-webkit-text-stroke:1px ${t.outlineColor || '#000'};`}`;
    card(grid, `<span class="mt-textprev" style="${style}">${escapeHtml(p.label)}</span>`, p.label, () => addText(id));
  }
  body.appendChild(grid);
}

function stickers(body) {
  heading(body, 'Stickers', 'Clique sur un emoji pour l’ajouter. Pour un sticker animé, importe un GIF dans Médias.');
  const grid = el('div', 'mt-emoji');
  for (const e of STICKERS) {
    const b = el('button', null, e);
    b.onclick = () => addSticker(e);
    grid.appendChild(b);
  }
  body.appendChild(grid);
}

function shapes(body) {
  heading(body, 'Formes', 'Ajoute une forme, puis change sa couleur et sa taille à droite.');
  const grid = el('div', 'mt-cards');
  for (const [k, ic, label] of SHAPES) card(grid, `<span class="mt-big">${ic}</span>${label}`, label, () => addShape(k));
  body.appendChild(grid);
}

function effects(body) {
  heading(body, 'Effets', 'Un effet s’ajoute sur la piste Effets et agit sur tout ce qui est en dessous, pendant sa durée.');
  const grid = el('div', 'mt-cards');
  for (const [k, [label, ic]] of Object.entries(EFFECTS)) card(grid, `<span class="mt-big">${ic}</span>${label}`, label, () => addEffect(k));
  body.appendChild(grid);
}

function transitions(body) {
  heading(body, 'Transitions', 'Sélectionne le clip qui ARRIVE (celui de droite à la coupure), puis choisis une transition.');
  const grid = el('div', 'mt-cards');
  const ics = { none: '🚫', fondu: '🌗', noir: '🌑', blanc: '⚪', 'glisser-gauche': '⬅️', 'glisser-droite': '➡️', 'glisser-haut': '⬆️', 'glisser-bas': '⬇️', zoom: '🔍', balayage: '🧹', cercle: '⭕', flou: '🌫️', tourbillon: '🌀' };
  for (const [k, label] of Object.entries(TRANSITIONS)) {
    card(grid, `<span class="mt-big">${ics[k] || '⇋'}</span>${label}`, label, () =>
      applyToSelection((c) => { c.transition = { type: k, duration: c.transition?.duration || 0.6 }; }, k === 'none' ? 'Transition retirée' : `Transition « ${label} » appliquée ⇋`));
  }
  body.appendChild(grid);
}

function filters(body) {
  heading(body, 'Filtres', 'Sélectionne un ou plusieurs clips, puis choisis un filtre. Intensité réglable à droite.');
  const grid = el('div', 'mt-cards');
  const sw = { none: 'linear-gradient(135deg,#2f8cff,#ff77a8)' };
  for (const [k, f] of Object.entries(FILTERS)) {
    const css = [f.brightness && `brightness(${f.brightness}%)`, f.contrast && `contrast(${f.contrast}%)`, f.saturate && `saturate(${f.saturate}%)`, f.hue && `hue-rotate(${f.hue}deg)`, f.grayscale && `grayscale(${f.grayscale}%)`, f.sepia && `sepia(${f.sepia}%)`].filter(Boolean).join(' ');
    card(grid, `<span class="mt-filterprev" style="filter:${css || 'none'};background:${sw.none}"></span>${f.label}`, f.label, () =>
      applyToSelection((c) => { if (!['audio', 'effect'].includes(c.type)) c.filter = { name: k, amount: c.filter?.amount ?? 100 }; }, `Filtre « ${f.label} » appliqué 🎨`));
  }
  body.appendChild(grid);
}

function audio(body) {
  const top = el('div', 'mt-lib-actions');
  const imp = el('button', 'btn primary', '＋ Importer de la musique');
  imp.onclick = () => pickAndImport(['audio']);
  const rec = el('button', 'btn' + (recorder ? ' danger' : ''), recorder ? '⏹ Arrêter la voix off' : '🎤 Enregistrer une voix off');
  rec.onclick = toggleVoice;
  top.append(imp, rec);
  body.appendChild(top);
  body.appendChild(el('p', 'mt-tip', 'La voix off s’enregistre pendant que le montage se lit, à partir de la tête de lecture.'));
  const list = M.project.media.filter((m) => m.kind === 'audio');
  if (!list.length) body.appendChild(el('div', 'mt-empty', 'Aucun son pour l’instant 🔇'));
  const grid = el('div', 'mt-media-grid list');
  for (const m of list) grid.appendChild(mediaItem(m));
  body.appendChild(grid);
}

async function toggleVoice() {
  const { play, pause } = await import('./player.js');
  if (recorder) {
    recorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('Micro inaccessible : autorise l’accès au micro pour enregistrer une voix off 🎤', 'error', 6000);
  }
  const chunks = [];
  const startAt = M.time;
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    pause();
    const blob = new Blob(chunks, { type: mime || 'audio/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer()); // durée calculée au chargement (media.js)
    try {
      const m = await addMedia({ name: `Voix off ${new Date().toLocaleTimeString("fr-FR").replace(/:/g, "h")}.weba`, bytes });
      addMediaClip(m, { start: startAt });
      toast('Voix off ajoutée 🎤', 'ok');
    } catch (e) {
      toast('Voix off illisible : ' + e.message, 'error');
    }
    render();
  };
  recorder.start();
  play(startAt);
  toast('🔴 Enregistrement… clique sur « Arrêter la voix off » quand tu as fini');
  render();
}

export { pickAndImport };
