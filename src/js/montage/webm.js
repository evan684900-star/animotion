// Les fichiers WebM enregistrés par le navigateur (MediaRecorder) n'indiquent pas leur durée :
// certains lecteurs ne peuvent alors ni afficher la durée ni avancer dans la vidéo.
// On ajoute l'élément « Duration » dans l'en-tête (Segment › Info) du fichier.

const idAt = (b, i) => {
  let len = 1;
  while (len <= 4 && !(b[i] & (0x80 >> (len - 1)))) len++;
  let id = 0;
  for (let k = 0; k < len; k++) id = id * 256 + b[i + k];
  return { id, len };
};
const vint = (b, i) => {
  let len = 1;
  while (len <= 8 && !(b[i] & (0x80 >> (len - 1)))) len++;
  let v = b[i] & (0xff >> len);
  for (let k = 1; k < len; k++) v = v * 256 + b[i + k];
  return { len, v, unknown: v === Math.pow(2, 7 * len) - 1 };
};
const uint = (b, i, n) => {
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + b[i + k];
  return v;
};

/** Renvoie une copie du fichier WebM avec sa durée (en millisecondes) inscrite dans l'en-tête */
export function fixWebmDuration(bytes, ms) {
  try {
    let e = idAt(bytes, 0);
    if (e.id !== 0x1a45dfa3) return bytes; // pas un fichier EBML
    let s = vint(bytes, e.len);
    const segAt = e.len + s.len + s.v;
    e = idAt(bytes, segAt);
    if (e.id !== 0x18538067) return bytes; // pas de Segment
    const seg = vint(bytes, segAt + e.len);
    if (!seg.unknown && seg.len !== 8) return bytes;
    let j = segAt + e.len + seg.len;
    const segEnd = seg.unknown ? bytes.length : j + seg.v;
    while (j < segEnd) {
      const c = idAt(bytes, j), cs = vint(bytes, j + c.len);
      const start = j + c.len + cs.len, end = start + cs.v;
      if (c.id === 0x1549a966 && c.len === 4) {
        let scale = 1e6, k = start;
        while (k < end) {
          const d = idAt(bytes, k), ds = vint(bytes, k + d.len), at = k + d.len + ds.len;
          if (d.id === 0x2ad7b1) scale = uint(bytes, at, ds.v) || 1e6;
          if (d.id === 0x4489 && (ds.v === 8 || ds.v === 4)) {
            const out = bytes.slice();
            const dv = new DataView(out.buffer, out.byteOffset + at, ds.v);
            const v = (ms * 1e6) / scale;
            if (ds.v === 8) dv.setFloat64(0, v);
            else dv.setFloat32(0, v);
            return out;
          }
          k = at + ds.v;
        }
        // pas de durée : on reconstruit l'élément Info avec Duration (flottant 64 bits) à la fin
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / scale);
        const content = bytes.subarray(start, end);
        const size = content.length + dur.length;
        const head = new Uint8Array(12);
        head.set(bytes.subarray(j, j + 4));
        head[4] = 0x01; // taille codée sur 8 octets
        for (let q = 11, v = size; q >= 5; q--, v = Math.floor(v / 256)) head[q] = v & 255;
        const out = new Uint8Array(bytes.length - (end - j) + head.length + size);
        out.set(bytes.subarray(0, j), 0);
        out.set(head, j);
        out.set(content, j + 12);
        out.set(dur, j + 12 + content.length);
        out.set(bytes.subarray(end), j + 12 + size);
        if (!seg.unknown) {
          // taille du Segment connue : on l'agrandit d'autant
          const add = head.length + size - (end - j);
          const at = segAt + 4 + 1;
          let v = seg.v + add;
          for (let q = at + 6; q >= at; q--, v = Math.floor(v / 256)) out[q] = v & 255;
        }
        return out;
      }
      if (cs.unknown) break;
      j = end;
    }
  } catch {}
  return bytes;
}
