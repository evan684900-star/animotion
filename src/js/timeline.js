import { app, on } from './state.js';
import { el, escapeHtml } from './util.js';
import { icon } from './icons.js';
import * as A from './actions.js';
import { layout, setLayout, makeResizer } from './layout.js';

const root = el('div', 'tl-inner');
root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
document.getElementById('timeline').appendChild(root);

function btn(ic, title, fn, cls = '') {
  const b = el('button', 'icon-btn ' + cls, icon(ic, 16));
  b.title = title;
  b.onclick = fn;
  return b;
}

function render() {
  const d = app.doc;
  if (!d) {
    root.innerHTML = '';
    return;
  }
  const oldScroll = root.querySelector('.tl-scroll');
  const sl = oldScroll?.scrollLeft || 0, st = oldScroll?.scrollTop || 0;
  root.innerHTML = '';

  // --- barre de contrôle
  const c = el('div', 'tl-controls');
  c.append(
    btn('first', 'Première frame', () => A.setFrame(0)),
    btn('prev', 'Frame précédente (,)', () => A.setFrame(app.frameIndex - 1)),
    btn(app.playing ? 'pause' : 'play', 'Lecture / pause (Entrée)', A.togglePlay, 'play' + (app.playing ? ' on' : '')),
    btn('next', 'Frame suivante (.)', () => A.setFrame(app.frameIndex + 1)),
    btn('last', 'Dernière frame', () => A.setFrame(d.frames.length - 1)),
    el('span', 'tl-sep'),
    btn('plus', 'Nouvelle frame (N)', A.addFrame),
    btn('dup', 'Dupliquer la frame (Maj+N)', A.duplicateFrame),
    btn('trash', 'Supprimer la frame', A.deleteFrame),
    el('span', 'tl-sep'),
    btn('onion', 'Pelure d’oignon (U)', A.toggleOnion, app.onion.enabled ? 'on' : ''),
    btn('loop', { loop: 'Mode : boucle', pingpong: 'Mode : ping-pong', once: 'Mode : une fois' }[app.playMode] + ' (cliquer pour changer)', () => {
      app.playMode = { loop: 'pingpong', pingpong: 'once', once: 'loop' }[app.playMode];
      render();
    }, app.playMode !== 'loop' ? 'on' : ''),
  );
  const fps = el('label', 'tl-fps');
  const fi = el('input');
  Object.assign(fi, { type: 'number', min: 1, max: 60, value: d.fps });
  fi.onchange = () => A.setFps(Number(fi.value));
  fps.append(fi, el('span', null, 'FPS'));
  const info = el('span', 'tl-info', `Frame <b>${app.frameIndex + 1}</b> / ${d.frames.length} · ${Math.round(d.duration(app.frameIndex))} ms`);
  info.classList.add('tl-frameinfo');
  const zoom = el('label', 'tl-zoom');
  zoom.title = 'Largeur des frames (Ctrl+molette sur la timeline)';
  const zr = el('input');
  Object.assign(zr, { type: 'range', min: 16, max: 90, value: layout.cell });
  zr.oninput = () => {
    layout.cell = Number(zr.value);
    document.documentElement.style.setProperty('--cell-w', layout.cell + 'px');
  };
  zr.onchange = () => setLayout('cell', Number(zr.value));
  zoom.innerHTML = icon('zoomIn', 15);
  zoom.appendChild(zr);
  c.append(el('span', 'grow'), zoom, info, fps);
  root.appendChild(c);

  // --- grille calques × frames
  const scroll = el('div', 'tl-scroll');
  const table = el('table', 'tl');
  const thead = el('thead');
  const hr = el('tr');
  const corner = el('th', 'lname corner');
  const addL = el('button', 'mini-btn', icon('layerAdd', 14) + ' Calque');
  addL.onclick = A.addLayer;
  const ci = el('div', 'lname-inner');
  ci.appendChild(addL);
  corner.appendChild(ci);
  const rz = el('div', 'rz-lname');
  makeResizer(rz, 'lname', 'x', 1);
  corner.appendChild(rz);
  hr.appendChild(corner);
  d.frames.forEach((f, i) => {
    const th = el('th', 'fnum' + (i === app.frameIndex ? ' cur' : '') + (f.duration ? ' timed' : ''), String(i + 1));
    th.dataset.f = i;
    th.title = `Frame ${i + 1} — ${Math.round(d.duration(i))} ms (double-clic : durée)`;
    th.onclick = () => A.setFrame(i);
    th.ondblclick = () => A.setFrameDuration(i);
    hr.appendChild(th);
  });
  const plusTh = el('th', 'fnum add');
  const plus = el('button', 'mini-btn', icon('plus', 14));
  plus.title = 'Ajouter une frame à la fin';
  plus.onclick = () => {
    A.setFrame(d.frames.length - 1);
    A.addFrame();
  };
  plusTh.appendChild(plus);
  hr.appendChild(plusTh);
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (let li = d.layers.length - 1; li >= 0; li--) {
    const l = d.layers[li];
    const tr = el('tr', li === app.layerIndex ? 'cur' : '');
    const name = el('td', 'lname');
    const eye = btn(l.visible ? 'eye' : 'eyeOff', 'Afficher / masquer', (e) => {
      e.stopPropagation();
      A.toggleLayerProp(li, 'visible');
    }, l.visible ? '' : 'dim');
    const lock = btn(l.locked ? 'lock' : 'unlock', 'Verrouiller / déverrouiller', (e) => {
      e.stopPropagation();
      A.toggleLayerProp(li, 'locked');
    }, l.locked ? 'on' : 'dim');
    const label = el('span', 'lname-text', escapeHtml(l.name));
    label.title = 'Double-clic pour renommer';
    label.ondblclick = () => A.renameLayer(li);
    const op = el('span', 'lop', l.opacity < 1 ? Math.round(l.opacity * 100) + '%' : '');
    const inner = el('div', 'lname-inner');
    inner.append(eye, lock, label, op);
    name.appendChild(inner);
    name.onclick = () => A.setLayer(li);
    tr.appendChild(name);
    d.frames.forEach((f, fi2) => {
      const td = el('td', 'cell' + (fi2 === app.frameIndex ? ' col' : '') + (d.hasContent(l.id, f.id) ? ' has' : ''));
      td.dataset.f = fi2;
      td.onclick = () => {
        A.setLayer(li);
        A.setFrame(fi2);
      };
      tr.appendChild(td);
    });
    tr.appendChild(el('td', 'cell pad'));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  root.appendChild(scroll);
  scroll.scrollLeft = sl;
  scroll.scrollTop = st;
  ensureVisible();
}

function ensureVisible() {
  const scroll = root.querySelector('.tl-scroll');
  const th = root.querySelector(`th.fnum[data-f="${app.frameIndex}"]`);
  if (!scroll || !th) return;
  const nameW = root.querySelector('th.lname')?.offsetWidth || 0;
  const left = th.offsetLeft - nameW, right = th.offsetLeft + th.offsetWidth;
  if (left < scroll.scrollLeft) scroll.scrollLeft = left;
  else if (right > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = right - scroll.clientWidth;
}

// Mise à jour légère pendant la lecture
function updateCurrent() {
  root.querySelectorAll('.cur[data-f], .col').forEach((n) => n.classList.remove('cur', 'col'));
  root.querySelectorAll(`th.fnum[data-f="${app.frameIndex}"]`).forEach((n) => n.classList.add('cur'));
  root.querySelectorAll(`td.cell[data-f="${app.frameIndex}"]`).forEach((n) => n.classList.add('col'));
  const info = root.querySelector('.tl-frameinfo');
  if (info) info.innerHTML = `Frame <b>${app.frameIndex + 1}</b> / ${app.doc.frames.length} · ${Math.round(app.doc.duration(app.frameIndex))} ms`;
  ensureVisible();
}

export function initTimeline() {
  root.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setLayout('cell', layout.cell + (e.deltaY < 0 ? 4 : -4));
  }, { passive: false });
  on('ui', render);
  on('frame', updateCurrent);
}
