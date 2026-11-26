// Mode Montage : panneau de droite (réglages du clip sélectionné, ou du projet)
import { M, selectedClips, mediaById, commit, emitChange, FORMATS, TRANSFORM, ADJUST, clipEnd, mediaLength } from './model.js';
import { FILTERS, ANIMS, TRANSITIONS, EFFECTS } from './engine.js';
import { TRANSITION_LIST, EFFECT_LIST, groupsOf, TRANSITION_BY_ID } from './fx.js';
import { setSpeed, extractAudio, freezeFrame } from './edit.js';
import { el, escapeHtml } from '../util.js';
import { hooks } from '../state.js';

let root;
const redraw = () => emitChange('props'); // aperçu seulement
const done = () => commit(); // fin de réglage : dans l'historique

const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Consolas', 'Segoe Script', 'Segoe UI Emoji'];
const BLENDS = [['source-over', 'Normal'], ['multiply', 'Produit'], ['screen', 'Superposition claire'], ['overlay', 'Incrustation'], ['darken', 'Obscurcir'], ['lighten', 'Éclaircir'], ['color-dodge', 'Densité couleur −'], ['color-burn', 'Densité couleur +'], ['hard-light', 'Lumière crue'], ['soft-light', 'Lumière douce'], ['difference', 'Différence'], ['exclusion', 'Exclusion'], ['hue', 'Teinte'], ['saturation', 'Saturation'], ['color', 'Couleur'], ['luminosity', 'Luminosité']];
const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8, 10];

// ---------------------------------------------------------- petits composants
const opened = new Map(); // sections ouvertes / fermées par l'utilisateur (gardées entre deux rendus)
function section(title, open = true) {
  const d = el('details', 'mt-sec');
  d.open = opened.has(title) ? opened.get(title) : open;
  d.ontoggle = () => opened.set(title, d.open);
  d.appendChild(el('summary', null, escapeHtml(title)));
  root.appendChild(d);
  return d;
}
function row(parent, label, input, unit) {
  const r = el('div', 'mt-row-f');
  r.append(el('label', null, escapeHtml(label)), input);
  if (unit) r.appendChild(el('span', 'mt-unit', unit));
  parent.appendChild(r);
  return r;
}
function slider(parent, label, get, set, min, max, step = 1, unit = '', fmt = (v) => v) {
  const w = el('div', 'mt-slider');
  const r = el('input');
  Object.assign(r, { type: 'range', min, max, step, value: get() });
  const n = el('input', 'mt-num');
  Object.assign(n, { type: 'number', min, max, step, value: +fmt(get()).toFixed(2) });
  r.oninput = () => { set(+r.value); n.value = +fmt(+r.value).toFixed(2); redraw(); };
  r.onchange = done;
  n.onchange = () => { const v = Math.max(min, Math.min(max, +n.value)); set(v); r.value = v; redraw(); done(); };
  r.ondblclick = () => { r.dispatchEvent(new Event('reset')); };
  w.append(r, n);
  row(parent, label, w, unit);
  return r;
}
function check(parent, label, get, set) {
  const l = el('label', 'rcheck');
  l.innerHTML = `<input type="checkbox" ${get() ? 'checked' : ''}><span>${escapeHtml(label)}</span>`;
  l.querySelector('input').onchange = (e) => { set(e.target.checked); redraw(); done(); render(); };
  parent.appendChild(l);
}
function select(parent, label, options, get, set, rerender = false) {
  const s = el('select');
  const opt = (parent, [v, t]) => {
    const o = el('option', null, escapeHtml(t));
    o.value = v;
    if (String(v) === String(get())) o.selected = true;
    parent.appendChild(o);
  };
  for (const o of options) {
    if (o.group) {
      const g = el('optgroup');
      g.label = o.group;
      o.options.forEach((x) => opt(g, x));
      s.appendChild(g);
    } else opt(s, o);
  }
  s.onchange = () => { set(s.value); redraw(); done(); if (rerender) render(); };
  row(parent, label, s);
}
function color(parent, label, get, set) {
  const c = el('input');
  c.type = 'color';
  c.value = get();
  c.oninput = () => { set(c.value); redraw(); };
  c.onchange = done;
  row(parent, label, c);
}
function button(parent, label, fn, cls = '') {
  const b = el('button', 'btn small ' + cls, label);
  b.onclick = fn;
  parent.appendChild(b);
  return b;
}

// ---------------------------------------------------------- rendu du panneau
export function initInspector(container) {
  root = container;
  render();
}

export function render() {
  if (!root || !M.project) return;
  const scroll = root.scrollTop;
  root.innerHTML = '';
  const list = selectedClips();
  if (!list.length) projectPanel();
  else clipPanel(list[0], list.length);
  root.scrollTop = scroll;
}

function projectPanel() {
  const p = M.project;
  root.appendChild(el('h3', 'mt-insp-title', '⚙️ Projet'));
  const s = section('Format');
  const grid = el('div', 'mt-formats');
  for (const [name, w, h, desc] of FORMATS) {
    const b = el('button', 'mt-format' + (p.width === w && p.height === h ? ' active' : ''), `<i style="aspect-ratio:${w}/${h}"></i><b>${name}</b><span>${desc}</span>`);
    b.onclick = () => { p.width = w; p.height = h; done(); emitChange('format'); render(); };
    grid.appendChild(b);
  }
  s.appendChild(grid);
  const dims = el('div', 'mt-dims');
  const wi = el('input'), hi = el('input');
  Object.assign(wi, { type: 'number', min: 16, max: 4096, value: p.width });
  Object.assign(hi, { type: 'number', min: 16, max: 4096, value: p.height });
  const apply = () => { p.width = Math.max(16, Math.min(4096, +wi.value || p.width)); p.height = Math.max(16, Math.min(4096, +hi.value || p.height)); done(); emitChange('format'); render(); };
  wi.onchange = hi.onchange = apply;
  dims.append(wi, el('span', null, '×'), hi, el('span', 'mt-unit', 'px'));
  row(s, 'Taille', dims);
  select(s, 'Images/s', [[24, '24 (cinéma)'], [25, '25'], [30, '30 (standard)'], [50, '50'], [60, '60 (fluide)']], () => p.fps, (v) => (p.fps = +v));
  const bg = section('Arrière-plan');
  select(bg, 'Type', [['color', 'Couleur unie'], ['blur', 'Flou de la vidéo (idéal en vertical)']], () => p.background.type, (v) => (p.background.type = v), true);
  color(bg, 'Couleur', () => p.background.color, (v) => (p.background.color = v));
  if (p.background.type === 'blur') slider(bg, 'Intensité du flou', () => p.background.blur || 30, (v) => (p.background.blur = v), 5, 80);
  const tip = el('p', 'mt-tip', 'Astuce : sélectionne un clip dans la timeline pour voir tous ses réglages (taille, couleurs, animations, son…).');
  root.appendChild(tip);
}

function clipPanel(c, count) {
  const m = c.media && mediaById(c.media);
  const visual = !['audio', 'effect'].includes(c.type);
  const labels = { video: 'Vidéo', image: 'Image', gif: 'GIF animé', anim: 'Animation Animotion', color: 'Fond de couleur', shape: 'Forme', text: 'Texte', effect: 'Effet', audio: 'Audio' };
  root.appendChild(el('h3', 'mt-insp-title', `${escapeHtml(labels[c.type])}${count > 1 ? ` <span class="muted">(+${count - 1} autre${count > 2 ? 's' : ''})</span>` : ''}`));
  if (m) root.appendChild(el('p', 'mt-insp-sub', escapeHtml(m.name)));

  // --- Général
  const g = section('Général');
  slider(g, 'Début', () => c.start, (v) => (c.start = v), 0, Math.max(60, clipEnd(c) + 30), 0.01, 's');
  slider(g, 'Durée', () => c.duration, (v) => (c.duration = Math.min(v, (mediaLength(c) - c.in) / c.speed)), 0.05, Math.min(600, Number.isFinite(mediaLength(c)) ? (mediaLength(c) - c.in) / c.speed : 120), 0.01, 's');
  if (['video', 'audio', 'gif', 'anim'].includes(c.type)) {
    select(g, 'Vitesse', SPEEDS.map((v) => [v, `×${v}`]).concat(SPEEDS.includes(c.speed) ? [] : [[c.speed, `×${c.speed}`]]), () => c.speed, (v) => setSpeed(c, +v), true);
  }
  if (['gif', 'anim'].includes(c.type)) check(g, 'Boucler l’animation', () => c.loop, (v) => (c.loop = v));

  // --- Texte
  if (c.type === 'text') {
    const t = section('Texte');
    const ta = el('textarea', 'mt-textarea');
    ta.value = c.text.content;
    ta.oninput = () => { c.text.content = ta.value; redraw(); };
    ta.onchange = done;
    ta.onkeydown = (e) => e.stopPropagation();
    t.appendChild(ta);
    select(t, 'Police', FONTS.map((f) => [f, f]), () => c.text.font, (v) => (c.text.font = v));
    slider(t, 'Taille', () => c.text.size, (v) => (c.text.size = v), 8, 600, 1, 'px');
    color(t, 'Couleur', () => c.text.color, (v) => (c.text.color = v));
    const st = el('div', 'mt-toggles');
    for (const [k, lab] of [['bold', 'Gras'], ['italic', 'Italique'], ['typewriter', 'Machine à écrire'], ['glow', 'Néon']]) check(st, lab, () => c.text[k], (v) => (c.text[k] = v));
    t.appendChild(st);
    select(t, 'Alignement', [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']], () => c.text.align, (v) => (c.text.align = v));
    slider(t, 'Espacement', () => c.text.spacing || 0, (v) => (c.text.spacing = v), -10, 60, 1, 'px');
    const o = section('Contour, ombre et fond', false);
    check(o, 'Contour', () => c.text.outline, (v) => (c.text.outline = v));
    if (c.text.outline) {
      color(o, 'Couleur du contour', () => c.text.outlineColor, (v) => (c.text.outlineColor = v));
      slider(o, 'Épaisseur', () => c.text.outlineWidth, (v) => (c.text.outlineWidth = v), 1, 40, 1, 'px');
    }
    check(o, 'Ombre', () => c.text.shadow, (v) => (c.text.shadow = v));
    check(o, 'Fond', () => c.text.bg, (v) => (c.text.bg = v));
    if (c.text.bg) {
      color(o, 'Couleur du fond', () => c.text.bgColor, (v) => (c.text.bgColor = v));
      slider(o, 'Opacité du fond', () => c.text.bgOpacity * 100, (v) => (c.text.bgOpacity = v / 100), 0, 100, 1, '%');
    }
  }
  // --- Forme / couleur
  if (c.type === 'shape' || c.type === 'color') {
    const f = section(c.type === 'shape' ? 'Forme' : 'Couleur');
    color(f, 'Couleur', () => c.color, (v) => (c.color = v));
    if (c.type === 'shape') {
      select(f, 'Forme', [['rect', 'Rectangle'], ['round', 'Rectangle arrondi'], ['circle', 'Cercle / ellipse'], ['triangle', 'Triangle'], ['star', 'Étoile'], ['heart', 'Cœur'], ['arrow', 'Flèche']], () => c.shape.kind, (v) => (c.shape.kind = v));
      slider(f, 'Largeur', () => c.shape.w, (v) => (c.shape.w = v), 4, 4000, 1, 'px');
      slider(f, 'Hauteur', () => c.shape.h, (v) => (c.shape.h = v), 4, 4000, 1, 'px');
    }
  }
  // --- Effet
  if (c.type === 'effect') {
    const f = section('Effet');
    select(f, 'Type', groupsOf(EFFECT_LIST).map(([g, list]) => ({ group: g, options: list.map((e) => [e.id, `${e.icon} ${e.label}`]) })), () => c.effect.type, (v) => { c.effect.type = v; c.name = v; });
    slider(f, 'Intensité', () => c.effect.intensity * 100, (v) => (c.effect.intensity = v / 100), 0, 100, 1, '%');
    f.appendChild(el('p', 'mt-tip', 'Un effet s’applique à tout ce qui se trouve sur les pistes en dessous de lui, pendant sa durée.'));
  }

  if (visual) {
    // --- Transformation
    const tf = c.transform;
    const s = section('Position et taille');
    slider(s, 'Position X', () => tf.x * 100, (v) => (tf.x = v / 100), -100, 200, 0.5, '%');
    slider(s, 'Position Y', () => tf.y * 100, (v) => (tf.y = v / 100), -100, 200, 0.5, '%');
    slider(s, 'Taille', () => tf.scale * 100, (v) => (tf.scale = v / 100), 1, 800, 1, '%');
    slider(s, 'Rotation', () => tf.rotation, (v) => (tf.rotation = v), -360, 360, 1, '°');
    slider(s, 'Opacité', () => tf.opacity * 100, (v) => (tf.opacity = v / 100), 0, 100, 1, '%');
    const fl = el('div', 'mt-toggles');
    check(fl, 'Miroir ↔', () => tf.flipH, (v) => (tf.flipH = v));
    check(fl, 'Miroir ↕', () => tf.flipV, (v) => (tf.flipV = v));
    s.appendChild(fl);
    if (['video', 'image', 'gif', 'anim'].includes(c.type)) {
      select(s, 'Cadrage', [['contain', 'Ajuster (tout voir)'], ['cover', 'Remplir (recadrer)'], ['fill', 'Étirer']], () => c.fit, (v) => (c.fit = v));
    }
    const quick = el('div', 'mt-btnrow');
    button(quick, 'Centrer', () => { tf.x = 0.5; tf.y = 0.5; done(); render(); });
    button(quick, 'Plein cadre', () => { c.fit = 'cover'; tf.scale = 1; tf.x = 0.5; tf.y = 0.5; tf.rotation = 0; done(); render(); });
    button(quick, 'Réinitialiser', () => { c.transform = TRANSFORM(); done(); render(); });
    s.appendChild(quick);
    if (['video', 'image', 'gif', 'anim'].includes(c.type)) {
      const cr = section('Recadrage', false);
      for (const [k, lab] of [['l', 'Gauche'], ['r', 'Droite'], ['t', 'Haut'], ['b', 'Bas']]) slider(cr, lab, () => c.crop[k] * 100, (v) => (c.crop[k] = Math.min(0.95, v / 100)), 0, 90, 0.5, '%');
    }
    // --- Animation
    const a = section('Animation', false);
    const animOpts = Object.entries(ANIMS);
    select(a, 'Entrée', animOpts, () => c.animIn.type, (v) => (c.animIn.type = v));
    slider(a, 'Durée entrée', () => c.animIn.duration, (v) => (c.animIn.duration = v), 0.05, 5, 0.05, 's');
    select(a, 'Sortie', animOpts, () => c.animOut.type, (v) => (c.animOut.type = v));
    slider(a, 'Durée sortie', () => c.animOut.duration, (v) => (c.animOut.duration = v), 0.05, 5, 0.05, 's');
    const mo = section('Mouvement de caméra (début → fin)', false);
    check(mo, 'Activer (ex. zoom lent « Ken Burns »)', () => c.motion.enabled, (v) => { c.motion.enabled = v; if (v) c.motion.to = { ...c.transform, scale: c.transform.scale * 1.25 }; });
    if (c.motion.enabled) {
      const to = c.motion.to;
      mo.appendChild(el('p', 'mt-tip', 'Le clip part des réglages « Position et taille » et arrive à ceux-ci :'));
      slider(mo, 'X final', () => to.x * 100, (v) => (to.x = v / 100), -100, 200, 0.5, '%');
      slider(mo, 'Y final', () => to.y * 100, (v) => (to.y = v / 100), -100, 200, 0.5, '%');
      slider(mo, 'Taille finale', () => to.scale * 100, (v) => (to.scale = v / 100), 1, 800, 1, '%');
      slider(mo, 'Rotation finale', () => to.rotation, (v) => (to.rotation = v), -360, 360, 1, '°');
      slider(mo, 'Opacité finale', () => to.opacity * 100, (v) => (to.opacity = v / 100), 0, 100, 1, '%');
      select(mo, 'Accélération', [['ease', 'Douce'], ['linear', 'Constante']], () => c.motion.ease, (v) => (c.motion.ease = v));
    }
    // --- Transition
    const tr = section('Transition d’entrée', false);
    select(tr, 'Type', [['none', 'Aucune'], ...groupsOf(TRANSITION_LIST).map(([g, list]) => ({ group: g, options: list.map((t) => [t.id, `${t.icon} ${t.label}`]) }))], () => c.transition.type,
      (v) => { if (c.transition.type === 'none' && TRANSITION_BY_ID[v]) c.transition.duration = TRANSITION_BY_ID[v].dur; c.transition.type = v; });
    slider(tr, 'Durée', () => c.transition.duration, (v) => (c.transition.duration = v), 0.1, 3, 0.05, 's');
    tr.appendChild(el('p', 'mt-tip', 'La transition fait le lien avec le clip collé juste avant sur la même piste.'));
    // --- Couleur
    const co = section('Filtre et couleurs', false);
    select(co, 'Filtre', Object.entries(FILTERS).map(([k, f]) => [k, f.label]), () => c.filter.name, (v) => (c.filter.name = v));
    slider(co, 'Intensité du filtre', () => c.filter.amount, (v) => (c.filter.amount = v), 0, 100, 1, '%');
    if (c.overlay) {
      co.appendChild(el('p', 'mt-insp-sub', `🎨 Mon filtre : <b>${escapeHtml(c.overlay.name || 'image')}</b>`));
      slider(co, 'Opacité du filtre', () => Math.round((c.overlay.opacity ?? 0.5) * 100), (v) => (c.overlay.opacity = v / 100), 0, 100, 1, '%');
      select(co, 'Mélange', [['source-atop', 'Normal (image par-dessus)'], ['overlay', 'Incrustation'], ['soft-light', 'Lumière douce'], ['screen', 'Éclaircir (superposition)'], ['multiply', 'Produit (assombrir)'], ['color', 'Couleur'], ['hard-light', 'Lumière crue'], ['difference', 'Différence']], () => c.overlay.blend || 'source-atop', (v) => (c.overlay.blend = v));
      button(co, '✕ Retirer mon filtre', () => { delete c.overlay; done(); render(); });
    }
    const ad = c.adjust;
    slider(co, 'Luminosité', () => ad.brightness, (v) => (ad.brightness = v), 0, 200, 1, '%');
    slider(co, 'Contraste', () => ad.contrast, (v) => (ad.contrast = v), 0, 200, 1, '%');
    slider(co, 'Saturation', () => ad.saturate, (v) => (ad.saturate = v), 0, 300, 1, '%');
    slider(co, 'Teinte', () => ad.hue, (v) => (ad.hue = v), -180, 180, 1, '°');
    slider(co, 'Flou', () => ad.blur, (v) => (ad.blur = v), 0, 40, 0.5, 'px');
    slider(co, 'Noir & blanc', () => ad.grayscale, (v) => (ad.grayscale = v), 0, 100, 1, '%');
    slider(co, 'Sépia', () => ad.sepia, (v) => (ad.sepia = v), 0, 100, 1, '%');
    slider(co, 'Inversion', () => ad.invert, (v) => (ad.invert = v), 0, 100, 1, '%');
    button(co, 'Réinitialiser les couleurs', () => { c.adjust = ADJUST(); c.filter = { name: 'none', amount: 100 }; done(); render(); });
    // --- Incrustation
    const inc = section('Incrustation et fusion', false);
    select(inc, 'Mode de fusion', BLENDS, () => c.blend, (v) => (c.blend = v));
    check(inc, 'Fond vert (chroma key)', () => c.chroma.enabled, (v) => (c.chroma.enabled = v));
    if (c.chroma.enabled) {
      color(inc, 'Couleur à retirer', () => c.chroma.color, (v) => (c.chroma.color = v));
      const pr = el('div', 'mt-btnrow');
      button(pr, '🎯 Pipette : clique sur le fond', async () => {
        const hex = await hooks.montage?.pickColor(c);
        if (!hex) return;
        c.chroma.color = hex;
        done();
        render();
      });
      inc.appendChild(pr);
      slider(inc, 'Tolérance', () => c.chroma.tolerance, (v) => (c.chroma.tolerance = v), 0, 100, 1, '%');
      slider(inc, 'Adoucissement', () => c.chroma.softness, (v) => (c.chroma.softness = v), 0, 100, 1, '%');
    }
  }

  // --- Audio
  if (c.type === 'audio' || c.type === 'video') {
    const au = section('Son', c.type === 'audio');
    check(au, 'Muet', () => c.muted, (v) => (c.muted = v));
    slider(au, 'Volume', () => c.volume * 100, (v) => (c.volume = v / 100), 0, 300, 1, '%');
    slider(au, 'Fondu d’entrée', () => c.fadeIn, (v) => (c.fadeIn = Math.min(v, c.duration / 2)), 0, 10, 0.05, 's');
    slider(au, 'Fondu de sortie', () => c.fadeOut, (v) => (c.fadeOut = Math.min(v, c.duration / 2)), 0, 10, 0.05, 's');
    if (c.type === 'video') {
      const r = el('div', 'mt-btnrow');
      button(r, '🎵 Extraire le son', extractAudio);
      button(r, '❄️ Figer l’image', () => freezeFrame());
      au.appendChild(r);
    }
  }
}
