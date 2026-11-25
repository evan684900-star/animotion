// Disposition redimensionnable : barre d'outils, panneau, timeline, colonne des calques,
// largeur des frames, ruban repliable, taille globale de l'interface. Tout est mémorisé.
import { store, refreshUI } from './state.js';
import { el } from './util.js';
import { icon } from './icons.js';

const DEFAULTS = { tb: 56, side: 248, tl: 196, lname: 210, cell: 28, ribbon: true, showSide: true, showTl: true, ui: 1 };
export const layout = { ...DEFAULTS, ...(store('layout') || {}) };

const LIMITS = {
  tb: [44, 160], side: [180, 520], lname: [90, 420], cell: [16, 90],
  tl: [90, () => Math.round(window.innerHeight * 0.7)],
};
const lim = (k, v) => {
  const [a, b] = LIMITS[k];
  return Math.round(Math.max(a, Math.min(typeof b === 'function' ? b() : b, v)));
};

const appEl = document.getElementById('app');
const root = document.documentElement;

export function applyLayout(save = true) {
  for (const k of ['tb', 'side', 'tl', 'lname', 'cell']) layout[k] = lim(k, layout[k]);
  const css = { '--tb-w': layout.tb, '--side-w': layout.side, '--tl-h': layout.tl, '--lname-w': layout.lname, '--cell-w': layout.cell };
  for (const [k, v] of Object.entries(css)) root.style.setProperty(k, v + 'px');
  appEl.classList.toggle('no-side', !layout.showSide);
  appEl.classList.toggle('no-tl', !layout.showTl);
  appEl.classList.toggle('ribbon-min', !layout.ribbon);
  if (save) store('layout', layout);
  window.dispatchEvent(new Event('resize'));
}

export function setLayout(key, value) {
  layout[key] = value;
  applyLayout();
  refreshUI();
}
export function toggleLayout(key) {
  setLayout(key, !layout[key]);
}
export function resetLayout() {
  Object.assign(layout, DEFAULTS, { ui: layout.ui });
  applyLayout();
  refreshUI();
}

/** Rend un élément "poignée" : glisser modifie layout[key]. dir = +1 ou -1 selon le sens. */
export function makeResizer(handle, key, axis, dir = 1) {
  handle.title = 'Glisser pour redimensionner — double-clic : taille par défaut';
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const start = axis === 'x' ? e.clientX : e.clientY;
    const startV = layout[key];
    handle.classList.add('drag');
    document.body.classList.add('resizing', axis === 'x' ? 'v' : 'h');
    const move = (ev) => {
      const d = ((axis === 'x' ? ev.clientX : ev.clientY) - start) * dir;
      layout[key] = lim(key, startV + d);
      applyLayout(false);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('drag');
      document.body.classList.remove('resizing', 'v', 'h');
      applyLayout();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    layout[key] = DEFAULTS[key];
    applyLayout();
  });
}

// ---------------------------------------------------------- Taille de toute l'interface
const T = window.__TAURI__;
export async function setUiScale(v) {
  v = Math.round(Math.max(0.6, Math.min(2, v)) * 100) / 100;
  layout.ui = v;
  store('layout', layout);
  let done = false;
  if (T?.webview?.getCurrentWebview) {
    try {
      await T.webview.getCurrentWebview().setZoom(v);
      done = true;
    } catch {}
  }
  if (!done) root.style.zoom = v === 1 ? '' : v;
  refreshUI();
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

export function initLayout() {
  const main = document.getElementById('main');
  const rzTool = el('div', 'resizer v');
  rzTool.id = 'rzTool';
  const rzSide = el('div', 'resizer v');
  rzSide.id = 'rzSide';
  main.append(rzTool, rzSide);
  makeResizer(rzTool, 'tb', 'x', 1);
  makeResizer(rzSide, 'side', 'x', -1);
  const rzTl = el('div', 'resizer h');
  rzTl.id = 'rzTimeline';
  document.getElementById('timeline').appendChild(rzTl);
  makeResizer(rzTl, 'tl', 'y', -1);

  // bouton pour replier le ruban (comme dans Word)
  const tog = el('button', 'ribbon-toggle', icon('up', 15));
  tog.title = 'Replier / déplier le ruban (Ctrl+F1)';
  tog.onclick = () => toggleLayout('ribbon');
  document.getElementById('tabs').appendChild(tog);

  applyLayout(false);
  if (layout.ui !== 1) setUiScale(layout.ui);
}
