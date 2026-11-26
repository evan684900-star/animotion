// Mode Montage : « Mes filtres » — une image posée par-dessus un clip, avec opacité et mode de fusion réglables
// Les filtres sont mémorisés dans l'appli : on les retrouve dans tous les montages.
import { M, selectedClips, commit } from './model.js';
import { addMedia } from './media.js';
import { openFile } from '../platform.js';
import { store } from '../state.js';
import { toast } from '../dialogs.js';
import { loadImage, bytesToDataURL, makeCanvas, canvasToBytes, mimeFromName } from '../util.js';

export const myFilters = () => store('myFilters') || [];
const save = (list) => {
  try {
    localStorage.setItem('animotion.myFilters', JSON.stringify(list));
    return true;
  } catch {
    toast('Plus de place pour enregistrer ce filtre : supprimes-en un autre', 'error', 5000);
    return false;
  }
};

/** Choisit une image et en fait un filtre (réduite à 1280 px max pour rester léger) */
export async function createFilter() {
  const f = await openFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]);
  if (!f) return null;
  try {
    const img = await loadImage(await bytesToDataURL(f.bytes, mimeFromName(f.name)));
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const cv = makeCanvas(Math.max(1, Math.round((img.naturalWidth || img.width) * k)), Math.max(1, Math.round((img.naturalHeight || img.height) * k)));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const data = await bytesToDataURL(await canvasToBytes(cv), 'image/png');
    const item = { id: 'f' + Date.now().toString(36), name: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Mon filtre', data };
    if (!save([...myFilters(), item])) return null;
    toast(`Filtre « ${item.name} » créé 🎨 sélectionne un clip puis clique dessus`, 'ok', 4500);
    return item;
  } catch (e) {
    toast('Image illisible : ' + (e.message || e), 'error');
    return null;
  }
}

export function deleteFilter(id) {
  save(myFilters().filter((f) => f.id !== id));
}

/** Pose le filtre sur les clips sélectionnés */
export async function applyFilter(item) {
  const list = selectedClips().filter((c) => c.type !== 'audio' && c.type !== 'effect');
  if (!list.length) return toast('Sélectionne d’abord un clip (vidéo, image, texte…) dans la timeline');
  let m = M.project.media.find((x) => x.myFilter === item.id);
  if (!m) {
    const bytes = new Uint8Array(await (await fetch(item.data)).arrayBuffer());
    m = await addMedia({ name: `${item.name}.png`, bytes }, { entry: { myFilter: item.id } });
  }
  for (const c of list) c.overlay = { media: m.id, name: item.name, opacity: c.overlay?.opacity ?? 0.5, blend: c.overlay?.blend || 'source-atop' };
  commit();
  toast(`Filtre « ${item.name} » appliqué 🎨 règle son opacité à droite`, 'ok');
}
