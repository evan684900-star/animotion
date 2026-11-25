import { modal } from './dialogs.js';
import { el } from './util.js';
import { LOGO } from './icons.js';
import { store } from './state.js';

const SHORTCUTS = [
  ['Outils', [
    ['B', 'Crayon / Pinceau'], ['E', 'Gomme'], ['G', 'Remplissage'], ['I', 'Pipette'], ['L', 'Ligne'],
    ['R', 'Rectangle'], ['O', 'Ellipse'], ['M ou V', 'Sélection'], ['X', 'Inverser les couleurs'], ['[ et ]', 'Taille −/+'],
    ['Clic droit', 'Dessiner avec la couleur 2'],
  ]],
  ['Édition', [
    ['Ctrl+Z', 'Annuler'], ['Ctrl+Y / Ctrl+Maj+Z', 'Rétablir'], ['Ctrl+C / X / V', 'Copier / couper / coller'],
    ['Suppr', 'Supprimer la sélection'], ['Ctrl+A', 'Tout sélectionner'], ['Ctrl+D / Échap', 'Désélectionner'],
    ['Flèches', 'Décaler la sélection (Maj : ×10)'], ['H / Maj+H', 'Miroir horizontal / vertical'],
  ]],
  ['Animation', [
    ['Entrée', 'Lecture / pause'], [', et .', 'Frame précédente / suivante'], ['← →', 'Frame précédente / suivante (sans sélection)'],
    ['↑ ↓', 'Calque au-dessus / en dessous (sans sélection)'], ['N', 'Nouvelle frame'], ['Maj+N', 'Dupliquer la frame'], ['U', 'Pelure d’oignon'],
  ]],
  ['Vue & fichiers', [
    ['Molette', 'Zoom'], ['Espace + glisser / clic molette', 'Se déplacer'], ['Ctrl+0', 'Ajuster à l’écran'], ['Ctrl+1', 'Zoom 100 %'],
    ['Ctrl+G', 'Grille'], ['Ctrl+R', 'Règles'], ['F11', 'Plein écran'], ['Ctrl+N / O / S', 'Nouveau / ouvrir / enregistrer'],
    ['Ctrl+Maj+S', 'Enregistrer sous'], ['F1', 'Cette aide'],
  ]],
];

export function showShortcuts() {
  const wrap = el('div', 'shortcuts');
  for (const [title, list] of SHORTCUTS) {
    const s = el('div', 'sc-col');
    s.innerHTML = `<h3>${title}</h3>` + list.map(([k, v]) => `<div class="sc-row"><kbd>${k}</kbd><span>${v}</span></div>`).join('');
    wrap.appendChild(s);
  }
  return modal({ title: 'Raccourcis clavier', content: wrap, wide: true, buttons: [{ label: 'Compris !', value: true, primary: true }] });
}

const STEPS = [
  ['Bienvenue dans Animotion 👋', 'Ici tu peux animer en <b>dessin vectoriel</b> ou en <b>pixel art</b>. Toutes les commandes sont rangées dans les onglets en haut (Fichier, Accueil, Calques…), comme dans Word.'],
  ['Dessiner ✏️', 'Les outils sont à gauche et dans l’onglet <b>Accueil</b>. Le <b>clic droit</b> dessine avec la couleur 2. <b>Molette</b> pour zoomer, <b>Espace + glisser</b> pour te déplacer.'],
  ['Animer 🎞️', 'La <b>timeline</b> en bas : chaque colonne est une frame, chaque ligne un calque. <b>N</b> ajoute une frame, <b>Entrée</b> lance la lecture, <b>U</b> active la pelure d’oignon pour voir les frames voisines en transparence.'],
  ['Exporter 🚀', 'Onglet <b>Rendu</b> : GIF animé, vidéo WebM/MP4, séquence PNG ou spritesheet. Et n’oublie pas <b>Ctrl+S</b> pour sauvegarder ton projet (.animo) !'],
];

export async function showTutorial() {
  for (let i = 0; i < STEPS.length; i++) {
    const [t, body] = STEPS[i];
    const c = el('div', 'tuto');
    c.innerHTML = `<p>${body}</p><div class="dots">${STEPS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>`;
    const last = i === STEPS.length - 1;
    const r = await modal({
      title: t,
      content: c,
      buttons: [
        { label: 'Passer', value: 'skip' },
        { label: last ? 'C’est parti !' : 'Suivant', value: 'next', primary: true },
      ],
    });
    if (r !== 'next') break;
  }
  store('tutoDone', true);
}

export function showAbout() {
  return modal({
    title: 'À propos',
    content: `<div class="about"><div class="about-logo">${LOGO}</div><div><h2>Animotion</h2><p>Version 0.1.0</p><p>Logiciel d’animation dessin & pixel art, en noir et bleu. Fait avec ❤️ et Tauri.</p></div></div>`,
    buttons: [{ label: 'Fermer', value: true, primary: true }],
  });
}
