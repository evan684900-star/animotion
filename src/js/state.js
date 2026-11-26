import { PALETTES } from './palettes.js';

export const app = {
  doc: null,
  mode: 'pixel',
  tool: 'pencil',
  color: '#29adff',
  color2: '#000000',
  pixelSize: 1,
  vectorSize: 4,
  fillShapes: false,
  smoothing: true,
  layerIndex: 0,
  frameIndex: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  showRulers: false,
  gridMajor: 8,
  // réglages de la grille (onglet Grille), mémorisés entre les sessions
  grid: {
    pixelLines: true, // une ligne par pixel (mode pixel)
    step: 0, // pas de la grille en mode dessin (0 = automatique selon le zoom)
    subdiv: 4, // grande ligne toutes les N cases (mode dessin)
    style: 'lines', // 'lines' | 'dots'
    color: '#a0bef0',
    majorColor: '', // vide = couleur d'accent
    opacity: 50,
    snap: false, // magnétisme (mode dessin)
    checker: true, // damier de transparence
    bg: '#161a22',
    ...(JSON.parse(localStorage.getItem('animotion.grid') || 'null') || {}),
  },
  onion: { enabled: false, before: 1, after: 1 },
  playing: false,
  playMode: 'loop',
  filePath: null,
  fileName: 'Sans titre',
  dirty: false,
  sel: null, // sélection pixel {x,y,w,h}
  floating: null, // pixels flottants {canvas,x,y,before,layerId,frameId}
  clipboard: null,
  vsel: new Set(), // ids des formes vectorielles sélectionnées
  marquee: null,
  hover: null,
  recentColors: [],
  palette: [...PALETTES['Animotion'].colors],
  paletteName: 'Animotion',
  render: { scale: 1, transparent: true, bg: '#000000', gifLoop: true },
  accent: '#2f8cff',
  lastBackup: null, // heure de la dernière copie de secours
};

// Petit bus d'événements
const handlers = {};
export function on(ev, fn) {
  (handlers[ev] ||= []).push(fn);
}
export function emit(ev, data) {
  (handlers[ev] || []).forEach((f) => f(data));
}

let uiPending = false;
export function refreshUI() {
  if (uiPending) return;
  uiPending = true;
  requestAnimationFrame(() => {
    uiPending = false;
    emit('ui');
  });
}

// Crochets remplis par d'autres modules (évite les imports circulaires au chargement)
export const hooks = {
  commitPending: () => {},
  montage: null, // rempli par montage/index.js : { isOpen, dirty, name, save, close… }
};
/** Le mode montage est-il affiché ? */
export const montageOpen = () => !!hooks.montage?.isOpen();

export const curLayer = () => app.doc.layers[app.layerIndex];
export const curFrame = () => app.doc.frames[app.frameIndex];

export function markDirty() {
  if (!app.dirty) {
    app.dirty = true;
    emit('title');
  }
  emit('changed'); // déclenche la copie de secours
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem('animotion.' + key));
    localStorage.setItem('animotion.' + key, JSON.stringify(value));
  } catch {
    return null;
  }
}
