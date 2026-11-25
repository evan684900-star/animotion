import { app } from './state.js';
import { el, escapeHtml, baseName } from './util.js';
import { icon, LOGO } from './icons.js';
import { SIZE_PRESETS } from './palettes.js';
import { createProject, openProject, getRecents } from './actions.js';
import { isTauri } from './platform.js';
import { toast } from './dialogs.js';

const root = document.getElementById('startScreen');

export function hideStart() {
  root.classList.add('hidden');
  root.innerHTML = '';
}

export function showStart(cancellable = false) {
  root.classList.remove('hidden');
  root.innerHTML = '';
  const wrap = el('div', 'start');
  wrap.innerHTML = `
    <div class="start-head">
      <div class="start-logo">${LOGO}</div>
      <h1>Animotion</h1>
      <p>Qu’est-ce qu’on anime aujourd’hui ?</p>
    </div>`;
  const cards = el('div', 'start-cards');
  const mk = (mode, ic, title, desc, tags) => {
    const c = el('button', 'start-card');
    c.innerHTML = `<div class="sc-icon">${icon(ic, 44, 1.5)}</div><h2>${title}</h2><p>${desc}</p><div class="sc-tags">${tags.map((t) => `<span>${t}</span>`).join('')}</div>`;
    c.onclick = () => config(mode);
    return c;
  };
  cards.append(
    mk('vector', 'brush', 'Dessin', 'Animation vectorielle : traits lisses, modifiables après coup, zoom infini. Idéal pour du dessin animé.', ['Vectoriel', 'Courbes éditables', 'HD']),
    mk('pixel', 'pixel', 'Pixel art', 'Animation pixel par pixel sur une vraie grille, à la taille que tu veux. Parfait pour des sprites de jeu.', ['Grille', 'Taille libre', 'Sprites'])
  );
  wrap.appendChild(cards);

  const foot = el('div', 'start-foot');
  const open = el('button', 'btn', icon('open', 16) + ' Ouvrir un projet…');
  open.onclick = () => openProject();
  foot.appendChild(open);
  if (cancellable && app.doc) {
    const back = el('button', 'btn ghost', 'Retour au projet');
    back.onclick = hideStart;
    foot.appendChild(back);
  }
  wrap.appendChild(foot);

  const rec = isTauri ? getRecents() : [];
  if (rec.length) {
    const r = el('div', 'start-recents');
    r.appendChild(el('h3', null, 'Récents'));
    for (const p of rec.slice(0, 5)) {
      const b = el('button', 'link-btn', icon('recent', 14) + ' ' + escapeHtml(baseName(p)));
      b.title = p;
      b.onclick = () => openProject(p);
      r.appendChild(b);
    }
    wrap.appendChild(r);
  }
  root.appendChild(wrap);

  function config(mode) {
    const presets = SIZE_PRESETS[mode];
    const def = mode === 'pixel' ? [32, 32] : [1280, 720];
    const panel = el('div', 'start-config');
    panel.innerHTML = `
      <button class="btn ghost back">${icon('left', 16)} Retour</button>
      <div class="cfg-title">${icon(mode === 'pixel' ? 'pixel' : 'brush', 28)}<h2>${mode === 'pixel' ? 'Nouvelle grille pixel art' : 'Nouveau dessin'}</h2></div>
      <div class="cfg-presets"></div>
      <div class="cfg-row">
        <label><span>Largeur</span><input type="number" name="w" min="1" max="8192" value="${def[0]}"></label>
        <span class="times">×</span>
        <label><span>Hauteur</span><input type="number" name="h" min="1" max="8192" value="${def[1]}"></label>
        <label><span>FPS</span><input type="number" name="fps" min="1" max="60" value="12"></label>
      </div>
      <p class="cfg-hint">${mode === 'pixel' ? 'Taille libre : choisis exactement le nombre de pixels de ta grille (max 1024 conseillé).' : 'Taille du cadre de l’animation en pixels (le dessin reste vectoriel).'}</p>
      <button class="btn primary big create">Créer ${icon('right', 16)}</button>`;
    const pres = panel.querySelector('.cfg-presets');
    const wI = panel.querySelector('[name=w]'), hI = panel.querySelector('[name=h]');
    for (const [label, w, h] of presets) {
      const chip = el('button', 'chip', escapeHtml(label));
      chip.onclick = () => {
        wI.value = w;
        hI.value = h;
        pres.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
      };
      if (w === def[0] && h === def[1]) chip.classList.add('active');
      pres.appendChild(chip);
    }
    panel.querySelector('.back').onclick = () => showStart(cancellable);
    const go = () => {
      const w = Math.round(Number(wI.value)), h = Math.round(Number(hI.value));
      const fps = Math.max(1, Math.min(60, Math.round(Number(panel.querySelector('[name=fps]').value)) || 12));
      const max = mode === 'pixel' ? 2048 : 8192;
      if (!(w >= 1 && h >= 1 && w <= max && h <= max)) return toast(`Taille invalide (entre 1 et ${max})`, 'error');
      createProject(mode, w, h, fps);
    };
    panel.querySelector('.create').onclick = go;
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    wrap.innerHTML = '';
    wrap.appendChild(panel);
    setTimeout(() => wI.focus(), 30);
  }
}
