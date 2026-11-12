// Cálculos de análisis. Gasto en positivo (importe del banco con signo cambiado).
import { addMonths, monthLabel, eur, pct, BANK_LABEL, periodOf, monthRange } from './ui.js';
import { projectStats, STATUS_LABEL } from './projects.js';

export function scopeAccountIds(state, scope) {
  const me = state.me.id;
  return new Set(state.accounts.filter(a => {
    if (!state.visible.has(a.id)) return false;
    if (scope === 'mias') return a.owner_member_id === me;
    if (scope === 'comun') return a.owner_member_id == null;
    return true;
  }).map(a => a.id));
}

export function txOfMonth(state, ym, ids) {
  return state.tx.filter(t => periodOf(t.date) === ym && ids.has(t.account_id));
}

export function totals(txs) {
  const r = { income: 0, expense: 0, saved: 0, contrib: 0, pending: 0, pendingCount: 0 };
  for (const t of txs) {
    const a = +t.amount;
    if (t.tx_type === 'ingreso') r.income += a;
    else if (t.tx_type === 'gasto') r.expense -= a;
    else if (t.tx_type === 'ahorro' || t.tx_type === 'inversion') r.saved -= a;
    else if (t.tx_type === 'aportacion') r.contrib += a;
    else if (t.tx_type === 'pendiente') { r.pending += a; r.pendingCount++; }
  }
  r.result = r.income - r.expense;
  return r;
}

const NONE = '__none__';

// Clave de agrupación de un gasto según el nivel.
function keyFor(state, t, level, path) {
  const sub = t.category_id ? state.catById.get(t.category_id) : null;
  const parentId = sub ? (sub.parent_id ?? sub.id) : NONE;
  if (level === 'cat') return parentId;
  if (level === 'sub') return parentId === path.cat ? (t.category_id ?? NONE) : null;
  if (level === 'mer') return t.category_id === path.sub || (path.sub === NONE && !t.category_id && parentId === path.cat) ? (t.merchant || 'Sin comercio') : null;
  return null;
}

export function inPath(state, t, path) {
  if (t.tx_type !== 'gasto') return false;
  const sub = t.category_id ? state.catById.get(t.category_id) : null;
  const parentId = sub ? (sub.parent_id ?? sub.id) : NONE;
  if (path.cat && parentId !== path.cat) return false;
  if (path.sub && (t.category_id ?? NONE) !== path.sub) return false;
  if (path.mer && (t.merchant || 'Sin comercio') !== path.mer) return false;
  return true;
}

// Cuántos de los 3 meses anteriores tienen algún movimiento (para no promediar meses sin datos).
export function historyMonths(state, ids, ym) {
  const prev = new Set([addMonths(ym, -1), addMonths(ym, -2), addMonths(ym, -3)]);
  const have = new Set();
  for (const t of state.tx) {
    const m = periodOf(t.date);
    if (prev.has(m) && ids.has(t.account_id)) have.add(m);
  }
  return have.size;
}

// Desglose del nivel actual con comparativas.
export function breakdown(state, ids, ym, path) {
  const hist = historyMonths(state, ids, ym);
  const level = path.sub ? 'mer' : path.cat ? 'sub' : 'cat';
  const months = [ym, addMonths(ym, -1), addMonths(ym, -2), addMonths(ym, -3)];
  const acc = new Map();
  for (const t of state.tx) {
    if (t.tx_type !== 'gasto' || !ids.has(t.account_id)) continue;
    const mi = months.indexOf(periodOf(t.date));
    if (mi < 0) continue;
    const k = keyFor(state, t, level, path);
    if (k == null) continue;
    if (!acc.has(k)) acc.set(k, { key: k, cur: 0, prev: 0, prev3: 0, count: 0 });
    const n = acc.get(k);
    const v = -t.amount;
    if (mi === 0) { n.cur += v; n.count++; }
    if (mi === 1) n.prev += v;
    if (mi >= 1) n.prev3 += v;
  }
  const items = [...acc.values()].map(n => ({
    ...n,
    avg3: hist ? n.prev3 / hist : 0,
    hist,
    label: labelFor(state, level, n.key),
    level,
  })).filter(n => Math.abs(n.cur) > 0.004 || Math.abs(n.prev3) > 0.004);
  items.sort((a, b) => b.cur - a.cur || b.avg3 - a.avg3);
  const total = items.reduce((s, n) => s + n.cur, 0);
  return { level, items, total };
}

function labelFor(state, level, key) {
  if (key === NONE) return 'Sin categoría';
  if (level === 'mer') return key;
  return state.catById.get(key)?.name ?? '¿?';
}

export function series(state, ids, endYm, path, n = 12) {
  const out = [];
  const months = Array.from({ length: n }, (_, i) => addMonths(endYm, i - n + 1));
  const idx = new Map(months.map((m, i) => [m, i]));
  const vals = months.map(() => 0);
  for (const t of state.tx) {
    if (!ids.has(t.account_id) || !inPath(state, t, path)) continue;
    const i = idx.get(periodOf(t.date));
    if (i != null) vals[i] -= t.amount;
  }
  months.forEach((m, i) => out.push({ ym: m, value: Math.round(vals[i] * 100) / 100 }));
  return out;
}

export function incomeBreakdown(state, txs) {
  const m = new Map();
  for (const t of txs) {
    if (t.tx_type !== 'ingreso') continue;
    const c = t.category_id ? state.catById.get(t.category_id)?.name : 'Sin categoría';
    m.set(c, (m.get(c) || 0) + +t.amount);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// Texto del mes para analizarlo en el chat. Sin números de cuenta ni conceptos originales.
export function summaryText(state, ym, scope, summaries) {
  const ids = scopeAccountIds(state, scope);
  const txs = txOfMonth(state, ym, ids);
  const tt = totals(txs);
  const hist = historyMonths(state, ids, ym);
  const prev = [1, 2, 3].map(i => totals(txOfMonth(state, addMonths(ym, -i), ids)));
  const avgExp = hist ? prev.reduce((s, p) => s + p.expense, 0) / hist : null;
  const avgInc = hist ? prev.reduce((s, p) => s + p.income, 0) / hist : null;
  const avgTxt = v => v == null ? 'sin meses anteriores con datos' : `media de ${hist} mes${hist > 1 ? 'es' : ''} anterior${hist > 1 ? 'es' : ''}: ${eur(v)}`;
  const scopeName = { todo: 'todas las cuentas que veo', mias: 'mis cuentas', comun: 'cuenta común' }[scope];
  const L = [];
  L.push(`RESUMEN FINANCIERO — ${monthLabel(ym).toUpperCase()}`);
  L.push(`Alcance: ${scopeName}. Generado desde la app el ${new Date().toLocaleDateString('es-ES')}.`);
  L.push('');
  L.push(`Ingresos: ${eur(tt.income)} (${avgTxt(avgInc)})`);
  for (const [c, v] of incomeBreakdown(state, txs)) L.push(`  · ${c}: ${eur(v)}`);
  L.push(`Gastos: ${eur(tt.expense)} (${avgTxt(avgExp)})`);
  L.push(`Resultado (ingresos − gastos): ${eur(tt.result, { sign: true })}`);
  if (tt.income > 0) L.push(`Tasa de ahorro: ${Math.round((tt.result / tt.income) * 100)} %`);
  if (Math.abs(tt.saved) > 0.004) L.push(`Apartado a ahorro/inversión: ${eur(tt.saved)}`);
  if (Math.abs(tt.contrib) > 0.004) L.push(`Aportaciones entre cuentas (neto): ${eur(tt.contrib, { sign: true })}`);
  if (tt.pendingCount) L.push(`Movimientos sin clasificar: ${tt.pendingCount} (neto ${eur(tt.pending, { sign: true })}) — no incluidos arriba.`);
  L.push('');
  L.push(`GASTOS POR CATEGORÍA (mes · mes anterior · media de ${hist || 0} meses anteriores con datos) y comercios principales:`);
  const cats = breakdown(state, ids, ym, {});
  for (const c of cats.items) {
    L.push(`- ${c.label}: ${eur(c.cur)} · ${eur(c.prev)} · ${hist ? eur(c.avg3) : '—'}${c.avg3 > 0 ? ` (${pct(c.cur / c.avg3 - 1)} vs media)` : ''}`);
    const subs = breakdown(state, ids, ym, { cat: c.key });
    for (const s of subs.items.filter(s => s.cur > 0)) {
      const mers = breakdown(state, ids, ym, { cat: c.key, sub: s.key }).items.filter(m => m.cur > 0).slice(0, 5);
      L.push(`    · ${s.label}: ${eur(s.cur)} — ${mers.map(m => `${m.label} ${eur(m.cur)} (${m.count} mov.)`).join('; ')}`);
    }
  }
  const projs = (state.projects || []).filter(p => !p.archived);
  if (projs.length) {
    L.push('');
    L.push('PROYECTOS DE AHORRO:');
    const today = new Date().toISOString().slice(0, 10);
    for (const p of projs) {
      const st = projectStats(p, state.contributions, today);
      L.push(`- ${p.name}: ${eur(st.saved)} de ${eur(st.target)} (${Math.round(st.progress * 100)} %)` +
        `${p.deadline ? `, objetivo ${p.deadline}` : ''}${st.needed != null ? `, necesita ${eur(st.needed)}/mes` : ''}` +
        `${st.pace > 0 ? `, ritmo ${eur(st.pace)}/mes` : ', sin aportes recientes'} — ${STATUS_LABEL[st.status]}`);
    }
  }
  L.push('');
  L.push('SALDOS A FIN DE MES:');
  for (const a of state.accounts.filter(a => !a.archived)) {
    const s = summaries?.find(x => x.account_id === a.id);
    const owner = a.owner_member_id ? state.memberById.get(a.owner_member_id)?.name : 'Común';
    const visible = state.visible.has(a.id);
    let line = `- ${a.alias} (${BANK_LABEL[a.bank]}, ${owner}): saldo ${s?.balance != null ? eur(+s.balance) : 'sin dato'}`;
    if (a.kind === 'inversion') {
      const snap = (state.snapshots || []).filter(x => x.account_id === a.id && x.date <= monthRange(ym)[1]).sort((x, y) => x.date.localeCompare(y.date)).at(-1);
      line = `- ${a.alias} (inversión, ${owner}): ${snap ? `valor ${eur(+snap.value)} a ${snap.date}${snap.invested != null ? `, aportado ${eur(+snap.invested)}` : ''}` : 'sin valor anotado'}`;
    }
    if (!visible && s) line += ` · ingresos ${eur(+s.income)} · gastos ${eur(+s.expense)} (solo totales)`;
    L.push(line);
  }
  return L.join('\n');
}
