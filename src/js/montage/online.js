// Mode Montage : médias libres de droits trouvés sur Internet grâce à Openverse (openverse.org)
// Images, GIF animés, musiques et bruitages sous licence Creative Commons (ou domaine public).
import { M, makeClip, TEXT_DEFAULT, freeStart, projectDuration, commit } from './model.js';
import { addMedia } from './media.js';
import { addMediaClip, trackFor } from './edit.js';
import { isTauri } from '../platform.js';
import { el, escapeHtml } from '../util.js';
import { toast, modal } from '../dialogs.js';

const API = 'https://api.openverse.org/v1/';
const KINDS = {
  image: { label: '🖼️ Images', path: 'images', params: { extension: 'jpg,png,webp' }, ideas: ['nature', 'city', 'space', 'sunset', 'cat', 'forest', 'ocean', 'texture'] },
  gif: { label: '🎞️ GIF', path: 'images', params: { extension: 'gif' }, ideas: ['explosion', 'fire', 'dance', 'cat', 'loading', 'rain', 'pixel', 'smoke'] },
  music: { label: '🎵 Musiques', path: 'audio', params: { category: 'music' }, ideas: ['calm', 'epic', 'piano', 'chill', 'happy', 'electronic', 'guitar', 'cinematic'] },
  sfx: { label: '🔊 Bruitages', path: 'audio', params: { category: 'sound_effect' }, ideas: ['whoosh', 'explosion', 'applause', 'rain', 'click', 'laugh', 'door', 'birds'] },
};
const LICENSES = [
  ['modification', 'Modifiables (pour le montage)'],
  ['commercial,modification', 'Usage commercial autorisé (YouTube monétisé…)'],
  ['cc0', 'Domaine public (aucun crédit demandé)'],
];
const S = { kind: 'image', q: '', lic: 'modification', page: 1, pages: 0, total: 0, results: [], loading: false, error: '', done: new Set(), busy: new Set(), searched: false };
let audio = null, playing = null, rerender = () => {};

export const licenseName = (l, v) => (l === 'cc0' ? 'CC0 (domaine public)' : l === 'pdm' ? 'Domaine public' : `CC ${String(l).toUpperCase()} ${v || ''}`.trim());
const needsCredit = (c) => !!c && !['cc0', 'pdm'].includes(c.license);
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const attente = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.ceil((s % 3600) / 60)).padStart(2, '0')} min`);

// ---------------------------------------------------------- erreurs détaillées
const HTTP_FR = {
  400: 'requête refusée', 401: 'accès non autorisé', 403: 'accès interdit', 404: 'introuvable', 408: 'délai dépassé', 410: 'n’existe plus',
  429: 'trop de demandes', 500: 'erreur interne du serveur', 502: 'le serveur ne répond pas (passerelle)', 503: 'service indisponible ou en maintenance', 504: 'le serveur met trop de temps à répondre',
};
export const httpFr = (code) => HTTP_FR[code] || (code >= 500 ? 'erreur du serveur' : 'erreur inattendue');
/** Message d'erreur d'Openverse, lisible : { detail: "..." } ou { detail: { champ: ["..."] } } */
function flatten(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(flatten).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => (k === 'detail' || k === 'message' ? flatten(x) : `${k} : ${flatten(x)}`)).join(' ; ');
  return String(v);
}
/** Transforme une réponse d'erreur d'Openverse en { title, lines[] } */
async function apiError(r) {
  let detail = '';
  try {
    const text = await r.text();
    try {
      const j = JSON.parse(text);
      detail = flatten(j.detail ?? j.error ?? j.message ?? j);
    } catch {
      detail = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    }
  } catch {}
  const code = r.status, lines = [];
  if (code === 429) {
    const m = /available in (\d+) second/i.exec(detail), s = m ? +m[1] : null;
    lines.push(s == null ? 'Openverse limite le nombre de recherches gratuites : réessaie un peu plus tard.'
      : s > 120 ? `Le quota de recherches gratuites de la journée est épuisé pour ta connexion : nouvel essai possible dans ${attente(s)}.`
        : `Openverse limite le nombre de recherches par minute : nouvel essai possible dans ${attente(s)}.`);
  } else if (code >= 500) lines.push('Le problème vient des serveurs d’Openverse, pas de ton PC : réessaie dans quelques minutes.');
  else if (code === 400) lines.push('Openverse n’accepte pas cette recherche : essaie d’autres mots.');
  if (detail) lines.push(`Message d’Openverse : « ${detail} »`);
  return { title: `Erreur ${code} d’Openverse : ${httpFr(code)}`, lines };
}

// ---------------------------------------------------------- recherche
async function search(more = false) {
  const q = S.q.trim();
  if (!q) return toast('Tape ce que tu cherches 🔎');
  stopPreview();
  S.loading = true;
  S.error = '';
  S.searched = true;
  if (more) S.page++;
  else { S.page = 1; S.results = []; }
  rerender();
  const k = KINDS[S.kind];
  const p = new URLSearchParams({ q, page: S.page, page_size: 20, mature: 'false', ...k.params });
  if (S.lic === 'cc0') p.set('license', 'cc0,pdm');
  else p.set('license_type', S.lic);
  try {
    let r;
    try {
      r = await fetch(`${API}${k.path}/?${p}`, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw { title: 'Impossible de joindre Openverse 📡', lines: ['Vérifie ta connexion Internet (ou un pare-feu qui bloquerait api.openverse.org).', `Erreur technique : « ${e.message || e} »`] };
    }
    if (!r.ok) throw await apiError(r);
    let d;
    try {
      d = await r.json();
    } catch (e) {
      throw { title: 'Réponse illisible d’Openverse', lines: [`Erreur technique : « ${e.message || e} »`] };
    }
    S.total = d.result_count || 0;
    S.pages = d.page_count || 0;
    const seen = new Set(S.results.map((x) => x.id));
    S.results.push(...(d.results || []).filter((x) => x.url && !seen.has(x.id)));
  } catch (e) {
    S.error = e?.title ? e : { title: 'Erreur pendant la recherche', lines: [String(e?.message || e)] };
    if (more) S.page--;
  }
  S.loading = false;
  rerender();
}

// ---------------------------------------------------------- téléchargement et ajout au montage
async function download(url) {
  const host = (() => { try { return new URL(url).host; } catch { return 'le site'; } })();
  if (isTauri) {
    try {
      return new Uint8Array(await window.__TAURI__.core.invoke('download_url', { url }));
    } catch (e) {
      // ex. « erreur 403 (Forbidden) de live.staticflickr.com » : on ajoute l'explication en français
      const msg = String(e?.message || e), m = /erreur (\d{3})/.exec(msg);
      throw new Error(m ? `${msg} : ${httpFr(+m[1])}` : msg);
    }
  }
  let r;
  try {
    r = await fetch(url);
  } catch (e) {
    throw new Error(`${host} refuse le téléchargement depuis une page web (${e.message || e})`);
  }
  if (!r.ok) throw new Error(`erreur ${r.status}${r.statusText ? ` (${r.statusText})` : ''} de ${host} : ${httpFr(r.status)}`);
  return new Uint8Array(await r.arrayBuffer());
}
/** Reconnaît le format d'après les premiers octets (les adresses n'ont pas toujours d'extension) */
export function sniff(b) {
  const at = (i, s) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b[0] === 0x89 && at(1, 'PNG')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (at(0, 'GIF8')) return 'gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'wav';
  if (at(0, 'OggS')) return 'ogg';
  if (at(0, 'fLaC')) return 'flac';
  if (at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (at(4, 'ftyp')) return 'm4a';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'weba';
  return null;
}
const cleanName = (t) => (String(t || 'media').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'media');

async function addResult(r) {
  if (S.busy.has(r.id)) return;
  S.busy.add(r.id);
  rerender();
  try {
    const bytes = await download(r.url);
    const head = new TextDecoder().decode(bytes.slice(0, 64)).trim().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html')) throw new Error('le site a renvoyé une page web au lieu du fichier');
    const ext = sniff(bytes) || String(r.filetype || '').toLowerCase();
    if (!ext) throw new Error('format de fichier inconnu');
    const credit = {
      title: r.title || 'Sans titre', creator: r.creator || '', license: r.license, version: r.license_version || '',
      licenseName: licenseName(r.license, r.license_version), url: r.foreign_landing_url || '', licenseUrl: r.license_url || '',
      source: r.source || r.provider || '', attribution: r.attribution || '',
    };
    const m = await addMedia({ name: `${cleanName(r.title)}.${ext}`, bytes }, { entry: { credit } });
    addMediaClip(m, { start: M.time });
    S.done.add(r.id);
    toast(needsCredit(credit) ? `Ajouté à la tête de lecture ✔ — pense à créditer ${credit.creator || 'l’auteur'} (bouton Crédits)` : 'Ajouté à la tête de lecture ✔ (domaine public, aucun crédit demandé)', 'ok', 4500);
  } catch (e) {
    toast('Téléchargement impossible : ' + (e.message || e), 'error', 6000);
  }
  S.busy.delete(r.id);
  rerender();
}

// ---------------------------------------------------------- écoute des sons avant de les ajouter
export function stopPreview() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  playing = null;
}
function togglePreview(r) {
  if (playing === r.id) { stopPreview(); return rerender(); }
  stopPreview();
  audio ||= new Audio();
  audio.src = r.url;
  audio.onended = () => { playing = null; rerender(); };
  audio.play().catch(() => { toast('Impossible d’écouter ce son ici, essaie de l’ajouter directement', 'error'); playing = null; rerender(); });
  playing = r.id;
  rerender();
}

// ---------------------------------------------------------- crédits
/** Médias en ligne utilisés dans le montage */
export function usedCredits() {
  const used = new Set(M.project.clips.map((c) => c.media).filter(Boolean));
  return M.project.media.filter((m) => m.credit && used.has(m.id)).map((m) => m.credit);
}
export const creditsNeeded = () => usedCredits().filter(needsCredit).length;
const short = (t, n = 42) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

export async function showCredits() {
  const list = usedCredits();
  if (!list.length) return toast('Aucun média trouvé en ligne n’est utilisé dans ce montage');
  const lines = list.map((c) => `• « ${c.title} »${c.creator ? ` par ${c.creator}` : ''}${c.source ? ` (${c.source})` : ''} — ${c.licenseName}${c.url ? ` — ${c.url}` : ''}`);
  const text = `Crédits :\n${lines.join('\n')}`;
  const box = el('div', 'mt-credits');
  box.innerHTML = `<p>Les licences <b>CC BY</b> demandent de citer l’auteur : colle ce texte dans la description de ta vidéo, ou ajoute un générique à la fin.${list.some((c) => /nc/.test(c.license)) ? ' ⚠ Certains médias sont <b>NC</b> : pas d’utilisation commerciale (vidéo monétisée).' : ''}</p>`;
  const ta = el('textarea', 'mt-textarea');
  ta.readOnly = true;
  ta.value = text;
  ta.rows = Math.min(12, lines.length + 2);
  box.appendChild(ta);
  const choice = await modal({
    title: 'Crédits du montage 📋',
    content: box,
    wide: true,
    buttons: [{ label: 'Fermer', value: null }, { label: '🎬 Ajouter un générique de fin', value: 'end' }, { label: '📋 Copier', value: 'copy', primary: true }],
  });
  if (choice === 'copy') {
    try {
      await navigator.clipboard.writeText(text);
      toast('Crédits copiés 📋 colle-les dans la description de ta vidéo', 'ok');
    } catch {
      toast('Copie impossible : sélectionne le texte et fais Ctrl+C', 'error');
    }
  } else if (choice === 'end') {
    const track = trackFor('text');
    const start = projectDuration();
    const content = ['Crédits', ...list.map((c) => `${short(c.title)}${c.creator ? ' — ' + short(c.creator, 28) : ''} — ${c.licenseName}`)].join('\n');
    const c = makeClip('text', track.id, { name: 'Générique', duration: Math.max(4, 2 + list.length * 0.8), text: { ...TEXT_DEFAULT(), content, size: Math.max(28, 60 - list.length * 3), bold: false, outline: false, shadow: true } });
    c.start = freeStart(track.id, start, c.duration);
    c.animIn = { type: 'fade', duration: 0.5 };
    c.animOut = { type: 'fade', duration: 0.5 };
    M.project.clips.push(c);
    M.sel = new Set([c.id]);
    commit();
    toast('Générique ajouté à la fin du montage 🎬', 'ok');
  }
}

// ---------------------------------------------------------- onglet « En ligne »
export function renderOnline(body, again) {
  rerender = again;
  const k = KINDS[S.kind];
  body.appendChild(el('h4', 'mt-lib-h', 'Médias libres de droits'));
  const seg = el('div', 'mt-ol-kinds');
  for (const [id, v] of Object.entries(KINDS)) {
    const b = el('button', 'mt-ol-kind' + (id === S.kind ? ' active' : ''), v.label);
    b.onclick = () => { if (S.kind === id) return; S.kind = id; S.results = []; S.searched = false; S.error = ''; stopPreview(); again(); if (S.q.trim()) search(); };
    seg.appendChild(b);
  }
  body.appendChild(seg);
  const form = el('form', 'mt-ol-form');
  const input = el('input', 'mt-search');
  input.type = 'search';
  input.placeholder = `🔎 ${S.kind === 'music' ? 'Ex. : calm piano, epic…' : S.kind === 'sfx' ? 'Ex. : whoosh, explosion…' : 'Ex. : cat, sunset, explosion…'}`;
  input.value = S.q;
  input.oninput = () => (S.q = input.value);
  input.onkeydown = (e) => e.stopPropagation();
  const go = el('button', 'btn primary', 'Chercher');
  go.type = 'submit';
  form.append(input, go);
  form.onsubmit = (e) => { e.preventDefault(); search(); };
  body.appendChild(form);
  const lic = el('select', 'mt-ol-lic');
  for (const [v, t] of LICENSES) { const o = el('option', null, escapeHtml(t)); o.value = v; o.selected = v === S.lic; lic.appendChild(o); }
  lic.onchange = () => { S.lic = lic.value; if (S.searched) search(); };
  body.appendChild(lic);
  if (!S.searched) {
    body.appendChild(el('p', 'mt-tip', 'Cherche parmi des centaines de millions d’images, GIF, musiques et bruitages libres de droits. Astuce : les mots <b>en anglais</b> trouvent beaucoup plus de résultats.'));
    const ideas = el('div', 'chip-row');
    for (const w of k.ideas) { const c = el('button', 'chip', escapeHtml(w)); c.onclick = () => { S.q = w; search(); }; ideas.appendChild(c); }
    body.appendChild(ideas);
  }
  if (S.error) {
    const box = el('div', 'mt-ol-error', `<b>⚠️ ${escapeHtml(S.error.title)}</b>${S.error.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}`);
    const again = el('button', 'btn small', 'Réessayer');
    again.onclick = () => search(S.page > 1);
    box.appendChild(again);
    body.appendChild(box);
  }
  if (S.searched && !S.loading && !S.error && !S.results.length) body.appendChild(el('div', 'mt-empty', 'Aucun résultat 🤷 essaie un autre mot (en anglais ?)'));
  if (S.results.length) {
    body.appendChild(el('p', 'mt-tip', `${S.total >= 240 ? 'Plus de 240' : S.total} résultat${S.total > 1 ? 's' : ''} · clique pour ajouter à la tête de lecture`));
    if (k.path === 'images') {
      const grid = el('div', 'mt-ol-grid');
      for (const r of S.results) {
        const st = S.busy.has(r.id) ? ' busy' : S.done.has(r.id) ? ' done' : '';
        const b = el('button', 'mt-ol-item' + st);
        b.title = `${r.title || 'Sans titre'}${r.creator ? ' — ' + r.creator : ''}\n${licenseName(r.license, r.license_version)} · ${r.source || ''}`;
        const img = el('img');
        img.loading = 'lazy';
        img.alt = '';
        img.src = r.thumbnail || r.url;
        img.onerror = () => { img.replaceWith(el('span', 'mt-ol-noimg', '🖼️')); };
        b.append(img, el('span', 'mt-ol-badge', escapeHtml(r.license === 'cc0' || r.license === 'pdm' ? 'CC0' : String(r.license).toUpperCase())));
        if (S.kind === 'gif') b.appendChild(el('span', 'mt-ol-gif', 'GIF'));
        b.onclick = () => addResult(r);
        grid.appendChild(b);
      }
      body.appendChild(grid);
    } else {
      const list = el('div', 'mt-ol-list');
      for (const r of S.results) {
        const row = el('div', 'mt-ol-row' + (S.busy.has(r.id) ? ' busy' : S.done.has(r.id) ? ' done' : ''));
        const play = el('button', 'mt-ol-play', playing === r.id ? '⏸' : '▶');
        play.title = 'Écouter';
        play.onclick = () => togglePreview(r);
        const info = el('div', 'mt-ol-info', `<b>${escapeHtml(r.title || 'Sans titre')}</b><span>${escapeHtml(r.creator || 'Auteur inconnu')} · ${fmtDur(r.duration)} · ${escapeHtml(licenseName(r.license, r.license_version))}</span>`);
        info.title = `${r.title || ''}\n${r.source || ''}`;
        const add = el('button', 'mt-media-add', S.busy.has(r.id) ? '…' : S.done.has(r.id) ? '✓' : '+');
        add.title = 'Ajouter à la tête de lecture';
        add.onclick = () => addResult(r);
        row.append(play, info, add);
        list.appendChild(row);
      }
      body.appendChild(list);
    }
  }
  if (S.loading) body.appendChild(el('div', 'mt-ol-loading', '⏳ Recherche…'));
  else if (S.results.length && S.page < S.pages && S.results.length < S.total) {
    const more = el('button', 'btn mt-ol-more', 'Plus de résultats');
    more.onclick = () => search(true);
    body.appendChild(more);
  }
  const foot = el('div', 'mt-ol-foot');
  const n = usedCredits().length;
  const cr = el('button', 'btn small', `📋 Crédits du montage${n ? ` (${n})` : ''}`);
  cr.onclick = showCredits;
  foot.append(cr, el('p', 'mt-tip', 'Recherche fournie par <b>Openverse</b> (openverse.org). Chaque média a sa propre licence : la plupart demandent de citer l’auteur, le bouton Crédits prépare le texte pour toi.'));
  body.appendChild(foot);
}
