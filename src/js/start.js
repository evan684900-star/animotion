import { app } from './state.js';
import { el, escapeHtml, baseName } from './util.js';
import { icon, LOGO } from './icons.js';
import { SIZE_PRESETS } from './palettes.js';
import { createProject, openProject, getRecents } from './actions.js';
import { isTauri } from './platform.js';
import { toast } from './dialogs.js';
import { importSpriteScript } from './sprites.js';
import { FORMATS } from './montage/model.js';

const root = document.getElementById('startScreen');

export function hideStart() {
  root.classList.add('hidden');
  root.innerHTML = '';
}

// ---------------------------------------------------------- Faisceau lumineux
// Large en haut (coins de l'écran), il se resserre sur les cartes puis descend en colonne.
function drawBeam() {
  if (root.classList.contains('hidden')) return;
  const target = root.querySelector('.start-cards, .start-config');
  let svg = root.querySelector('.start-beam');
  if (!target) return svg?.remove();
  const W = root.clientWidth, H = Math.max(root.clientHeight, root.scrollHeight);
  const r = target.getBoundingClientRect();
  const top = r.top + root.scrollTop, bottom = r.bottom + root.scrollTop;
  const gw = r.width;
  const L1 = r.left + gw * 0.17, R1 = r.right - gw * 0.17; // resserrement au niveau du haut des cartes
  const L2 = r.left + gw * 0.27, R2 = r.right - gw * 0.27; // colonne sous les cartes
  const pts = [[-W * 0.12, -260], [W * 1.12, -260], [R1, top], [R2, bottom], [R2, H], [L2, H], [L2, bottom], [L1, top]];
  const poly = pts.map((p) => p.map(Math.round).join(',')).join(' ');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('start-beam');
    root.prepend(svg);
  }
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="beamFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity=".24"/>
        <stop offset="${(top / H).toFixed(3)}" stop-color="var(--accent)" stop-opacity=".11"/>
        <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient>
      <filter id="beamSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="55"/></filter>
    </defs>
    <polygon points="${poly}" fill="url(#beamFill)" filter="url(#beamSoft)"/>`;
}
window.addEventListener('resize', () => requestAnimationFrame(drawBeam));

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
    mk('pixel', 'pixel', 'Pixel art', 'Animation pixel par pixel sur une vraie grille, à la taille que tu veux. Parfait pour des sprites de jeu.', ['Grille', 'Taille libre', 'Sprites']),
    mk('montage', 'clap', 'Montage', 'Montage vidéo multipiste : vidéos, musique, textes, transitions, effets, filtres… puis export MP4.', ['Vidéo', 'Multipiste', 'MP4'])
  );
  wrap.appendChild(cards);

  const foot = el('div', 'start-foot');
  const open = el('button', 'btn', icon('open', 16) + ' Ouvrir un projet…');
  open.onclick = () => openProject();
  foot.appendChild(open);
  const script = el('button', 'btn', icon('code', 16) + ' Depuis un script .js…');
  script.title = 'Créer un projet pixel à partir de sprites écrits en texte dans un fichier .js';
  script.onclick = () => importSpriteScript();
  foot.appendChild(script);
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
  requestAnimationFrame(drawBeam);

  function config(mode) {
    if (mode === 'montage') return montageConfig();
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
    requestAnimationFrame(drawBeam);
    setTimeout(() => wI.focus(), 30);
  }

  function montageConfig() {
    let fmt = FORMATS[0];
    const panel = el('div', 'start-config');
    panel.innerHTML = `
      <button class="btn ghost back">${icon('left', 16)} Retour</button>
      <div class="cfg-title">${icon('clap', 28)}<h2>Nouveau montage vidéo</h2></div>
      <div class="cfg-formats"></div>
      <div class="cfg-row">
        <label><span>Images par seconde</span><select name="fps"><option value="24">24 (cinéma)</option><option value="25">25</option><option value="30" selected>30 (standard)</option><option value="50">50</option><option value="60">60 (fluide)</option></select></label>
      </div>
      <p class="cfg-hint">Tu pourras changer le format à tout moment dans les réglages du projet (panneau de droite).</p>
      <button class="btn primary big create">Créer le montage ${icon('right', 16)}</button>`;
    const grid = panel.querySelector('.cfg-formats');
    for (const f of FORMATS) {
      const [name, w, h, desc] = f;
      const k = 30 / Math.max(w, h);
      const b = el('button', 'cfg-format' + (f === fmt ? ' active' : ''), `<i style="--w:${Math.round(w * k)}px;--h:${Math.round(h * k)}px"></i><div><b>${name}</b><span>${escapeHtml(desc)}</span></div>`);
      b.title = `${w} × ${h} px`;
      b.onclick = () => {
        fmt = f;
        grid.querySelectorAll('.cfg-format').forEach((x) => x.classList.toggle('active', x === b));
      };
      b.ondblclick = () => go();
      grid.appendChild(b);
    }
    const go = async () => {
      const { openMontage } = await import('./montage/index.js');
      if (await openMontage(null, { width: fmt[1], height: fmt[2], fps: +panel.querySelector('[name=fps]').value })) {
        toast(`Nouveau montage ${fmt[0]} prêt ! Importe tes vidéos, images et musiques 🎬`);
      }
    };
    panel.querySelector('.back').onclick = () => showStart(cancellable);
    panel.querySelector('.create').onclick = go;
    wrap.innerHTML = '';
    wrap.appendChild(panel);
    requestAnimationFrame(drawBeam);
  }
}
