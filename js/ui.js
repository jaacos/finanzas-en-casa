// Utilidades de interfaz.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

export function eur(n, { sign = false, decimals = true } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const s = (decimals ? nf : nf0).format(Math.abs(v));
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${pre}${s} €`;
}

export function pct(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const r = Math.round(n * 100);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} %`;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_S = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function monthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_S[m - 1]}${String(y).slice(2) !== String(new Date().getFullYear()).slice(2) ? ' ' + String(y).slice(2) : ''}`;
}
export function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_S[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Periodo financiero: si el mes empieza el día S (>1), el periodo «octubre» va del S de octubre al S−1 de noviembre
// (lleva el nombre del mes en que llega la nómina).
let START = 1;
export function setMonthStart(d) { START = Math.min(28, Math.max(1, +d || 1)); }
export function monthStart() { return START; }
export function periodOf(iso) {
  const ym = iso.slice(0, 7);
  if (START === 1) return ym;
  return +iso.slice(8, 10) >= START ? ym : addMonths(ym, -1);
}
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (START === 1) {
    const last = new Date(y, m, 0).getDate();
    return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`];
  }
  return [`${ym}-${String(START).padStart(2, '0')}`, `${addMonths(ym, 1)}-${String(START - 1).padStart(2, '0')}`];
}
export function periodHint(ym) {
  if (START === 1) return '';
  const [a, b] = monthRange(ym);
  return `${dateLabel(a)} – ${dateLabel(b)}`;
}

export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 5000 : 2600);
}

// Hoja inferior modal. Devuelve {el, close}.
export function sheet(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-x" aria-label="Cerrar" data-close>×</button>${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => wrap.classList.add('show'));
  const close = () => {
    wrap.classList.remove('show');
    document.body.classList.remove('noscroll');
    setTimeout(() => wrap.remove(), 200);
    onClose?.();
  };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  return { el: wrap.querySelector('.sheet'), close };
}

export function confirmBox(msg, okText = 'Aceptar') {
  return new Promise(res => {
    const s = sheet(`<p class="confirm-msg">${esc(msg)}</p><div class="row-btns"><button class="btn ghost" data-no>Cancelar</button><button class="btn danger" data-yes>${esc(okText)}</button></div>`, { onClose: () => res(false) });
    s.el.querySelector('[data-yes]').onclick = () => { res(true); s.close(); };
    s.el.querySelector('[data-no]').onclick = () => { res(false); s.close(); };
  });
}

export async function busy(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || String(e), 'error'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const TYPE_LABEL = {
  pendiente: 'Sin clasificar', gasto: 'Gasto', ingreso: 'Ingreso', interna: 'Entre cuentas propias',
  aportacion: 'Aportación a la común', ahorro: 'Ahorro', inversion: 'Inversión',
};

export const BANK_LABEL = { santander: 'Santander', bbva: 'BBVA', revolut: 'Revolut', myinvestor: 'MyInvestor', efectivo: 'Efectivo', otro: 'Otro banco' };
