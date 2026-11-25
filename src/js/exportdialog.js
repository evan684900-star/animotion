// Fenêtre d'export : aperçu animé, échelle / résolution, onglets GIF · PNG · Vidéo · ZIP · Spritesheet
import { app, store } from './state.js';
import { el, escapeHtml, makeCanvas } from './util.js';
import { modal } from './dialogs.js';
import { compositeFrame } from './render.js';
import { commitFloating } from './tools.js';
import * as X from './export.js';

const TABS = [
  ['gif', 'GIF', 'Une image animée qui se lit partout : Discord, sites web, messageries… (256 couleurs maximum).'],
  ['png', 'PNG', 'Une seule frame, en image fixe sans perte de qualité.'],
  ['video', 'Vidéo', 'Une vidéo pour YouTube, TikTok ou un montage. Le fond est toujours opaque.'],
  ['zip', 'ZIP', 'Toutes les frames en images PNG séparées, rangées dans une archive .zip.'],
  ['sheet', 'Spritesheet', 'Toutes les frames côte à côte sur une seule image : idéal pour les jeux vidéo.'],
];

export function showExportDialog(tab = null) {
  if (!app.doc) return;
  commitFloating();
  const d = app.doc;
  const pixel = d.mode === 'pixel';
  const o = X.exportOptions();
  let current = tab || store('exportTab') || 'gif';
  if (!TABS.some((t) => t[0] === current)) current = 'gif';
  let videoKind = store('exportVideo') || (X.videoMime('mp4') ? 'mp4' : 'webm');

  const minS = pixel ? 1 : 0.1, maxS = pixel ? 32 : 8, stepS = pixel ? 1 : 0.1;
  const clampScale = (v) => {
    v = Math.max(minS, Math.min(maxS, +v || 1));
    return pixel ? Math.round(v) : Math.round(v * 100) / 100;
  };
  o.scale = clampScale(o.scale);

  const root = el('div', 'xp');
  root.innerHTML = `
    <div class="xp-preview"><canvas></canvas><div class="xp-pinfo"></div></div>
    <div class="xp-main">
      <h4>Taille</h4>
      <div class="xp-row"><label>Échelle</label><input type="range" class="xp-scale" min="${minS}" max="${maxS}" step="${stepS}"><span class="xp-scalev"></span></div>
      <div class="xp-row"><label>Résolution</label><input type="number" class="xp-w" min="1"><span class="xp-x">×</span><input type="number" class="xp-h" min="1"><span class="muted">px</span></div>
      <h4>Frames et fond</h4>
      <div class="xp-row"><label>Frames</label><span class="muted">de</span><input type="number" class="xp-from" min="1" max="${d.frames.length}"><span class="muted">à</span><input type="number" class="xp-to" min="1" max="${d.frames.length}"><span class="muted">sur ${d.frames.length}</span></div>
      <div class="xp-row"><label>Fond</label><label class="rcheck"><input type="checkbox" class="xp-transp"><span>Transparent</span></label><input type="color" class="xp-bg"></div>
      <div class="xp-tabs"></div>
      <p class="xp-desc"></p>
      <div class="xp-opts"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const scaleIn = $('.xp-scale'), scaleV = $('.xp-scalev'), wIn = $('.xp-w'), hIn = $('.xp-h');
  const fromIn = $('.xp-from'), toIn = $('.xp-to'), transp = $('.xp-transp'), bgIn = $('.xp-bg');

  // --- échelle <-> résolution liées
  const syncSize = () => {
    const [w, h] = X.outSize(o);
    scaleIn.value = o.scale;
    scaleV.textContent = '×' + (pixel ? o.scale : o.scale.toFixed(2).replace(/\.?0+$/, ''));
    if (document.activeElement !== wIn) wIn.value = w;
    if (document.activeElement !== hIn) hIn.value = h;
    updateInfo();
  };
  scaleIn.oninput = () => { o.scale = clampScale(scaleIn.value); syncSize(); };
  wIn.onchange = () => { o.scale = clampScale(+wIn.value / d.width); wIn.blur(); syncSize(); };
  hIn.onchange = () => { o.scale = clampScale(+hIn.value / d.height); hIn.blur(); syncSize(); };

  fromIn.value = o.from + 1;
  toIn.value = o.to + 1;
  const syncRange = () => {
    o.from = Math.max(0, Math.min(d.frames.length - 1, (+fromIn.value || 1) - 1));
    o.to = Math.max(o.from, Math.min(d.frames.length - 1, (+toIn.value || d.frames.length) - 1));
    fromIn.value = o.from + 1;
    toIn.value = o.to + 1;
    buildPreview();
    updateInfo();
  };
  fromIn.onchange = toIn.onchange = syncRange;
  transp.checked = o.transparent;
  bgIn.value = o.bg;
  bgIn.disabled = o.transparent;
  transp.onchange = () => { o.transparent = transp.checked; bgIn.disabled = o.transparent; buildPreview(); };
  bgIn.oninput = () => { o.bg = bgIn.value; buildPreview(); };

  // --- onglets
  const tabsEl = $('.xp-tabs'), optsEl = $('.xp-opts'), descEl = $('.xp-desc');
  const field = (label, input, hint) => {
    const r = el('div', 'xp-row');
    r.append(el('label', null, escapeHtml(label)), input);
    if (hint) r.appendChild(el('span', 'muted', escapeHtml(hint)));
    return r;
  };
  const num = (value, min, max, step, on) => {
    const i = el('input');
    Object.assign(i, { type: 'number', value, min, max, step });
    i.onchange = () => on(+i.value);
    return i;
  };
  const check = (label, value, on) => {
    const l = el('label', 'rcheck');
    l.innerHTML = `<input type="checkbox" ${value ? 'checked' : ''}><span>${escapeHtml(label)}</span>`;
    l.querySelector('input').onchange = (e) => on(e.target.checked);
    return l;
  };
  const speedSel = () => {
    const s = el('select');
    for (const [v, l] of [[0.25, '×0,25 (très lent)'], [0.5, '×0,5 (lent)'], [1, '×1 (normal)'], [1.5, '×1,5'], [2, '×2 (rapide)'], [4, '×4']]) {
      const op = el('option', null, l);
      op.value = v;
      op.selected = +v === +o.speed;
      s.appendChild(op);
    }
    s.onchange = () => { o.speed = +s.value; updateInfo(); };
    return s;
  };

  function renderTab() {
    tabsEl.innerHTML = '';
    for (const [id, label] of TABS) {
      const b = el('button', 'xp-tab' + (id === current ? ' active' : ''), label);
      b.onclick = () => { current = id; renderTab(); };
      tabsEl.appendChild(b);
    }
    descEl.textContent = TABS.find((t) => t[0] === current)[2];
    optsEl.innerHTML = '';
    const multi = current !== 'png';
    root.querySelectorAll('.xp-from, .xp-to').forEach((i) => (i.disabled = !multi));
    transp.disabled = current === 'video';
    if (current === 'gif') {
      optsEl.append(check('Boucle infinie', o.loop, (v) => (o.loop = v)), field('Vitesse', speedSel()));
    } else if (current === 'png') {
      optsEl.append(field('Frame', num(o.frame + 1, 1, d.frames.length, 1, (v) => { o.frame = Math.max(0, Math.min(d.frames.length - 1, Math.round(v) - 1)); buildPreview(); }), `sur ${d.frames.length}`));
    } else if (current === 'video') {
      const fmt = el('div', 'xp-seg');
      for (const k of ['mp4', 'webm']) {
        const ok = !!X.videoMime(k);
        const b = el('button', 'xp-segb' + (k === videoKind ? ' active' : ''), k.toUpperCase());
        b.disabled = !ok;
        b.title = ok ? '' : 'Non supporté sur ce PC';
        b.onclick = () => { videoKind = k; renderTab(); };
        fmt.appendChild(b);
      }
      optsEl.append(field('Format', fmt), field('Répéter', num(o.repeat, 1, 50, 1, (v) => { o.repeat = Math.max(1, Math.min(50, Math.round(v) || 1)); updateInfo(); }), 'fois'), field('Vitesse', speedSel()));
    } else if (current === 'zip') {
      const p = el('input');
      p.value = o.prefix;
      p.className = 'xp-text';
      p.onchange = () => (o.prefix = p.value.replace(/[\\/:*?"<>|]/g, '_') || X.baseName());
      optsEl.append(field('Nom des fichiers', p, '_0001.png, _0002.png…'));
    } else if (current === 'sheet') {
      optsEl.append(
        field('Colonnes', num(o.cols, 0, 200, 1, (v) => { o.cols = Math.max(0, Math.round(v) || 0); updateInfo(); }), '0 = automatique'),
        field('Espacement', num(o.padding, 0, 64, 1, (v) => { o.padding = Math.max(0, Math.round(v) || 0); updateInfo(); }), 'px entre les frames'),
        check('Ajouter un fichier JSON des positions (pour les moteurs de jeu, dans un .zip)', o.json, (v) => (o.json = v)),
      );
    }
    buildPreview();
    updateInfo();
  }

  // --- infos (taille finale)
  const info = el('span', 'xp-info');
  function updateInfo() {
    const [w, h] = X.outSize(o);
    const n = o.to - o.from + 1;
    const dur = Array.from({ length: n }, (_, k) => d.duration(o.from + k)).reduce((a, b) => a + b, 0) / o.speed;
    let t;
    if (current === 'png') t = `${w} × ${h} px · frame ${o.frame + 1}`;
    else if (current === 'sheet') {
      const L = X.sheetLayout(o);
      t = `Image ${L.w} × ${L.h} px · ${L.cols} × ${L.rows} cases`;
    } else if (current === 'video') t = `${w + (w % 2)} × ${h + (h % 2)} px · ${((dur * o.repeat) / 1000).toFixed(1)} s (enregistré en temps réel)`;
    else t = `${w} × ${h} px · ${n} frame${n > 1 ? 's' : ''}${current === 'gif' ? ` · ${(dur / 1000).toFixed(1)} s` : ''}`;
    info.textContent = t;
    $('.xp-pinfo').textContent = `${w} × ${h} px`;
  }

  // --- aperçu animé
  const pv = $('.xp-preview canvas');
  let frames = [], raf = 0, k = 0, last = 0;
  function buildPreview() {
    const box = 220;
    const s = Math.min(box / d.width, box / d.height);
    const ps = pixel ? Math.max(1, Math.floor(s)) || 1 : s;
    const list = current === 'png' ? [o.frame] : Array.from({ length: o.to - o.from + 1 }, (_, i) => o.from + i);
    // la vidéo a toujours un fond (noir si « transparent » est coché)
    const bg = current === 'video' ? (o.transparent ? '#000000' : o.bg) : o.transparent ? null : o.bg;
    frames = list.map((i) => ({ c: compositeFrame(d, i, ps < 1 ? s : ps, bg), dur: d.duration(i) }));
    pv.width = frames[0].c.width;
    pv.height = frames[0].c.height;
    k = 0;
  }
  function tick(t) {
    if (!pv.isConnected) return;
    if (frames.length) {
      if (t - last >= frames[k].dur / o.speed) {
        last = t;
        k = (k + 1) % frames.length;
      }
      const ctx = pv.getContext('2d');
      ctx.clearRect(0, 0, pv.width, pv.height);
      ctx.drawImage(frames[Math.min(k, frames.length - 1)].c, 0, 0);
    }
    raf = requestAnimationFrame(tick);
  }

  syncSize();
  renderTab();
  raf = requestAnimationFrame(tick);

  return modal({
    title: 'Exporter l’animation',
    content: root,
    wide: true,
    onOpen: (box) => box.querySelector('.modal-foot')?.prepend(info),
    buttons: [
      { label: 'Fermer', value: null },
      { label: 'Exporter', value: 'go', primary: true },
    ],
  }).then(async (v) => {
    cancelAnimationFrame(raf);
    // on mémorise les réglages pour la prochaine fois
    app.render.scale = o.scale;
    app.render.transparent = o.transparent;
    app.render.bg = o.bg;
    app.render.gifLoop = o.loop;
    store('exportOpts', { speed: o.speed, repeat: o.repeat, cols: o.cols, padding: o.padding, json: o.json });
    store('exportTab', current);
    store('exportVideo', videoKind);
    if (v !== 'go') return;
    const opts = { ...o };
    if (current === 'gif') await X.exportGIF(opts);
    else if (current === 'png') await X.exportPNG(opts);
    else if (current === 'video') await X.exportVideo(videoKind, opts);
    else if (current === 'zip') await X.exportSequence(opts);
    else await X.exportSpritesheet(opts);
  });
}
