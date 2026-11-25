import { app, on, curLayer, curFrame } from './state.js';
import { el, escapeHtml, normalizeHex } from './util.js';
import { icon } from './icons.js';
import * as A from './actions.js';
import { TOOL_DEFS, toolsFor, setTool, selectedShapes } from './tools.js';
import { sizeControl, colorPair } from './ribbon.js';
import { canUndo } from './history.js';

// ---------------------------------------------------------- Barre d'outils verticale
function renderToolbar() {
  const tb = document.getElementById('toolbar');
  tb.innerHTML = '';
  if (!app.doc) return;
  for (const t of toolsFor(app.mode)) {
    const d = TOOL_DEFS[t];
    const b = el('button', 'tbtn' + (app.tool === t ? ' active' : ''), icon(d.icon, 20));
    b.title = `${d.label} (${d.key})`;
    b.onclick = () => setTool(t);
    tb.appendChild(b);
  }
}

// ---------------------------------------------------------- Panneau de droite
function swatch(hex, extraCls = '') {
  const transp = hex === 'transparent';
  const s = el('button', 'sw' + (hex === app.color ? ' sel' : '') + (transp ? ' is-transparent' : '') + extraCls);
  if (!transp) s.style.background = hex;
  s.title = (transp ? 'Transparent (efface)' : hex) + ' — clic : couleur 1, clic droit : couleur 2';
  s.onclick = () => A.setColor(hex);
  s.oncontextmenu = (e) => {
    e.preventDefault();
    A.setColor(hex, true);
  };
  return s;
}

function section(title, ...children) {
  const s = el('div', 'psec');
  s.appendChild(el('h3', null, title));
  s.append(...children);
  return s;
}

function renderPanel() {
  const p = document.getElementById('sidepanel');
  const scroll = p.scrollTop;
  p.innerHTML = '';
  if (!app.doc) return;

  // Couleurs
  const hex = el('input', 'hex');
  hex.value = app.color === 'transparent' ? 'Transparent' : app.color;
  hex.spellcheck = false;
  hex.onchange = () => {
    const v = /^transp/i.test(hex.value.trim()) ? 'transparent' : normalizeHex(hex.value);
    if (v) A.setColor(v);
    else hex.value = app.color === 'transparent' ? 'Transparent' : app.color;
  };
  const row = el('div', 'color-row');
  row.append(colorPair(), stack(el('span', 'muted', 'Hex'), hex));
  p.appendChild(section('Couleur', row));

  // Palette
  const pal = el('div', 'swatches');
  pal.appendChild(swatch('transparent')); // toujours en premier : peindre avec = effacer
  for (const c of app.palette) {
    const s = swatch(c);
    s.addEventListener('auxclick', (e) => {
      if (e.button === 1) A.removeFromPalette(c);
    });
    pal.appendChild(s);
  }
  const add = el('button', 'sw add', icon('plus', 14));
  add.title = 'Ajouter la couleur actuelle à la palette (clic molette sur une case pour la retirer)';
  add.onclick = () => A.addToPalette();
  pal.appendChild(add);
  p.appendChild(section(`Palette · ${escapeHtml(app.paletteName)}`, pal));

  if (app.recentColors.length) {
    const rec = el('div', 'swatches');
    for (const c of app.recentColors) rec.appendChild(swatch(c));
    p.appendChild(section('Récentes', rec));
  }

  // Outil
  const d = TOOL_DEFS[app.tool];
  const toolBox = el('div', 'tool-opts');
  const hasSize = !['picker', 'select', 'pointer', 'hand', 'bucket'].includes(app.tool);
  if (hasSize) toolBox.append(el('span', 'muted', 'Taille'), sizeControl());
  if (['rect', 'ellipse'].includes(app.tool)) {
    const c = el('label', 'rcheck');
    c.innerHTML = `<input type="checkbox" ${app.fillShapes ? 'checked' : ''}><span>Remplir avec la couleur 2</span>`;
    c.querySelector('input').onchange = (e) => (app.fillShapes = e.target.checked);
    toolBox.appendChild(c);
  }
  if (app.tool === 'brush') {
    const c = el('label', 'rcheck');
    c.innerHTML = `<input type="checkbox" ${app.smoothing ? 'checked' : ''}><span>Lissage du trait</span>`;
    c.querySelector('input').onchange = (e) => (app.smoothing = e.target.checked);
    toolBox.appendChild(c);
  }
  const tips = {
    pencil: 'Clic gauche : couleur 1 · clic droit : couleur 2 · Maj+clic : ligne depuis le dernier point',
    brush: 'Trait vectoriel lisse, modifiable ensuite avec la Sélection',
    eraser: app.mode === 'pixel' ? 'Efface les pixels' : 'Efface les traits entiers touchés',
    bucket: app.mode === 'pixel' ? 'Remplit une zone de même couleur' : 'Clique dans une forme pour la remplir',
    picker: 'Récupère une couleur du dessin',
    line: 'Maj : angles de 45°', rect: 'Maj : carré parfait', ellipse: 'Maj : cercle parfait',
    pointer: app.mode === 'pixel'
      ? 'Glisse pour sélectionner une zone, déplace-la, et tire les poignées blanches pour la redimensionner (Maj : garder les proportions)'
      : 'Clique un trait (Maj : plusieurs) ou encadre-les, déplace-les, et tire les poignées blanches pour les redimensionner (Maj : proportions)',
    hand: 'Attrape la toile pour déplacer la vue (aussi : Espace + glisser, ou clic molette)',
    select: app.mode === 'pixel'
      ? 'Glisse pour sélectionner, puis glisse la sélection pour la déplacer. Flèches : décaler d’1 px'
      : 'Clique un trait pour le sélectionner (Maj : plusieurs), déplace-le, ou tire ses points blancs pour le remodeler',
  };
  if (['select', 'pointer', 'hand', 'bucket'].includes(app.tool)) toolBox.appendChild(el('p', 'tip', escapeHtml(tips[app.tool] || '')));
  p.appendChild(section(`Outil · ${d.label}`, toolBox));


  // Calque
  const l = curLayer();
  const op = el('input');
  Object.assign(op, { type: 'range', min: 0, max: 100, value: Math.round(l.opacity * 100) });
  const opv = el('span', 'val', Math.round(l.opacity * 100) + ' %');
  op.oninput = () => {
    A.setLayerOpacity(op.value / 100);
    opv.textContent = op.value + ' %';
  };
  op.onchange = () => A.setLayerOpacity(op.value / 100, true);
  const opRow = el('div', 'size-ctl');
  opRow.append(op, opv);
  p.appendChild(section(`Calque · ${escapeHtml(l.name)}`, el('span', 'muted', 'Opacité'), opRow));
  p.scrollTop = scroll;
}

function stack(...n) {
  const s = el('div', 'pstack');
  s.append(...n);
  return s;
}

// ---------------------------------------------------------- Barre d'état
export function renderStatus() {
  const s = document.getElementById('statusbar');
  if (!app.doc) {
    s.innerHTML = '';
    return;
  }
  const h = app.hover;
  const inside = h && h.x >= 0 && h.y >= 0 && h.x < app.doc.width && h.y < app.doc.height;
  const pos = inside ? (app.mode === 'pixel' ? `${Math.floor(h.x)}, ${Math.floor(h.y)}` : `${Math.round(h.x)}, ${Math.round(h.y)}`) : '—';
  s.innerHTML = `
    <span class="st-mode">${app.mode === 'pixel' ? 'Pixel art' : 'Dessin'}</span>
    <span>${app.doc.width} × ${app.doc.height}</span>
    <span>Zoom ${Math.round(app.zoom * 100)} %</span>
    <span>Curseur ${pos}</span>
    <span>Frame ${app.frameIndex + 1}/${app.doc.frames.length}</span>
    <span class="grow"></span>
    <span>${app.dirty ? '● Non enregistré' + (app.lastBackup ? ` · copie de secours ${app.lastBackup.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '') : ''}</span>`;
}

export function initPanels() {
  on('ui', () => {
    renderToolbar();
    renderPanel();
    renderStatus();
  });
  on('status', renderStatus);
  on('frame', renderStatus);
}
