// Cálculos de proyectos: progreso, cuota mensual necesaria, ritmo y estado.

const DAY = 86400000;
const MONTH_DAYS = 30.4375;

const toDate = iso => new Date(iso + 'T12:00:00');
export const daysBetween = (a, b) => (toDate(b) - toDate(a)) / DAY;

function addMonthsIso(iso, months) {
  const d = new Date(toDate(iso).getTime() + months * MONTH_DAYS * DAY);
  return d.toISOString().slice(0, 10);
}

export function projectStats(p, contribs, today) {
  const list = contribs.filter(c => c.project_id === p.id).sort((a, b) => a.date.localeCompare(b.date));
  const saved = round(list.reduce((s, c) => s + +c.amount, 0));
  const target = +p.target;
  const remaining = round(Math.max(0, target - saved));
  const progress = Math.max(0, Math.min(1, saved / target));
  const done = saved >= target - 0.005;

  // Meses que quedan hasta la fecha objetivo (mínimo 1 para no dividir por 0)
  const monthsLeft = p.deadline ? daysBetween(today, p.deadline) / MONTH_DAYS : null;
  const overdue = p.deadline != null && monthsLeft < 0 && !done;
  const needed = !done && p.deadline && !overdue ? round(remaining / Math.max(1, monthsLeft)) : null;

  // Ritmo real: lo aportado en los últimos 3 meses (o desde el inicio si es más reciente)
  const from = daysBetween(p.start_date, today) < 91 ? p.start_date : addMonthsIso(today, -3);
  const windowMonths = Math.max(1, daysBetween(from, today) / MONTH_DAYS);
  const recent = list.filter(c => !c.is_initial && c.date >= from && c.date <= today).reduce((s, c) => s + +c.amount, 0);
  const pace = round(Math.max(0, recent / windowMonths));
  const projected = done ? null : pace > 0 ? addMonthsIso(today, remaining / pace) : null;

  // Estado: compara lo ahorrado con lo que tocaría llevar si se ahorrase a ritmo constante
  let status = 'sinplazo';
  if (done) status = 'done';
  else if (overdue) status = 'bad';
  else if (p.deadline) {
    const total = Math.max(1, daysBetween(p.start_date, p.deadline));
    const elapsed = Math.min(total, Math.max(0, daysBetween(p.start_date, today)));
    const expected = target * (elapsed / total);
    const gap = expected - saved;
    const perMonth = target / Math.max(1, total / MONTH_DAYS);
    status = gap <= perMonth * 0.5 ? 'ok' : gap <= perMonth * 2 ? 'warn' : 'bad';
  }
  return { list, saved, target, remaining, progress, done, monthsLeft, overdue, needed, pace, projected, status };
}

export const STATUS_LABEL = {
  done: '¡Conseguido!', ok: 'Al día', warn: 'Algo por detrás', bad: 'Muy por detrás', sinplazo: 'Sin fecha límite',
};

// Dinero apartado para proyectos en cada cuenta.
export function reservedByAccount(projects, contribs) {
  const m = new Map();
  for (const p of projects) {
    if (p.archived || !p.account_id) continue;
    const s = contribs.filter(c => c.project_id === p.id).reduce((a, c) => a + +c.amount, 0);
    m.set(p.account_id, (m.get(p.account_id) || 0) + s);
  }
  return m;
}

function round(n) { return Math.round(n * 100) / 100; }

export const EMOJIS = ['🚢', '✈️', '🏖️', '🚐', '🏠', '🚗', '🎓', '💍', '🎁', '🛟', '🛠️', '💡'];
