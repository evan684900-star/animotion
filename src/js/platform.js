// Couche d'abstraction : dans l'appli Tauri on utilise les vraies boîtes de dialogue Windows,
// dans un navigateur (tests) on retombe sur téléchargement / <input type=file>.
import { baseName } from './util.js';

const T = window.__TAURI__;
export const isTauri = !!(T && T.core);

export async function saveFile(bytes, defaultName, filters, existingPath = null) {
  if (isTauri) {
    const path = existingPath || (await T.dialog.save({ defaultPath: defaultName, filters }));
    if (!path) return null;
    await T.core.invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
    return path;
  }
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return defaultName;
}

export async function readPath(path) {
  const buf = await T.core.invoke('read_file', { path });
  return { path, name: baseName(path), bytes: new Uint8Array(buf) };
}

export async function openFile(filters) {
  if (isTauri) {
    const path = await T.dialog.open({ multiple: false, directory: false, filters });
    if (!path) return null;
    return readPath(Array.isArray(path) ? path[0] : path);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      resolve({ path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function setWindowTitle(t) {
  document.title = t;
  if (isTauri) {
    try {
      await T.window.getCurrentWindow().setTitle(t);
    } catch {}
  }
}

export async function toggleFullscreen() {
  if (isTauri) {
    try {
      const w = T.window.getCurrentWindow();
      await w.setFullscreen(!(await w.isFullscreen()));
      return;
    } catch {}
  }
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}
