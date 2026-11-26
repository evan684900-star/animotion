// Mode Montage : bibliothèque (médias, textes, stickers, formes, effets, transitions, filtres, audio)
import { M, emitChange, selectedClips, commit, fmtTime, clipEnd } from './model.js';
import { addMedia, addAnimation, ALL_EXT, EXT, kindOf, parseAnimo } from './media.js';
import { addMediaClip, addText, addSticker, addShape, addColor, addEffect, applyToSelection, TEXT_PRESETS, cuts, setTransitions } from './edit.js';
import { TRANSITION_LIST, EFFECT_LIST, groupsOf, applyFx, applyTransition } from './fx.js';
import { EFFECTS, TRANSITIONS, FILTERS } from './engine.js';
import { openFiles } from '../platform.js';
import { el, escapeHtml, makeCanvas } from '../util.js';
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

// ---------------------------------------------------------- effets et transitions : catégories, recherche, aperçus animés
const PW = 160, PH = 90;
let demoA = null, demoB = null;
const query = { effect: '', transition: '' };
let lastTransition = 'fondu';
function demos() {
  if (demoA) return;
  demoA = makeCanvas(PW, PH);
  demoB = makeCanvas(PW, PH);
  // A : montagnes sous un ciel bleu
  let x = demoA.getContext('2d'), g = x.createLinearGradient(0, 0, 0, PH);
  g.addColorStop(0, '#1d4fa8'); g.addColorStop(1, '#7cc4ff');
  x.fillStyle = g; x.fillRect(0, 0, PW, PH);
  x.fillStyle = '#ffec27'; x.beginPath(); x.arc(122, 24, 11, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1d2b53'; x.beginPath(); x.moveTo(0, PH); x.lineTo(42, 38); x.lineTo(72, 66); x.lineTo(104, 32); x.lineTo(PW, PH); x.fill();
  x.fillStyle = '#e8f4ff'; x.beginPath(); x.moveTo(42, 38); x.lineTo(50, 46); x.lineTo(34, 46); x.fill(); x.beginPath(); x.moveTo(104, 32); x.lineTo(113, 41); x.lineTo(95, 41); x.fill();
  // B : ville au coucher du soleil
  x = demoB.getContext('2d'); g = x.createLinearGradient(0, 0, 0, PH);
  g.addColorStop(0, '#ff77a8'); g.addColorStop(1, '#ffa300');
  x.fillStyle = g; x.fillRect(0, 0, PW, PH);
  x.fillStyle = 'rgba(255,250,220,.9)'; x.beginPath(); x.arc(46, 40, 16, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#5b1d4a';
  for (let i = 0; i < 9; i++) { const h = 18 + ((i * 37) % 34); x.fillRect(i * 18 + 1, PH - h, 15, h); }
  x.fillStyle = '#ffec27';
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) if ((i + j) % 3) x.fillRect(i * 18 + 5, PH - 12 - j * 7, 3, 3);
}
function preview(cv, kind, item, time) {
  demos();
  const x = cv.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.fillStyle = '#000';
  x.fillRect(0, 0, PW, PH);
  try {
    if (kind === 'transition') {
      const p = time === null ? 0.36 : Math.min(1, Math.max(0, ((time % 1.9) - 0.25) / 1.2));
      applyTransition(x, item.id, demoA, demoB, p, PW, PH);
    } else {
      x.drawImage(demoA, 0, 0);
      applyFx(x, item.id, 0.75, time === null ? 1.6 : time % 4, 4, PW, PH, { bg: '#000', fps: 30 });
    }
  } catch (e) {
    console.warn('aperçu', item.id, e);
  }
}

/** Grille d'effets ou de transitions, rangée par catégories, avec recherche et aperçu animé au survol */
function fxBrowser(body, kind, list, onPick) {
  const search = el('input', 'mt-search');
  search.type = 'search';
  search.placeholder = `🔎 Rechercher parmi ${list.length} ${kind === 'effect' ? 'effets' : 'transitions'}…`;
  search.value = query[kind];
  const zone = el('div', 'mt-fx-zone');
  body.append(search, zone);
  let anim = 0;
  const fill = () => {
    zone.innerHTML = '';
    const q = query[kind].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const shown = list.filter((it) => !q || norm(it.label + ' ' + it.cat + ' ' + it.id).includes(q));
    if (!shown.length) zone.appendChild(el('div', 'mt-empty', 'Rien trouvé 🤷'));
    for (const [cat, items] of groupsOf(shown)) {
      zone.appendChild(el('h4', 'mt-lib-h', `${escapeHtml(cat)} <span>${items.length}</span>`));
      const grid = el('div', 'mt-fx-grid');
      for (const it of items) {
        const b = el('button', 'mt-fx');
        b.title = `${it.label} — clique pour l’utiliser`;
        const cv = el('canvas');
        cv.width = PW;
        cv.height = PH;
        b.append(cv, el('span', null, `${it.icon} ${escapeHtml(it.label)}`));
        preview(cv, kind, it, null);
        b.onclick = () => onPick(it);
        b.onmouseenter = () => {
          cancelAnimationFrame(anim);
          const t0 = performance.now();
          const loop = () => {
            preview(cv, kind, it, (performance.now() - t0) / 1000);
            anim = requestAnimationFrame(loop);
          };
          loop();
        };
        b.onmouseleave = () => {
          cancelAnimationFrame(anim);
          preview(cv, kind, it, null);
        };
        grid.appendChild(b);
      }
      zone.appendChild(grid);
    }
  };
  search.oninput = () => { query[kind] = search.value; fill(); };
  search.onkeydown = (e) => e.stopPropagation();
  fill();
}

function effects(body) {
  heading(body, `Effets (${EFFECT_LIST.length})`, 'Clique sur un effet pour l’ajouter à la tête de lecture : il agit sur tout ce qui est en dessous, pendant sa durée. Survole pour voir l’aperçu.');
  fxBrowser(body, 'effect', EFFECT_LIST, (it) => {
    addEffect(it.id);
    toast(`Effet « ${it.label} » ajouté ${it.icon}`, 'ok');
  });
}

function transitions(body) {
  heading(body, `Transitions (${TRANSITION_LIST.length})`, 'Sélectionne le clip qui ARRIVE (à droite de la coupure) puis clique sur une transition. Sans sélection, elle s’applique à toutes les coupures.');
  const top = el('div', 'mt-lib-actions');
  const rnd = el('button', 'btn', '🎲 Au hasard partout');
  rnd.title = 'Une transition différente, tirée au sort, sur chaque coupure';
  rnd.onclick = () => {
    const list = cuts();
    if (!list.length) return toast('Aucune coupure : mets deux clips bout à bout sur une piste vidéo');
    setTransitions(list, () => { const t = TRANSITION_LIST[Math.floor(Math.random() * TRANSITION_LIST.length)]; return { type: t.id, duration: t.dur }; });
    toast(`${list.length} transition${list.length > 1 ? 's' : ''} tirée${list.length > 1 ? 's' : ''} au sort 🎲`, 'ok');
  };
  const none = el('button', 'btn', '✖ Tout retirer');
  none.onclick = () => {
    const list = M.project.clips.filter((c) => c.transition?.type && c.transition.type !== 'none');
    if (!list.length) return toast('Aucune transition à retirer');
    setTransitions(list, () => null);
    toast('Transitions retirées', 'ok');
  };
  const same = el('button', 'btn', '');
  const label = () => { const t = TRANSITION_LIST.find((x) => x.id === lastTransition) || TRANSITION_LIST[0]; same.innerHTML = `⇋ ${t.icon} ${escapeHtml(t.label)} partout`; return t; };
  label();
  same.title = 'Met la dernière transition choisie sur toutes les coupures';
  same.onclick = () => {
    const t = label(), list = cuts();
    if (!list.length) return toast('Aucune coupure : mets deux clips bout à bout sur une piste vidéo');
    setTransitions(list, () => ({ type: t.id, duration: t.dur }));
    toast(`${t.icon} « ${t.label} » sur toutes les coupures (${list.length})`, 'ok');
  };
  top.append(same, rnd, none);
  body.appendChild(top);
  fxBrowser(body, 'transition', TRANSITION_LIST, (t) => {
    lastTransition = t.id;
    label();
    const sel = selectedClips().filter((c) => !['audio', 'effect'].includes(c.type));
    const list = sel.length ? sel : cuts();
    if (!list.length) return toast('Mets deux clips bout à bout sur une piste vidéo, puis choisis une transition');
    setTransitions(list, (c) => ({ type: t.id, duration: c.transition?.type !== 'none' && c.transition?.duration ? c.transition.duration : t.dur }));
    toast(`${t.icon} « ${t.label} » appliquée ${sel.length ? `à ${list.length} clip${list.length > 1 ? 's' : ''}` : `à toutes les coupures (${list.length})`}`, 'ok');
  });
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
