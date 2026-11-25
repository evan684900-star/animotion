// Mises à jour automatiques depuis les releases GitHub
import { isTauri } from './platform.js';
import { modal, toast, progress } from './dialogs.js';
import { escapeHtml } from './util.js';
import { app } from './state.js';
import { saveProject } from './actions.js';

const REPO = 'evan684900-star/animotion';
const T = window.__TAURI__;

const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

export async function currentVersion() {
  try {
    return isTauri ? await T.app.getVersion() : 'navigateur';
  } catch {
    return '?';
  }
}

/** silent = vérification au démarrage : ne dit rien s'il n'y a rien de neuf ou en cas d'erreur réseau */
export async function checkForUpdate(silent = false) {
  if (!isTauri) {
    if (!silent) toast('Les mises à jour automatiques fonctionnent dans l’appli Windows');
    return;
  }
  let rel;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub a répondu ' + r.status);
    rel = await r.json();
  } catch (e) {
    if (!silent) toast('Impossible de vérifier les mises à jour : ' + e.message, 'error', 5000);
    return;
  }
  const cur = await currentVersion();
  const latest = rel.tag_name;
  const asset = (rel.assets || []).find((a) => a.name === 'Animotion.exe');
  if (!asset || !newer(latest, cur)) {
    if (!silent) toast(`Tu as déjà la dernière version (${cur}) ✨`, 'ok');
    return;
  }
  const choice = await modal({
    title: 'Mise à jour disponible 🎉',
    content: `<p>La version <b>${escapeHtml(latest.replace(/^v/, ''))}</b> est disponible (tu as la ${escapeHtml(cur)}).</p>
      <p class="muted">Animotion va télécharger la nouvelle version (${(asset.size / 1e6).toFixed(1)} Mo), se fermer puis se relancer tout seul.${app.dirty ? ' Ton projet en cours sera d’abord enregistré.' : ''}</p>`,
    buttons: [
      { label: 'Plus tard', value: false },
      { label: 'Installer maintenant', value: true, primary: true },
    ],
  });
  if (!choice) return;
  if (app.doc && app.dirty && !(await saveProject())) return toast('Mise à jour annulée : projet non enregistré', 'warn');
  const pr = progress('Mise à jour d’Animotion');
  pr.set(0.3, 'Téléchargement de la nouvelle version…');
  try {
    await T.core.invoke('install_update', { url: asset.browser_download_url });
    pr.set(1, 'Redémarrage…');
  } catch (e) {
    pr.close();
    toast('La mise à jour a échoué : ' + e, 'error', 6000);
  }
}
