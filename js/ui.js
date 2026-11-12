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
// ---------- Periodos ----------
// natural: del 1 al último día del mes.
// dia:     desde el día fijo S hasta el S−1 del mes siguiente.
// nomina:  desde el día real en que entra la nómina hasta el día antes de la siguiente.
// Cada periodo se identifica con una clave 'YYYY-MM' (el mes en que empieza), para poder ir al anterior o al siguiente.
const DAY_MS = 86400000;
let MODE = 'natural', START = 1, ANCHORS = [], KEYS = [];
const isoAdd = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY_MS);

export function setPeriodConfig({ mode = 'natural', start = 1, payrolls = [] } = {}) {
  MODE = ['natural', 'dia', 'nomina'].includes(mode) ? mode : 'natural';
  START = Math.min(28, Math.max(1, +start || 1));
  // Nóminas separadas al menos 20 días (una paga extra cercana no abre un ciclo nuevo)
  ANCHORS = [];
  for (const d of [...payrolls].sort()) if (!ANCHORS.length || dayDiff(ANCHORS.at(-1), d) >= 20) ANCHORS.push(d);
  KEYS = [];
  for (const a of ANCHORS) {
    let k = a.slice(0, 7);
    if (KEYS.length && k <= KEYS.at(-1)) k = addMonths(KEYS.at(-1), 1);
    KEYS.push(k);
  }
  if (MODE === 'nomina' && ANCHORS.length) {
    const days = ANCHORS.map(a => +a.slice(8, 10)).sort((x, y) => x - y);
    START = Math.min(28, days[Math.floor(days.length / 2)]); // día habitual de cobro, para meses sin nómina registrada
  }
}
export function periodMode() { return MODE; }
export function monthStart() { return START; }
export function payrollAnchors() { return [...ANCHORS]; }

function byDay(iso) {
  if (START === 1) return iso.slice(0, 7);
  return +iso.slice(8, 10) >= START ? iso.slice(0, 7) : addMonths(iso.slice(0, 7), -1);
}
function rangeByDay(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (START === 1) return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`];
  return [`${ym}-${String(START).padStart(2, '0')}`, isoAdd(`${addMonths(ym, 1)}-${String(START).padStart(2, '0')}`, -1)];
}

export function periodOf(iso) {
  if (MODE === 'natural') return iso.slice(0, 7);
  if (MODE === 'dia' || !ANCHORS.length) return byDay(iso);
  let i = -1;
  for (let j = 0; j < ANCHORS.length; j++) if (ANCHORS[j] <= iso) i = j; else break;
  if (i < 0) return byDay(iso) < KEYS[0] ? byDay(iso) : addMonths(KEYS[0], -1);
  // Si pasan más de 40 días sin nómina registrada, se vuelve al día habitual
  if (i === ANCHORS.length - 1 && dayDiff(ANCHORS[i], iso) > 40) return byDay(iso) > KEYS[i] ? byDay(iso) : addMonths(KEYS[i], 1);
  return KEYS[i];
}

// [inicio, fin, abierto] del periodo. "abierto" = aún no ha llegado la nómina que lo cierra.
export function periodBounds(key) {
  if (MODE === 'nomina' && ANCHORS.length) {
    const i = KEYS.indexOf(key);
    if (i >= 0) {
      if (i + 1 < ANCHORS.length) return [ANCHORS[i], isoAdd(ANCHORS[i + 1], -1), false];
      const expected = rangeByDay(addMonths(key, 1))[0];
      const end = expected > isoAdd(ANCHORS[i], 20) ? isoAdd(expected, -1) : isoAdd(ANCHORS[i], 30);
      return [ANCHORS[i], end, true];
    }
  }
  const [a, b] = rangeByDay(key);
  return [a, b, false];
}
export function monthRange(key) { const [a, b] = periodBounds(key); return [a, b]; }

export function periodTitle(key) {
  if (MODE === 'natural') { const l = monthLabel(key); return l[0].toUpperCase() + l.slice(1); }
  const [a, b, open] = periodBounds(key);
  return `${dateLabel(a)} – ${open ? 'próxima nómina' : dateLabel(b)}`;
}
export function periodHint(key) {
  if (MODE === 'natural') return '';
  if (MODE === 'nomina' && KEYS.includes(key)) {
    const [, b, open] = periodBounds(key);
    return `Nómina de ${monthLabel(key).split(' ')[0]}${open ? ` · la siguiente se espera hacia el ${dateLabel(isoAdd(b, 1))}` : ''}`;
  }
  return MODE === 'dia' ? `Mes desde el día ${START}` : `Sin nómina registrada · desde el día ${START}`;
}
// Etiqueta corta para gráficos
export function periodShort(key) {
  if (MODE === 'natural') return monthShort(key);
  return dateLabel(periodBounds(key)[0]).replace(/ \d{4}$/, '');
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
