// Mises à jour automatiques depuis les releases GitHub
import { isTauri } from './platform.js';
import { modal, toast, progress } from './dialogs.js';
import { escapeHtml } from './util.js';
import { app, store } from './state.js';
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

// ---------------------------------------------------------- « Quoi de neuf ? » après une mise à jour
function notesToHtml(md) {
  const out = [];
  let list = false;
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim();
    const close = () => list && (out.push('</ul>'), (list = false));
    if (!line) { close(); continue; }
    if (line.startsWith('### ')) { close(); out.push(`<h4>${escapeHtml(line.slice(4))}</h4>`); }
    else if (/^[-*] /.test(line)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${escapeHtml(line.slice(2))}</li>`); }
    else { close(); out.push(`<p>${escapeHtml(line)}</p>`); }
  }
  if (list) out.push('</ul>');
  return out.join('');
}

/** À lancer au démarrage : si la version a changé depuis le dernier lancement, affiche les nouveautés. */
export async function showWhatsNew() {
  if (!isTauri) return false;
  const cur = await currentVersion();
  let last = store('lastVersion');
  store('lastVersion', cur);
  // Pas de version mémorisée mais tutoriel déjà vu : on vient d'une version d'avant les notes → on montre l'actuelle
  const unknownPrev = !last && store('tutoDone');
  if (unknownPrev) last = '0';
  if (!last || last === cur || !newer(cur, last)) return false;
  let releases = [];
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.ok) releases = await r.json();
  } catch {}
  // toutes les versions manquées : plus récentes que l'ancienne, jusqu'à l'actuelle
  const missed = releases
    .filter((r) => /^v\d/.test(r.tag_name) && newer(r.tag_name, last) && !newer(r.tag_name, cur))
    .sort((a, b) => (newer(a.tag_name, b.tag_name) ? -1 : 1))
    .slice(0, unknownPrev ? 1 : 10);
  const body = missed.length
    ? missed.map((r) => `<div class="wn-version"><span class="wn-tag">${escapeHtml(r.tag_name.replace(/^v/, ''))}</span>${notesToHtml(r.body)}</div>`).join('')
    : '<p>Petites améliorations et corrections.</p>';
  await modal({
    title: `Animotion a été mis à jour en ${cur} 🎉`,
    content: `<div class="whatsnew">${body}</div>`,
    buttons: [{ label: 'Super, merci !', value: true, primary: true }],
  });
  return true;
}
