import { app, on, curLayer, store, refreshUI } from './state.js';
import { el, escapeHtml, baseName } from './util.js';
import { icon } from './icons.js';
import * as A from './actions.js';
import * as Tl from './tools.js';
import { undo, redo, canUndo, canRedo } from './history.js';
import { zoomStep, fitView, setZoom, requestRender, gridStep } from './view.js';
const rr = () => { requestRender(); refreshUI(); };
// modifie un réglage de grille, le mémorise et redessine
const setGrid = (k, v) => {
  app.grid[k] = v;
  try { localStorage.setItem('animotion.grid', JSON.stringify(app.grid)); } catch {}
  rr();
};
function colorInput(value, onchange) {
  const c = el('input');
  c.type = 'color';
  c.value = value;
  c.oninput = () => onchange(c.value, false);
  c.onchange = () => onchange(c.value, true);
  return c;
}
import { PALETTES, ACCENTS } from './palettes.js';
import { toggleFullscreen, isTauri } from './platform.js';
import { showShortcuts, showTutorial, showAbout, showClaudeHelp } from './help.js';
import { checkForUpdate } from './update.js';
import { importSpriteScript } from './sprites.js';
import { discordSettings, setDiscord, discordAvailable } from './discord.js';
import { showMcpSetup } from './mcp.js';
import { ghostSettings, setGhost } from './ghost.js';
import { showExportDialog } from './exportdialog.js';
import { showImageAdjust } from './imageedit.js';
import { layout, toggleLayout, setUiScale, resetLayout } from './layout.js';

const TABS = [
  ['fichier', 'Fichier'], ['accueil', 'Accueil'], ['grille', 'Grille'], ['calques', 'Calques'], ['animation', 'Animation'],
  ['rendu', 'Rendu'], ['presets', 'Presets'], ['affichage', 'Affichage'], ['aide', 'Aide'],
];
let current = store('tab') || 'accueil';

const B = (ic, label, act, o = {}) => ({ type: 'btn', icon: ic, label, act, ...o });
const N = (fn) => ({ type: 'node', fn });

function field(label, input) {
  const w = el('label', 'rfield');
  w.append(el('span', null, escapeHtml(label)), input);
  return w;
}
function select(options, value, onchange) {
  const s = el('select');
  for (const [v, l] of options) {
    const o = el('option', null, escapeHtml(l));
    o.value = v;
    if (String(v) === String(value)) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => onchange(s.value);
  return s;
}
function number(value, min, max, onchange, step = 1) {
  const i = el('input');
  Object.assign(i, { type: 'number', value, min, max, step });
  i.onchange = () => onchange(Number(i.value));
  return i;
}
function check(label, value, onchange) {
  const w = el('label', 'rcheck');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = value;
  i.onchange = () => onchange(i.checked);
  w.append(i, el('span', null, escapeHtml(label)));
  return w;
}
function stack(...nodes) {
  const s = el('div', 'rstack');
  s.append(...nodes);
  return s;
}

export function sizeControl() {
  const isPixel = app.mode === 'pixel';
  const v = isPixel ? app.pixelSize : app.vectorSize;
  const wrap = el('div', 'size-ctl');
  const r = el('input');
  Object.assign(r, { type: 'range', min: isPixel ? 1 : 0.5, max: isPixel ? 16 : 80, step: isPixel ? 1 : 0.5, value: v });
  const n = el('input');
  Object.assign(n, { type: 'number', min: isPixel ? 1 : 0.5, max: isPixel ? 64 : 200, step: isPixel ? 1 : 0.5, value: v });
  r.oninput = () => {
    A.setSize(Number(r.value));
    n.value = r.value;
  };
  n.onchange = () => {
    A.setSize(Number(n.value));
    r.value = n.value;
  };
  wrap.append(r, n, el('span', 'unit', 'px'));
  return wrap;
}

export function colorPair() {
  const w = el('div', 'colorpair');
  const mk = (cls, val, sec) => {
    const transp = val === 'transparent';
    const lab = el('label', cls + (transp ? ' is-transparent' : ''));
    if (!transp) lab.style.background = val;
    lab.title = (sec ? 'Couleur secondaire (clic droit pour dessiner avec)' : 'Couleur principale') + (transp ? ' — transparent (efface)' : '');
    const i = el('input');
    i.type = 'color';
    i.value = transp ? '#000000' : val;
    i.onchange = () => A.setColor(i.value, sec);
    lab.appendChild(i);
    return lab;
  };
  const sw = el('button', 'swap-btn', icon('swap', 14));
  sw.title = 'Inverser les couleurs (X)';
  sw.onclick = A.swapColors;
  w.append(mk('cp2', app.color2, true), mk('cp1', app.color, false), sw);
  return w;
}

function groups(tab) {
  const isPixel = app.mode === 'pixel';
  const layer = curLayer();
  switch (tab) {
    case 'fichier':
      return [
        { title: 'Projet', items: [
          B('new', 'Nouveau', A.newProject, { tip: 'Ctrl+N' }), B('open', 'Ouvrir', () => A.openProject(), { tip: 'Ctrl+O' }),
          B('save', 'Enregistrer', () => A.saveProject(), { tip: 'Ctrl+S' }), B('saveas', 'Enregistrer sous', () => A.saveProject(true), { tip: 'Ctrl+Maj+S' }),
        ] },
        { title: 'Récents', items: [N(() => {
          const list = A.getRecents();
          const box = el('div', 'recent-list');
          if (!isTauri) box.appendChild(el('span', 'muted', 'Disponible dans l’appli Windows'));
          else if (!list.length) box.appendChild(el('span', 'muted', 'Aucun fichier récent'));
          for (const p of list.slice(0, 4)) {
            const b = el('button', 'link-btn', icon('recent', 14) + ' ' + escapeHtml(baseName(p)));
            b.title = p;
            b.onclick = () => A.openProject(p);
            box.appendChild(b);
          }
          return box;
        })] },
        { title: 'Importer', items: [B('image', 'Image', A.importImage), B('sheet', 'Spritesheet', A.importSpritesheet), B('wand', 'Depuis Claude', showClaudeHelp, { tip: 'Coller une animation créée par Claude' }), B('code', 'Script .js', () => importSpriteScript(), { tip: 'Sprites décrits en texte, ex. ["..##..", ".####."] — ou glisse le fichier sur la fenêtre' })] },
        { title: 'Exporter', items: [B('export', 'Exporter…', () => showExportDialog(), { tip: 'Ctrl+E' }), B('gif', 'GIF animé', () => showExportDialog('gif'))] },
        { title: 'Montage', items: [B('clap', 'Envoyer au montage', () => import('./montage/index.js').then((m) => m.sendToMontage()), { tip: 'Met cette animation dans un montage vidéo : musique, textes, transitions, effets… puis export MP4' })] },
      ];
    case 'accueil':
      return [
        { title: 'Outils', items: Tl.toolsFor(app.mode).map((t) => {
          const d = Tl.TOOL_DEFS[t];
          return B(d.icon, d.label, () => Tl.setTool(t), { active: app.tool === t, tip: d.key });
        }) },
        { title: 'Couleurs', items: [N(colorPair)] },
        { title: 'Image', items: [
          B('image', 'Importer', () => A.importImage(), { tip: 'Ajouter une image (ou glisse-la sur la fenêtre)' }),
          B('palette', 'Modifier l’image', showImageAdjust, { tip: isPixel ? 'Luminosité, couleurs, effet pixel art… sur la sélection ou la frame' : 'Luminosité, couleurs… sur l’image sélectionnée avec le Pointeur' }),
        ] },
        { title: 'Édition', items: [
          B('undo', 'Annuler', undo, { disabled: !canUndo(), tip: 'Ctrl+Z' }), B('redo', 'Rétablir', redo, { disabled: !canRedo(), tip: 'Ctrl+Y' }),
          B('copy', 'Copier', () => Tl.copySel(), { tip: 'Ctrl+C' }), B('cut', 'Couper', Tl.cutSel, { tip: 'Ctrl+X' }),
          B('paste', 'Coller', Tl.paste, { tip: 'Ctrl+V' }), B('trash', 'Supprimer', Tl.deleteSel, { tip: 'Suppr' }),
        ] },
        { title: 'Transformer', items: [
          B('flipH', 'Miroir H', () => Tl.transform('flipH'), { tip: 'Maj+H' }), B('flipV', 'Miroir V', () => Tl.transform('flipV'), { tip: 'Maj+V' }),
          B('rotCW', 'Rotation ↻', () => Tl.transform('rotCW')), B('rotCCW', 'Rotation ↺', () => Tl.transform('rotCCW')),
        ] },
        { title: 'Pinceau', items: [N(() => stack(
          field('Taille', sizeControl()),
          check('Formes pleines (couleur 2)', app.fillShapes, (v) => { app.fillShapes = v; }),
          ...(isPixel ? [] : [check('Lissage du trait', app.smoothing, (v) => { app.smoothing = v; })])
        ))] },
      ];
    case 'grille': {
      const g = app.grid;
      const auto = isPixel ? null : Math.round(gridStep());
      return [
        { title: 'Affichage', items: [
          B('grid', app.showGrid ? 'Affichée' : 'Masquée', () => A.toggle('showGrid'), { active: app.showGrid, tip: 'Ctrl+G' }),
          B(g.style === 'dots' ? 'pixel' : 'grid', g.style === 'dots' ? 'Style : points' : 'Style : lignes', () => setGrid('style', g.style === 'dots' ? 'lines' : 'dots'), { tip: 'Cliquer pour alterner lignes / points' }),
          B('sheet', 'Damier', () => setGrid('checker', !g.checker), { active: g.checker }),
          ...(g.checker ? [] : [N(() => stack(field('Fond', colorInput(g.bg, (v, fin) => { g.bg = v; if (fin) setGrid('bg', v); else requestRender(); }))))]),
        ] },
        { title: 'Espacement', items: isPixel ? [
          B('pixel', 'Pixels', () => setGrid('pixelLines', !g.pixelLines), { active: g.pixelLines }),
          N(() => stack(
            field('Grande grille tous les', number(app.gridMajor, 0, 512, (v) => { app.gridMajor = Math.max(0, Math.round(v) || 0); rr(); })),
          )),
          N(() => {
            const row = el('div', 'chip-row');
            for (const n of [4, 8, 16, 32]) {
              const c = el('button', 'chip' + (app.gridMajor === n ? ' active' : ''), n + ' px');
              c.onclick = () => { app.gridMajor = n; rr(); };
              row.appendChild(c);
            }
            return stack(el('span', 'muted', 'Raccourcis'), row);
          }),
        ] : [
          N(() => stack(
            field('Pas de la grille (0 = auto)', number(g.step, 0, 2000, (v) => setGrid('step', Math.max(0, Math.round(v) || 0)))),
            el('span', 'muted', g.step ? `Une case = ${g.step} px` : `Automatique : ${auto} px à ce zoom`),
          )),
          N(() => stack(field('Grande ligne toutes les', number(g.subdiv, 1, 32, (v) => setGrid('subdiv', Math.max(1, Math.round(v) || 1)))), el('span', 'muted', 'cases'))),
        ] },
        { title: 'Couleurs', items: [N(() => {
          const major = colorInput(g.majorColor || app.accent, (v, fin) => { g.majorColor = v; if (fin) setGrid('majorColor', v); else requestRender(); });
          const reset = el('button', 'mini-btn', 'Accent');
          reset.title = 'Utiliser la couleur d’accent';
          reset.onclick = () => setGrid('majorColor', '');
          const mrow = el('div', 'size-ctl');
          mrow.append(major, reset);
          return stack(
            field('Petites lignes', colorInput(g.color, (v, fin) => { g.color = v; if (fin) setGrid('color', v); else requestRender(); })),
            field('Grandes lignes', mrow),
          );
        }), N(() => {
          const op = el('input');
          Object.assign(op, { type: 'range', min: 5, max: 100, value: g.opacity });
          const ov = el('span', 'val', g.opacity + ' %');
          op.oninput = () => { g.opacity = Number(op.value); ov.textContent = op.value + ' %'; requestRender(); };
          op.onchange = () => setGrid('opacity', Number(op.value));
          const w = el('div', 'size-ctl');
          w.append(op, ov);
          return stack(el('span', 'muted', 'Opacité'), w);
        })] },
        ...(isPixel ? [] : [{ title: 'Magnétisme', items: [
          B('wand', g.snap ? 'Aimanté' : 'Libre', () => setGrid('snap', !g.snap), { active: g.snap, tip: 'Les formes et les points s’accrochent à la grille' }),
        ] }]),
        { title: 'Canevas', items: [B('resize', 'Taille…', () => A.resizeCanvasDialog())] },
      ];
    }
    case 'calques':
      return [
        { title: 'Calques', items: [
          B('layerAdd', 'Nouveau', A.addLayer), B('dup', 'Dupliquer', A.duplicateLayer),
          B('trash', 'Supprimer', A.deleteLayer, { disabled: app.doc.layers.length < 2 }), B('merge', 'Fusionner ↓', A.mergeDown, { disabled: app.layerIndex === 0 }),
        ] },
        { title: 'Ordre', items: [
          B('up', 'Monter', () => A.moveLayer(1), { disabled: app.layerIndex >= app.doc.layers.length - 1 }),
          B('down', 'Descendre', () => A.moveLayer(-1), { disabled: app.layerIndex === 0 }),
        ] },
        { title: 'Propriétés', items: [
          B('rename', 'Renommer', () => A.renameLayer()),
          B(layer.visible ? 'eye' : 'eyeOff', layer.visible ? 'Visible' : 'Masqué', () => A.toggleLayerProp(app.layerIndex, 'visible'), { active: !layer.visible }),
          B(layer.locked ? 'lock' : 'unlock', layer.locked ? 'Verrouillé' : 'Libre', () => A.toggleLayerProp(app.layerIndex, 'locked'), { active: layer.locked }),
          N(() => {
            const r = el('input');
            Object.assign(r, { type: 'range', min: 0, max: 100, value: Math.round(layer.opacity * 100) });
            const v = el('span', 'val', Math.round(layer.opacity * 100) + ' %');
            r.oninput = () => { A.setLayerOpacity(r.value / 100); v.textContent = r.value + ' %'; };
            r.onchange = () => A.setLayerOpacity(r.value / 100, true);
            const w = el('div', 'size-ctl');
            w.append(r, v);
            return stack(field('Opacité — ' + layer.name, w));
          }),
        ] },
      ];
    case 'animation':
      return [
        { title: 'Frames', items: [
          B('plus', 'Nouvelle', A.addFrame, { tip: 'N' }), B('dup', 'Dupliquer', A.duplicateFrame, { tip: 'Maj+N' }),
          B('trash', 'Supprimer', A.deleteFrame, { disabled: app.doc.frames.length < 2 }),
          B('left', 'Déplacer ←', () => A.moveFrame(-1), { disabled: app.frameIndex === 0 }),
          B('right', 'Déplacer →', () => A.moveFrame(1), { disabled: app.frameIndex >= app.doc.frames.length - 1 }),
        ] },
        { title: 'Lecture', items: [
          B('first', 'Début', () => A.setFrame(0)), B('prev', 'Préc.', () => A.setFrame(app.frameIndex - 1), { tip: ',' }),
          B(app.playing ? 'pause' : 'play', app.playing ? 'Pause' : 'Lecture', A.togglePlay, { active: app.playing, tip: 'Entrée' }),
          B('next', 'Suiv.', () => A.setFrame(app.frameIndex + 1), { tip: '.' }), B('last', 'Fin', () => A.setFrame(app.doc.frames.length - 1)),
        ] },
        { title: 'Timing', items: [N(() => stack(
          field('Images / seconde', number(app.doc.fps, 1, 60, A.setFps)),
          field('Mode', select([['loop', 'Boucle'], ['pingpong', 'Ping-pong'], ['once', 'Une fois']], app.playMode, (v) => { app.playMode = v; })),
        )), B('clock', 'Durée frame', () => A.setFrameDuration())] },
        { title: 'Pelure d’oignon', items: [
          B('onion', app.onion.enabled ? 'Activée' : 'Désactivée', A.toggleOnion, { active: app.onion.enabled, tip: 'U' }),
          N(() => stack(
            field('Frames avant (rouge)', number(app.onion.before, 0, 5, (v) => { app.onion.before = Math.max(0, Math.min(5, v | 0)); rr(); })),
            field('Frames après (bleu)', number(app.onion.after, 0, 5, (v) => { app.onion.after = Math.max(0, Math.min(5, v | 0)); rr(); })),
          )),
        ] },
      ];
    case 'rendu':
      return [
        { title: 'Exporter', items: [
          B('export', 'Exporter…', () => showExportDialog(), { tip: 'Ctrl+E — toutes les options d’export' }),
          B('gif', 'GIF animé', () => showExportDialog('gif')), B('film', 'Vidéo', () => showExportDialog('video')),
          B('image', 'Image PNG', () => showExportDialog('png')), B('zip', 'Frames (.zip)', () => showExportDialog('zip')),
          B('sheet', 'Spritesheet', () => showExportDialog('sheet')),
        ] },
      ];
    case 'presets':
      return [
        { title: 'Canevas', items: [
          B('resize', 'Taille…', () => A.resizeCanvasDialog()),
          N(() => stack(field('Tailles prédéfinies', select([['', 'Choisir…'], ...A.sizePresets().map((p, i) => [i, p[0]])], '', (v) => {
            if (v === '') return;
            const p = A.sizePresets()[v];
            A.resizeCanvasDialog(p[1], p[2]);
          })))),
        ] },
        { title: 'Palettes', items: [N(() => {
          const box = el('div', 'palette-presets');
          for (const [name, p] of Object.entries(PALETTES)) {
            const b = el('button', 'pal-preset' + (app.paletteName === name ? ' active' : ''));
            b.innerHTML = `<span class="strip">${p.colors.slice(0, 8).map((c) => `<i style="background:${c}"></i>`).join('')}</span><span>${escapeHtml(name)}</span>`;
            b.onclick = () => A.loadPalette(name);
            box.appendChild(b);
          }
          return box;
        })] },
        { title: 'Pinceaux', items: [B('star', 'Enregistrer', A.saveBrush), N(() => {
          const box = el('div', 'brush-list');
          const list = A.getBrushes();
          if (!list.length) box.appendChild(el('span', 'muted', 'Enregistre ton pinceau actuel pour le retrouver ici'));
          list.forEach((b, i) => {
            const btn = el('button', 'chip' + (b.mode !== app.mode ? ' off' : ''), `<i style="background:${b.color}"></i>${escapeHtml(b.name)}`);
            btn.title = 'Clic : utiliser — Clic droit : supprimer';
            btn.onclick = () => A.applyBrush(b);
            btn.oncontextmenu = (e) => { e.preventDefault(); A.deleteBrush(i); };
            box.appendChild(btn);
          });
          return box;
        })] },
      ];
    case 'affichage':
      return [
        { title: 'Zoom', items: [
          B('zoomIn', 'Zoom +', () => zoomStep(1), { tip: 'Ctrl++' }), B('zoomOut', 'Zoom −', () => zoomStep(-1), { tip: 'Ctrl+-' }),
          B('fit', 'Ajuster', fitView, { tip: 'Ctrl+0' }), B('one', '100 %', () => setZoom(1), { tip: 'Ctrl+1' }),
        ] },
        { title: 'Repères', items: [
          B('ruler', 'Règles', () => A.toggle('showRulers'), { active: app.showRulers, tip: 'Ctrl+R' }),
        ] },
        { title: 'Fenêtre', items: [B('full', 'Plein écran', toggleFullscreen, { tip: 'F11' })] },
        { title: 'Interface', items: [
          B('zoomOut', 'Plus petit', () => setUiScale(layout.ui - 0.1), { tip: 'Ctrl+Maj+-' }),
          N(() => {
            const b = el('button', 'rbtn ui-scale', `<b style="font-size:15px;line-height:22px">${Math.round(layout.ui * 100)} %</b><span>Taille</span>`);
            b.title = 'Revenir à 100 % (Ctrl+Maj+0)';
            b.onclick = () => setUiScale(1);
            return b;
          }),
          B('zoomIn', 'Plus grand', () => setUiScale(layout.ui + 0.1), { tip: 'Ctrl+Maj++' }),
          B('layers', 'Panneau', () => toggleLayout('showSide'), { active: layout.showSide }),
          B('film', 'Timeline', () => toggleLayout('showTl'), { active: layout.showTl }),
          B('up', 'Ruban', () => toggleLayout('ribbon'), { active: layout.ribbon, tip: 'Ctrl+F1' }),
          B('resize', 'Réinitialiser', resetLayout),
        ] },
        { title: 'Couleur d’accent', items: [N(() => {
          const box = el('div', 'accent-list');
          for (const c of ACCENTS) {
            const b = el('button', 'accent-sw' + (app.accent === c ? ' active' : ''));
            b.style.background = c;
            b.onclick = () => A.setAccent(c);
            box.appendChild(b);
          }
          return box;
        })] },
      ];
    case 'aide':
      return [
        { title: 'Claude', items: [
          B('wand', 'Demander à Claude', showClaudeHelp, { tip: 'Faire créer une animation par Claude et la coller ici' }),
          B('plug', 'Connecter Claude Desktop', showMcpSetup, { tip: 'Laisser Claude Desktop piloter Animotion' }),
          B('pointer', ghostSettings.enabled ? 'Actions visibles' : 'Actions cachées', () => { setGhost('enabled', !ghostSettings.enabled); refreshUI(); }, {
            active: ghostSettings.enabled, tip: 'Montrer la souris de Claude quand il agit (sinon tout apparaît d’un coup)',
          }),
          N(() => stack(field('Vitesse', select([['rapide', 'Rapide'], ['normale', 'Normale'], ['lente', 'Lente']], ghostSettings.speed, (v) => setGhost('speed', v))))),
        ] },
        { title: 'Aide', items: [B('keyboard', 'Raccourcis', showShortcuts, { tip: 'F1' }), B('book', 'Tutoriel', showTutorial), B('info', 'À propos', showAbout), B('import', 'Mises à jour', () => checkForUpdate(false))] },
        { title: 'Discord', items: [
          B('discord', discordSettings.enabled ? 'Statut Discord' : 'Discord coupé', () => setDiscord('enabled', !discordSettings.enabled), {
            active: discordSettings.enabled && discordAvailable(), tip: 'Afficher « Joue à Animotion » sur ton profil Discord',
          }),
          B(discordSettings.showName ? 'eye' : 'eyeOff', discordSettings.showName ? 'Nom visible' : 'Nom caché', () => setDiscord('showName', !discordSettings.showName), {
            active: discordSettings.showName, disabled: !discordSettings.enabled, tip: 'Montrer ou cacher le nom du projet sur Discord',
          }),
        ] },
      ];
  }
  return [];
}

const TAB_IDS = TABS.map((t) => t[0]);
let slideDir = 0; // -1 : vers la gauche, +1 : vers la droite
let indicator = null;

function moveIndicator(animate) {
  const bar = document.getElementById('tabbar');
  const btn = bar.querySelector('.tab.active');
  if (!btn || !indicator) return;
  indicator.style.transition = animate ? '' : 'none';
  indicator.style.transform = `translateX(${btn.offsetLeft + 12}px)`;
  indicator.style.width = Math.max(0, btn.offsetWidth - 24) + 'px';
  if (!animate) void indicator.offsetWidth;
  indicator.style.transition = '';
}

function renderTabs() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = '';
  for (const [id, label] of TABS) {
    const b = el('button', 'tab' + (id === current ? ' active' : '') + (id === 'fichier' ? ' file' : ''), label);
    b.onclick = () => {
      if (current === id && layout.ribbon) return;
      slideDir = Math.sign(TAB_IDS.indexOf(id) - TAB_IDS.indexOf(current));
      current = id;
      store('tab', id);
      if (!layout.ribbon) toggleLayout('ribbon');
      render();
    };
    b.ondblclick = () => toggleLayout('ribbon');
    bar.appendChild(b);
  }
  // barre bleue qui glisse d'un onglet à l'autre
  if (!indicator) indicator = el('div', 'tab-indicator');
  bar.appendChild(indicator);
  const animate = slideDir !== 0;
  requestAnimationFrame(() => moveIndicator(animate));
  let xb = document.getElementById('exportTop');
  if (!xb) {
    xb = el('button', 'export-top', icon('export', 15) + '<span>Exporter</span>');
    xb.id = 'exportTop';
    xb.title = 'Exporter en GIF, vidéo, PNG… (Ctrl+E)';
    xb.onclick = () => showExportDialog();
    document.getElementById('tabs').insertBefore(xb, document.querySelector('.ribbon-toggle'));
  }
  xb.style.display = app.doc ? '' : 'none';
  const badge = document.getElementById('modeBadge');
  if (app.doc) badge.innerHTML = `${icon(app.mode === 'pixel' ? 'pixel' : 'brush', 14)} ${app.mode === 'pixel' ? 'Pixel art' : 'Dessin vectoriel'} · ${app.doc.width} × ${app.doc.height}`;
}

function render() {
  renderTabs();
  const body = document.getElementById('ribbonBody');
  const scroll = body.scrollLeft;
  body.innerHTML = '';
  body.classList.remove('slide-left', 'slide-right');
  if (slideDir) {
    void body.offsetWidth;
    body.classList.add(slideDir > 0 ? 'slide-right' : 'slide-left');
    slideDir = 0;
  }
  if (!app.doc) return;
  for (const g of groups(current)) {
    const ge = el('div', 'rgroup');
    const items = el('div', 'rgroup-items');
    for (const it of g.items) {
      if (it.type === 'node') {
        items.appendChild(it.fn());
        continue;
      }
      const b = el('button', 'rbtn' + (it.active ? ' active' : ''), icon(it.icon, 22) + `<span>${escapeHtml(it.label)}</span>`);
      b.title = it.label + (it.tip ? ` (${it.tip})` : '');
      b.disabled = !!it.disabled;
      b.onclick = () => it.act();
      items.appendChild(b);
    }
    ge.append(items, el('div', 'rgroup-title', escapeHtml(g.title)));
    body.appendChild(ge);
  }
  body.scrollLeft = scroll;
}

export function initRibbon() {
  on('ui', render);
  window.addEventListener('resize', () => moveIndicator(false));
  render();
}
