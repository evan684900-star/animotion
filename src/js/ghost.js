// Souris fantôme : met en scène les actions de Claude (curseur qui se déplace, clique sur les boutons, dessine)
// C'est uniquement visuel : la vraie souris de l'utilisateur reste libre.
import { app, store } from './state.js';
import { el } from './util.js';

export const ghostSettings = { enabled: true, speed: 'rapide', ...(store('ghost') || {}) };
const FACTOR = { rapide: 0.7, normale: 1.4, lente: 2.6 };
const f = () => FACTOR[ghostSettings.speed] || 1;
export const ghostOn = () => ghostSettings.enabled && !document.hidden;

export function setGhost(key, value) {
  ghostSettings[key] = value;
  store('ghost', ghostSettings);
}

let cur = null, pos = { x: innerWidth / 2, y: innerHeight / 2 }, hideTimer = null;
function cursor() {
  if (!cur) {
    cur = el('div', 'ghost-cursor', `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5.5 3.5l13 7.6-5.9 1.5 3.3 5.8-2.6 1.5-3.3-5.8-4.5 4.1z" fill="var(--accent)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span>Claude</span>`);
    document.body.appendChild(cur);
  }
  clearTimeout(hideTimer);
  cur.classList.add('show');
  hideTimer = setTimeout(() => cur.classList.remove('show'), 1800);
  return cur;
}
const place = () => (cursor().style.transform = `translate(${pos.x}px, ${pos.y}px)`);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const frame = () => new Promise((r) => requestAnimationFrame(r));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms * f()));

/** Déplace le curseur fantôme jusqu'à (x, y) en coordonnées écran */
export async function moveTo(x, y, ms = 220) {
  if (!ghostOn()) return;
  const from = { ...pos }, dur = Math.max(60, ms * f() * Math.min(1.4, 0.5 + Math.hypot(x - from.x, y - from.y) / 600));
  const t0 = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = ease(t);
    pos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
    place();
    if (t >= 1) break;
    await frame();
  }
}

/** Va « cliquer » sur un élément de l'interface (l'élément s'allume) */
export async function clickOn(target) {
  if (!ghostOn()) return;
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node || !node.getClientRects().length) return;
  const r = node.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  await moveTo(r.left + r.width / 2, r.top + r.height / 2);
  node.classList.add('ghost-press');
  cursor().classList.add('press');
  await wait(110);
  node.classList.remove('ghost-press');
  cur.classList.remove('press');
}

/** Coordonnées écran d'un point du document */
export function docToScreen(x, y) {
  const vp = document.getElementById('viewport');
  const r = vp.getBoundingClientRect();
  const k = vp.clientWidth ? r.width / vp.clientWidth : 1;
  return { x: r.left + (app.panX + x * app.zoom) * k, y: r.top + (app.panY + y * app.zoom) * k };
}

/**
 * Exécute une liste d'étapes de dessin progressivement, le curseur suivant chaque étape.
 * steps : [{ x, y, run() }] en coordonnées du document. Durée totale plafonnée (les gros dessins vont plus vite).
 */
export async function animateSteps(steps, render, totalMs = 650) {
  if (!steps.length) return;
  if (!ghostOn()) {
    for (const s of steps) s.run();
    render();
    return;
  }
  const first = docToScreen(steps[0].x, steps[0].y);
  await moveTo(first.x, first.y);
  const total = Math.min(totalMs * f(), Math.max(150, steps.length * 12) * f());
  const frames = Math.max(1, Math.round(total / 16));
  const per = Math.ceil(steps.length / frames);
  for (let i = 0; i < steps.length; i += per) {
    const batch = steps.slice(i, i + per);
    for (const s of batch) s.run();
    const last = batch[batch.length - 1];
    pos = docToScreen(last.x, last.y);
    place();
    render();
    await frame();
  }
}
