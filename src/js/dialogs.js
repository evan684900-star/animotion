import { el, escapeHtml } from './util.js';
import { icon } from './icons.js';

export const isModalOpen = () => !!document.querySelector('.modal-overlay');

/**
 * Fenêtre modale générique. Renvoie une promesse résolue avec la valeur du bouton cliqué (ou null).
 * buttons: [{ label, value, primary, danger }] — value peut être une fonction (box) => valeur
 */
export function modal({ title, content, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const ov = el('div', 'modal-overlay');
    const box = el('div', 'modal' + (wide ? ' wide' : ''));
    const head = el('div', 'modal-head', `<h2>${escapeHtml(title)}</h2>`);
    const x = el('button', 'icon-btn', icon('close', 16));
    x.title = 'Fermer';
    head.appendChild(x);
    const body = el('div', 'modal-body');
    if (typeof content === 'string') body.innerHTML = content;
    else if (content) body.appendChild(content);
    const foot = el('div', 'modal-foot');
    box.append(head, body);
    if (buttons.length) box.appendChild(foot);
    ov.appendChild(box);

    function close(v) {
      ov.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v === undefined ? null : v);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find((b) => b.primary);
        if (p) {
          e.preventDefault();
          e.stopPropagation();
          close(typeof p.value === 'function' ? p.value(box) : p.value);
        }
      }
      e.stopPropagation();
    }
    x.onclick = () => close(null);
    ov.addEventListener('pointerdown', (e) => {
      if (e.target === ov) close(null);
    });
    for (const b of buttons) {
      const btn = el('button', 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), escapeHtml(b.label));
      btn.onclick = () => close(typeof b.value === 'function' ? b.value(box) : b.value);
      foot.appendChild(btn);
    }
    document.addEventListener('keydown', onKey, true);
    document.getElementById('modalRoot').appendChild(ov);
    const first = box.querySelector('input, select');
    if (first) setTimeout(() => (first.focus(), first.select?.()), 30);
    onOpen?.(box, close);
  });
}

/**
 * Formulaire simple. fields: [{ name, label, type:'number'|'text'|'select'|'checkbox'|'color', value, min, max, step, options:[[v,label]] }]
 */
export async function form(title, fields, okLabel = 'OK') {
  const wrap = el('div', 'form');
  for (const f of fields) {
    const row = el('label', 'form-row' + (f.type === 'checkbox' ? ' check' : ''));
    let input;
    if (f.type === 'select') {
      input = el('select');
      for (const [v, l] of f.options) {
        const o = el('option', null, escapeHtml(l));
        o.value = v;
        if (String(v) === String(f.value)) o.selected = true;
        input.appendChild(o);
      }
    } else {
      input = el('input');
      input.type = f.type || 'text';
      if (f.type === 'checkbox') input.checked = !!f.value;
      else input.value = f.value ?? '';
      for (const k of ['min', 'max', 'step', 'placeholder']) if (f[k] != null) input[k] = f[k];
    }
    input.name = f.name;
    const lab = el('span', null, escapeHtml(f.label));
    if (f.type === 'checkbox') row.append(input, lab);
    else row.append(lab, input);
    if (f.hint) row.appendChild(el('small', null, escapeHtml(f.hint)));
    wrap.appendChild(row);
  }
  return modal({
    title,
    content: wrap,
    buttons: [
      { label: 'Annuler', value: null },
      {
        label: okLabel,
        primary: true,
        value: (box) => {
          const out = {};
          for (const f of fields) {
            const i = box.querySelector(`[name="${f.name}"]`);
            out[f.name] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value;
          }
          return out;
        },
      },
    ],
  });
}

export function confirmDialog(title, message, okLabel = 'Continuer', danger = false) {
  return modal({
    title,
    content: `<p>${escapeHtml(message)}</p>`,
    buttons: [
      { label: 'Annuler', value: false },
      { label: okLabel, value: true, primary: true, danger },
    ],
  }).then((v) => !!v);
}

export function toast(msg, kind = 'info', ms = 2600) {
  const root = document.getElementById('toasts');
  const t = el('div', 'toast ' + kind, escapeHtml(msg));
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function progress(title) {
  const ov = el('div', 'modal-overlay');
  const box = el('div', 'modal', `<div class="modal-head"><h2>${escapeHtml(title)}</h2></div>
    <div class="modal-body"><div class="progress"><div class="bar"></div></div><p class="ptext">Préparation…</p></div>`);
  ov.appendChild(box);
  document.getElementById('modalRoot').appendChild(ov);
  const bar = box.querySelector('.bar');
  const txt = box.querySelector('.ptext');
  return {
    set(p, text) {
      bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
      if (text) txt.textContent = text;
    },
    close() {
      ov.remove();
    },
  };
}
