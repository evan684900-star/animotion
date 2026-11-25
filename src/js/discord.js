// Discord Rich Presence : « Joue à Animotion » sur le profil Discord
import { app, on, store, refreshUI } from './state.js';
import { isTauri } from './platform.js';
import { toast } from './dialogs.js';

// Identifiant de l'application Discord (Discord Developer Portal → Applications → Application ID).
// Ce n'est pas un secret : il est visible par tous ceux qui voient le statut.
export const DISCORD_APP_ID = '1575178314409050132';

const IMAGE = 'https://raw.githubusercontent.com/evan684900-star/animotion/main/src-tauri/icons/128x128@2x.png';
const BUTTON = ['Télécharger Animotion', 'https://github.com/evan684900-star/animotion/releases/latest'];
const T = window.__TAURI__;
const START = Math.floor(Date.now() / 1000);
const MIN_GAP = 15000; // Discord limite les mises à jour (≈ 1 toutes les 15 s)

export const discordSettings = { enabled: true, showName: true, ...(store('discord') || {}) };
export const discordAvailable = () => isTauri && !!DISCORD_APP_ID;

let lastSent = '', lastTime = 0, timer = null;

function presence() {
  const d = app.doc;
  const onStart = !document.getElementById('startScreen').classList.contains('hidden');
  if (!d || onStart) return { details: 'Sur l’écran d’accueil', state: 'Choisit quoi animer ✨' };
  const name = app.fileName && app.fileName !== 'Sans titre' ? app.fileName : 'un nouveau projet';
  const details = (discordSettings.showName ? `Anime « ${name} »` : 'Anime un projet').slice(0, 120);
  const frames = d.frames.length;
  const state = app.playing
    ? '▶ Regarde son animation'
    : `${d.mode === 'pixel' ? 'Pixel art' : 'Dessin'} ${d.width}×${d.height} · ${frames} frame${frames > 1 ? 's' : ''}`;
  return { details, state };
}

async function send() {
  timer = null;
  if (!discordAvailable() || !discordSettings.enabled) return;
  const p = presence();
  const key = p.details + '|' + p.state;
  if (key === lastSent) return;
  lastSent = key;
  lastTime = Date.now();
  try {
    await T.core.invoke('discord_set', {
      clientId: DISCORD_APP_ID, details: p.details, state: p.state, start: START,
      image: IMAGE, buttonLabel: BUTTON[0], buttonUrl: BUTTON[1],
    });
  } catch {
    lastSent = ''; // Discord fermé : on réessaiera au prochain changement ou dans 1 min
    clearTimeout(timer);
    timer = setTimeout(send, 60000);
  }
}

export function updateDiscord() {
  if (!discordAvailable() || !discordSettings.enabled || timer) return;
  timer = setTimeout(send, Math.max(1000, MIN_GAP - (Date.now() - lastTime)));
}

export async function setDiscord(key, value) {
  discordSettings[key] = value;
  store('discord', discordSettings);
  lastSent = '';
  if (!discordAvailable()) {
    if (isTauri) toast('Le statut Discord n’est pas encore configuré dans cette version');
  } else if (!discordSettings.enabled) {
    clearTimeout(timer);
    timer = null;
    try { await T.core.invoke('discord_clear'); } catch {}
  } else {
    clearTimeout(timer);
    timer = null;
    send();
  }
  refreshUI();
}

export function initDiscord() {
  if (!discordAvailable()) return;
  on('ui', updateDiscord);
  setTimeout(send, 1500);
}
