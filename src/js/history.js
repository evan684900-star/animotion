import { app, hooks, markDirty, refreshUI } from './state.js';
import { requestRender } from './view.js';

const undoStack = [];
const redoStack = [];
const MAX = 100;

export function pushHistory(entry) {
  undoStack.push(entry);
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
  markDirty();
  refreshUI();
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

function afterChange() {
  const d = app.doc;
  app.layerIndex = Math.min(app.layerIndex, d.layers.length - 1);
  app.frameIndex = Math.min(app.frameIndex, d.frames.length - 1);
  app.vsel.clear();
  markDirty();
  requestRender();
  refreshUI();
}

export function undo() {
  hooks.commitPending();
  const e = undoStack.pop();
  if (!e) return;
  e.undo();
  redoStack.push(e);
  afterChange();
}

export function redo() {
  hooks.commitPending();
  const e = redoStack.pop();
  if (!e) return;
  e.redo();
  undoStack.push(e);
  afterChange();
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

// Modification d'une seule cel (dessin)
export function celEntry(layerId, frameId, before, after) {
  return {
    undo: () => app.doc.setCelData(layerId, frameId, before),
    redo: () => app.doc.setCelData(layerId, frameId, after),
  };
}

// Modification de structure (calques, frames, taille…) : on photographie tout le document
function snap() {
  return { doc: app.doc.snapshot(), li: app.layerIndex, fi: app.frameIndex };
}
function restore(s) {
  app.doc.restore(s.doc);
  app.layerIndex = s.li;
  app.frameIndex = s.fi;
}

export function structural(fn) {
  hooks.commitPending();
  const before = snap();
  const res = fn();
  if (res === false) return false;
  const after = snap();
  pushHistory({ undo: () => restore(before), redo: () => restore(after) });
  afterChange();
  return true;
}
