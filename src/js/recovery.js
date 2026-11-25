// Copie de secours automatique + récupération après plantage + avertissement à la fermeture
import { app, on, refreshUI } from './state.js';
import { isTauri } from './platform.js';
import { Doc } from './doc.js';
import { modal, toast } from './dialogs.js';
import { escapeHtml } from './util.js';
import { setDoc, saveProject } from './actions.js';
import { commitFloating } from './tools.js';

const T = window.__TAURI__;
const LS_DATA = 'animotion.secours.data', LS_META = 'animotion.secours.meta';

// ---------------------------------------------------------- Stockage (appli : disque, navigateur : localStorage)
async function writeStore(bytes, meta) {
  if (isTauri) return T.core.invoke('recovery_write', bytes, { headers: { 'x-meta': encodeURIComponent(JSON.stringify(meta)) } });
  try {
    localStorage.setItem(LS_DATA, new TextDecoder().decode(bytes));
    localStorage.setItem(LS_META, JSON.stringify(meta));
  } catch {} // projet trop gros pour le navigateur : tant pis, c'est seulement le mode test
}
async function readMeta() {
  try {
    const m = isTauri ? await T.core.invoke('recovery_meta') : localStorage.getItem(LS_META);
    return m ? JSON.parse(m) : null;
  } catch {
    return null;
  }
}
async function readData() {
  if (isTauri) return new TextDecoder().decode(new Uint8Array(await T.core.invoke('recovery_read')));
  return localStorage.getItem(LS_DATA);
}
export async function clearRecovery() {
  clearTimeout(timer);
  timer = null;
  firstChange = 0;
  app.lastBackup = null;
  try {
    if (isTauri) await T.core.invoke('recovery_clear');
    else {
      localStorage.removeItem(LS_DATA);
      localStorage.removeItem(LS_META);
    }
  } catch {}
}

// ---------------------------------------------------------- Sauvegarde de secours
let timer = null, firstChange = 0, writing = false;
const DELAY = 4000, MAX_WAIT = 30000;

export async function backupNow() {
  clearTimeout(timer);
  timer = null;
  firstChange = 0;
  if (!app.doc || !app.dirty || writing) return;
  writing = true;
  try {
    commitFloating();
    const bytes = new TextEncoder().encode(JSON.stringify(app.doc.serialize()));
    await writeStore(bytes, {
      fileName: app.fileName, filePath: app.filePath, mode: app.mode,
      width: app.doc.width, height: app.doc.height, frames: app.doc.frames.length, time: Date.now(),
    });
    app.lastBackup = new Date();
    refreshUI();
  } catch (e) {
    console.error('Copie de secours impossible', e);
  } finally {
    writing = false;
  }
}

// Après chaque modification : copie 4 s après la dernière action, et au moins toutes les 30 s si on dessine sans arrêt
function schedule() {
  if (!app.doc || !app.dirty) return;
  const now = Date.now();
  if (!firstChange) firstChange = now;
  clearTimeout(timer);
  const wait = Math.max(0, Math.min(DELAY, firstChange + MAX_WAIT - now));
  timer = setTimeout(backupNow, wait);
}

// ---------------------------------------------------------- Récupération au démarrage
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'il y a quelques secondes';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return 'le ' + new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Renvoie true si un dessin a été récupéré */
export async function checkRecovery() {
  const meta = await readMeta();
  if (!meta) return false;
  const choice = await modal({
    title: 'Dessin récupéré 🛟',
    content: `<p>Animotion ne s’est pas fermé correctement la dernière fois, mais une copie de secours a été retrouvée :</p>
      <div class="recover-card">
        <b>${escapeHtml(meta.fileName || 'Sans titre')}</b>
        <span>${meta.mode === 'pixel' ? 'Pixel art' : 'Dessin'} · ${meta.width} × ${meta.height} · ${meta.frames} frame${meta.frames > 1 ? 's' : ''}</span>
        <span>Dernière copie ${ago(meta.time)}</span>
      </div>`,
    buttons: [
      { label: 'Supprimer la copie', value: 'drop', danger: true },
      { label: 'Récupérer mon dessin', value: 'restore', primary: true },
    ],
  });
  if (choice === 'drop') {
    const sure = await modal({
      title: 'Supprimer la copie de secours ?',
      content: '<p>Le dessin récupéré sera perdu définitivement.</p>',
      buttons: [{ label: 'Annuler', value: false }, { label: 'Supprimer', value: true, danger: true }],
    });
    if (sure) await clearRecovery();
    else return checkRecovery();
    return false;
  }
  if (choice !== 'restore') return false; // fenêtre fermée : on garde la copie pour la prochaine fois
  try {
    const doc = await Doc.load(JSON.parse(await readData()));
    setDoc(doc, { path: meta.filePath, name: meta.fileName });
    app.dirty = true; // pas encore enregistré dans le vrai fichier
    refreshUI();
    toast('Dessin récupéré ! Pense à l’enregistrer (Ctrl+S) 💾', 'ok', 5000);
    return true;
  } catch (e) {
    toast('La copie de secours est illisible : ' + (e.message || e), 'error', 6000);
    return false;
  }
}

// ---------------------------------------------------------- Fermeture de la fenêtre
async function askBeforeClose() {
  return modal({
    title: 'Enregistrer avant de quitter ?',
    content: `<p>Le projet <b>${escapeHtml(app.fileName)}</b> a des modifications non enregistrées.</p>`,
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Ne pas enregistrer', value: 'discard', danger: true },
      { label: 'Enregistrer', value: 'save', primary: true },
    ],
  });
}

export function initRecovery() {
  on('changed', schedule);
  // une copie quand on quitte la fenêtre des yeux (alt-tab…), au cas où
  window.addEventListener('blur', () => app.dirty && backupNow());

  if (isTauri) {
    const w = T.window.getCurrentWindow();
    w.onCloseRequested(async (event) => {
      if (!app.doc || !app.dirty) {
        await clearRecovery();
        return; // fermeture normale
      }
      event.preventDefault();
      const c = await askBeforeClose();
      if (c === 'save') {
        if (await saveProject()) await w.destroy();
      } else if (c === 'discard') {
        await clearRecovery();
        await w.destroy();
      }
    });
  } else {
    window.addEventListener('beforeunload', (e) => {
      if (app.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }
}
