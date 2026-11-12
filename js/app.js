import { sb, auth, loadMe, createHousehold, joinHousehold, loadHousehold, loadTransactions, accountSummaries, api, uploadPhoto, photoUrl, deletePhoto } from './db.js';
import { $, $$, esc, eur, pct, monthLabel, monthShort, dateLabel, todayIso, addMonths, monthRange, periodOf, periodHint, setMonthStart, monthStart, toast, sheet, confirmBox, busy, download, TYPE_LABEL, BANK_LABEL } from './ui.js';
import { sortRules, suggestPattern, extractMerchant, norm, findRule } from './classify.js';
import { analyzeFile, commitImport, headerText } from './importer.js';
import { scopeAccountIds, txOfMonth, totals, breakdown, series, incomeBreakdown, summaryText, inPath, historyMonths } from './analysis.js';
import { APP_VERSION } from './config.js';
import { projectStats, STATUS_LABEL, reservedByAccount, EMOJIS } from './projects.js';

const view = $('#view');
const nav = $('#nav');
const topbar = $('#topbar');

const state = {
  session: null, me: null, household: null, members: [], memberById: new Map(),
  accounts: [], visible: new Set(), categories: [], catById: new Map(), rules: [], sortedRules: [],
  tx: [], loaded: false, projects: [], contributions: [], snapshots: [],
  recovery: !!window.__recovery,
  month: todayIso().slice(0, 7),
  scope: lsGet('scope') || 'todo',
  path: {},
};

function lsGet(k) { try { return localStorage.getItem('ff-' + k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem('ff-' + k, v); } catch { /* sin almacenamiento */ } }

// ---------- Carga ----------
async function boot() {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { state.session = session; state.recovery = true; renderNewPassword(); return; }
    if (event === 'SIGNED_OUT') { Object.assign(state, { session: null, me: null, loaded: false, tx: [] }); route(); }
  });
  try { state.session = await auth.session(); } catch (e) { toast(e.message, 'error'); }
  if (/access_token|error_code|type=recovery/.test(location.hash)) history.replaceState(null, '', location.pathname);
  if (window.__authError) {
    toast(window.__authError === 'otp_expired' ? 'Ese enlace ya se usó o ha caducado. Usa siempre el correo más reciente.' : 'El enlace del correo no es válido.', 'error');
  }
  await afterLogin();
}

async function afterLogin() {
  if (!state.session) return route();
  if (state.recovery) return renderNewPassword();
  state.me = await loadMe(state.session.user.id);
  if (state.me) await reload();
  route();
}

async function reload() {
  const h = await loadHousehold();
  Object.assign(state, h);
  const prevStart = monthStart();
  setMonthStart(state.household.month_start_day);
  if (!state.loaded || prevStart !== monthStart()) state.month = periodOf(todayIso());
  state.memberById = new Map(state.members.map(m => [m.id, m]));
  state.catById = new Map(state.categories.map(c => [c.id, c]));
  state.sortedRules = sortRules(state.rules);
  state.visible = new Set(state.accounts.filter(a => a.owner_member_id == null || a.owner_member_id === state.me.id).map(a => a.id));
  state.tx = await loadTransactions();
  state.loaded = true;
}

const accById = id => state.accounts.find(a => a.id === id);
const myAccounts = () => state.accounts.filter(a => state.visible.has(a.id) && !a.archived);
const ownerName = a => a.owner_member_id ? (state.memberById.get(a.owner_member_id)?.name ?? '¿?') : 'Común';
const catName = id => {
  const c = state.catById.get(id);
  if (!c) return '';
  const p = c.parent_id ? state.catById.get(c.parent_id) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
};
const pendingTx = () => state.tx.filter(t => t.tx_type === 'pendiente' && state.visible.has(t.account_id));

// ---------- Rutas ----------
const routes = {
  '': renderInicio, inicio: renderInicio, movimientos: renderMovimientos, analisis: renderAnalisis,
  bandeja: renderBandeja, importar: renderImportar, nuevo: renderNuevo, mas: renderMas, resumen: renderResumen,
  cuentas: renderCuentas, categorias: renderCategorias, reglas: renderReglas, hogar: renderHogar,
  proyectos: renderProyectos, proyecto: renderProyecto,
};

window.addEventListener('hashchange', route);

function route() {
  view.onclick = null; view.onchange = null; view.oninput = null; view.onsubmit = null;
  if (!state.session) return renderAuth();
  if (state.recovery) return renderNewPassword();
  if (!state.me) return renderOnboarding();
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  const fn = routes[name] || renderInicio;
  nav.hidden = false;
  $$('a', nav).forEach(a => a.classList.toggle('on', a.dataset.r === (name || 'inicio') || (a.dataset.r === 'proyectos' && name === 'proyecto')));
  window.scrollTo(0, 0);
  fn();
}

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function setTop(title, right = '') {
  topbar.innerHTML = `<h1>${esc(title)}</h1><div class="top-right">${right}</div>`;
}

// Selector de mes y alcance compartido
function periodBar({ scope = true } = {}) {
  const sc = [['todo', 'Todo'], ['mias', 'Mis cuentas'], ['comun', 'Común']];
  return `<div class="period">
    <div class="monthbar"><button class="icon-btn" data-act="prevm" aria-label="Mes anterior">‹</button>
    <span class="month">${monthLabel(state.month)}${periodHint(state.month) ? `<small>${periodHint(state.month)}</small>` : ''}</span>
    <button class="icon-btn" data-act="nextm" aria-label="Mes siguiente">›</button></div>
    ${scope ? `<div class="chips">${sc.map(([k, l]) => `<button class="chip ${state.scope === k ? 'on' : ''}" data-act="scope" data-v="${k}">${l}</button>`).join('')}</div>` : ''}
  </div>`;
}

function periodActions(a, rerender) {
  if (a.dataset.act === 'prevm') { state.month = addMonths(state.month, -1); rerender(); return true; }
  if (a.dataset.act === 'nextm') { state.month = addMonths(state.month, 1); rerender(); return true; }
  if (a.dataset.act === 'scope') { state.scope = a.dataset.v; lsSet('scope', state.scope); rerender(); return true; }
  return false;
}

// ---------- Acceso ----------
function renderAuth() {
  nav.hidden = true;
  topbar.innerHTML = '';
  view.innerHTML = `<div class="auth">
    <div class="brand"><img src="icons/icon-192.png" alt="" width="64" height="64"><h1>Finanzas en casa</h1><p>Vuestro dinero, claro y al detalle.</p></div>
    <form class="card form" id="authForm">
      <div class="seg" role="tablist"><button type="button" class="on" data-mode="in">Entrar</button><button type="button" data-mode="up">Crear cuenta</button></div>
      <label>Correo<input type="email" name="email" autocomplete="email" required></label>
      <label>Contraseña<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
      <button class="btn primary block" type="submit">Entrar</button>
      <button class="link" type="button" data-act="forgot">He olvidado la contraseña</button>
    </form></div>`;
  let mode = 'in';
  const f = $('#authForm');
  $$('.seg button', f).forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$('.seg button', f).forEach(x => x.classList.toggle('on', x === b));
    f.querySelector('[type=submit]').textContent = mode === 'in' ? 'Entrar' : 'Crear cuenta';
    f.password.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
  });
  f.querySelector('[data-act=forgot]').onclick = () => busy(null, async () => {
    if (!f.email.value) return toast('Escribe primero tu correo.');
    await auth.resetPassword(f.email.value.trim());
    toast('Correo enviado. Abre solo el más reciente: los anteriores dejan de valer. Puede tardar unos minutos.');
  });
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('[type=submit]'), async () => {
      const email = f.email.value.trim(), pw = f.password.value;
      if (mode === 'in') {
        const d = await auth.signIn(email, pw);
        state.session = d.session;
        await afterLogin();
      } else {
        const d = await auth.signUp(email, pw);
        if (d.session) { state.session = d.session; await afterLogin(); }
        else toast('Cuenta creada. Confirma el correo que te he enviado y vuelve a entrar.');
      }
    });
  };
}

function renderNewPassword() {
  nav.hidden = true;
  topbar.innerHTML = '';
  view.innerHTML = `<form class="card form auth" id="pw"><h2>Elige tu contraseña nueva</h2>
    <p class="muted small">Has entrado con el enlace del correo. Pon la contraseña que usarás a partir de ahora.</p>
    <label>Contraseña nueva<input type="password" name="pw" minlength="6" autocomplete="new-password" required></label>
    <label>Repítela<input type="password" name="pw2" minlength="6" autocomplete="new-password" required></label>
    <button class="btn primary block">Guardar contraseña</button></form>`;
  $('#pw').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    if (f.pw.value !== f.pw2.value) return toast('Las dos contraseñas no coinciden.', 'error');
    busy(f.querySelector('button'), async () => {
      await auth.updatePassword(f.pw.value);
      state.recovery = false;
      toast('Contraseña cambiada. La próxima vez entra con ella.');
      location.hash = '#/inicio';
      await afterLogin();
    });
  };
}

function changePassword() {
  const s = sheet(`<h2>Cambiar contraseña</h2><form class="form" id="cpw">
    <label>Contraseña nueva<input type="password" name="pw" minlength="6" autocomplete="new-password" required></label>
    <label>Repítela<input type="password" name="pw2" minlength="6" autocomplete="new-password" required></label>
    <button class="btn primary block">Guardar</button></form>`);
  const f = $('#cpw', s.el);
  f.onsubmit = e => {
    e.preventDefault();
    if (f.pw.value !== f.pw2.value) return toast('Las dos contraseñas no coinciden.', 'error');
    busy(f.querySelector('button'), async () => { await auth.updatePassword(f.pw.value); s.close(); toast('Contraseña cambiada'); });
  };
}

function renderOnboarding() {
  nav.hidden = true;
  setTop('Bienvenido');
  view.innerHTML = `<p class="lead">Primero, el hogar. Quien empieza lo crea; el otro se une con un código.</p>
    <form class="card form" id="create"><h2>Crear el hogar</h2>
      <label>Nombre del hogar<input name="name" value="Familia" required></label>
      <label>Tu nombre<input name="me" placeholder="Tu nombre" required></label>
      <button class="btn primary block">Crear</button></form>
    <form class="card form" id="join"><h2>Unirme a un hogar</h2>
      <label>Código de invitación<input name="code" autocapitalize="off" autocomplete="off" required></label>
      <label>Tu nombre<input name="me" placeholder="Tu nombre" required></label>
      <button class="btn block">Unirme</button></form>
    <button class="link" data-act="logout">Cerrar sesión</button>`;
  $('#create').onsubmit = e => { e.preventDefault(); const f = e.target; busy(f.querySelector('button'), async () => { await createHousehold(f.name.value, f.me.value); await afterLogin(); location.hash = '#/cuentas'; }); };
  $('#join').onsubmit = e => { e.preventDefault(); const f = e.target; busy(f.querySelector('button'), async () => { await joinHousehold(f.code.value, f.me.value); await afterLogin(); location.hash = '#/cuentas'; }); };
  view.onclick = e => { if (e.target.closest('[data-act=logout]')) auth.signOut(); };
}

// ---------- Inicio ----------
async function renderInicio() {
  setTop(state.household.name, `<button class="icon-btn" data-go="#/importar" aria-label="Importar extracto">${ICON.upload}</button><button class="icon-btn" data-go="#/mas" aria-label="Ajustes y más">${ICON.gear}</button>`);
  if (!myAccounts().length) {
    view.innerHTML = `<div class="empty card"><h2>Añade tus cuentas</h2><p>Antes de importar, crea las cuentas: tu banco, la común, Revolut…</p><a class="btn primary" href="#/cuentas">Añadir cuentas</a></div>`;
    return;
  }
  const ids = scopeAccountIds(state, state.scope);
  const txs = txOfMonth(state, state.month, ids);
  const t = totals(txs);
  const prev = [1, 2, 3].map(i => totals(txOfMonth(state, addMonths(state.month, -i), ids)));
  const hist = historyMonths(state, ids, state.month);
  const avgExp = hist ? prev.reduce((s, p) => s + p.expense, 0) / hist : 0;
  const pend = pendingTx();
  const cats = breakdown(state, ids, state.month, {});
  const maxCat = Math.max(1, ...cats.items.map(c => c.cur));
  const rate = t.income > 0 ? Math.round((t.result / t.income) * 100) : null;

  view.innerHTML = `${periodBar()}
    <section class="kpis">
      <div class="kpi"><span>Ingresos</span><strong class="pos">${eur(t.income)}</strong>${state.month === periodOf(todayIso()) ? `<small>Mes en curso: quedan ${Math.max(0, Math.round((Date.parse(monthRange(state.month)[1]) - Date.parse(todayIso())) / 86400000))} días</small>` : ''}</div>
      <div class="kpi"><span>Gastos</span><strong>${eur(t.expense)}</strong><small>${avgExp > 0 ? `${pct(t.expense / avgExp - 1)} vs media de ${hist} mes${hist > 1 ? 'es' : ''}` : 'Sin meses anteriores para comparar'}</small></div>
      <div class="kpi wide ${t.result < 0 ? 'bad' : 'good'}"><span>Resultado del mes</span><strong>${eur(t.result, { sign: true })}</strong><small>${rate != null ? `Tasa de ahorro ${rate} %` : ''}${Math.abs(t.saved) > 0.004 ? ` · Apartado a ahorro ${eur(t.saved)}` : ''}</small></div>
    </section>
    ${pend.length ? `<a class="card alert" href="#/bandeja"><div><strong>${pend.length} movimiento${pend.length > 1 ? 's' : ''} por revisar</strong><span>No cuentan en los totales hasta que los clasifiques.</span></div>${ICON.chev}</a>` : ''}
    <section class="card">
      <div class="card-h"><h2>En qué se va el dinero</h2><a href="#/analisis" class="link">Ver detalle</a></div>
      ${cats.items.length ? `<ul class="bars">${cats.items.slice(0, 6).map(c => `
        <li data-cat="${esc(c.key)}"><div class="bar-top"><span>${esc(c.label)}</span><b>${eur(c.cur)}</b></div>
        <div class="bar"><i style="width:${Math.max(2, (c.cur / maxCat) * 100)}%"></i></div>
        <small class="${deltaClass(c)}">${deltaText(c)}</small></li>`).join('')}</ul>` : '<p class="muted">Sin gastos clasificados este mes.</p>'}
    </section>
    ${projectsCard()}
    <section class="card" id="saldos"><div class="card-h"><h2>Cuentas</h2></div><p class="muted">Cargando…</p></section>
    <div class="row-btns"><a class="btn" href="#/importar">${ICON.upload} Importar extracto</a><a class="btn" href="#/resumen">${ICON.doc} Resumen del mes</a></div>`;

  view.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (a && periodActions(a, renderInicio)) return;
    const c = e.target.closest('[data-cat]');
    if (c) { state.path = { cat: c.dataset.cat }; go('#/analisis'); }
    const v = e.target.closest('[data-val]');
    if (v) valuationForm(accById(v.dataset.val), renderInicio);
  };
  topbar.onclick = e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); };

  try {
    const [from, to] = monthRange(state.month);
    const sums = await accountSummaries(from, to);
    const box = $('#saldos');
    if (!box) return;
    const reserved = reservedByAccount(state.projects, state.contributions);
    const rows = state.accounts.filter(a => !a.archived).map(a => {
      const s = sums.find(x => x.account_id === a.id);
      const vis = state.visible.has(a.id);
      const res = reserved.get(a.id) || 0;
      if (a.kind === 'inversion' && vis) {
        const snap = lastSnapshot(a.id, monthRange(state.month)[1]);
        const gain = snap && snap.invested != null ? +snap.value - +snap.invested : null;
        return `<li><div><b>${esc(a.alias)}</b><small>${BANK_LABEL[a.bank]} · ${esc(ownerName(a))} · inversión</small>
          ${gain != null ? `<small class="${gain >= 0 ? 'pos' : 'neg'}">Aportado ${eur(+snap.invested)} · ${eur(gain, { sign: true })} (${pct(gain / +snap.invested)})</small>` : ''}
          ${res > 0.004 ? `<small class="reserved">${eur(res)} apartados para proyectos</small>` : ''}
          <button class="link small" data-val="${a.id}">Actualizar valor</button></div>
          <div class="right"><b>${snap ? eur(+snap.value) : '—'}</b>${snap ? `<small>a ${dateLabel(snap.date)}</small>` : ''}</div></li>`;
      }
      return `<li><div><b>${esc(a.alias)}</b><small>${BANK_LABEL[a.bank]} · ${esc(ownerName(a))}${vis ? '' : ' · solo totales'}</small>
        ${vis ? '' : `<small>Ingresos ${eur(+s?.income || 0)} · Gastos ${eur(+s?.expense || 0)}</small>`}
        ${res > 0.004 ? `<small class="reserved">${eur(res)} apartados para proyectos${s?.balance != null ? ` · libre ${eur(+s.balance - res)}` : ''}</small>` : ''}</div>
        <div class="right"><b class="${+s?.balance < 0 ? 'neg' : ''}">${s?.balance != null ? eur(+s.balance) : '—'}</b>${s?.balance_date ? `<small>a ${dateLabel(s.balance_date)}</small>` : ''}</div></li>`;
    });
    box.innerHTML = `<div class="card-h"><h2>Cuentas</h2><a class="link" href="#/cuentas">Gestionar</a></div><ul class="list">${rows.join('')}</ul>`;
  } catch (e) { console.error(e); }
}

function deltaText(c) {
  if (!c.hist) return '';
  if (c.avg3 <= 0.005) return c.cur > 0 ? 'Nuevo: no aparece en los meses anteriores' : '';
  if (c.avg3 < 15) return `Media de ${c.hist} mes${c.hist > 1 ? 'es' : ''}: ${eur(c.avg3)}`;
  return `${pct(c.cur / c.avg3 - 1)} vs media de ${c.hist} mes${c.hist > 1 ? 'es' : ''} (${eur(c.avg3, { decimals: false })})`;
}
function deltaClass(c) {
  if (c.avg3 <= 0.005) return 'muted';
  const r = c.cur / c.avg3 - 1;
  return r > 0.15 ? 'neg' : r < -0.15 ? 'pos' : 'muted';
}

// ---------- Movimientos ----------
const movFilter = { account: '', type: '', q: '' };

function renderMovimientos() {
  const pend = pendingTx().length;
  setTop('Movimientos', `<button class="icon-btn" data-go="#/importar" aria-label="Importar">${ICON.upload}</button>`);
  topbar.onclick = e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); };
  const accs = myAccounts();
  view.innerHTML = `${periodBar({ scope: false })}
    <div class="filters">
      <input type="search" id="q" placeholder="Buscar comercio o concepto (todos los meses)" value="${esc(movFilter.q)}">
      <div class="filters-row">
        <select id="fa"><option value="">Todas las cuentas</option>${accs.map(a => `<option value="${a.id}" ${movFilter.account === a.id ? 'selected' : ''}>${esc(a.alias)}</option>`).join('')}</select>
        <select id="ft"><option value="">Todos los tipos</option>${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${movFilter.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    ${pend ? `<a class="card alert slim" href="#/bandeja"><span><strong>${pend}</strong> por revisar</span>${ICON.chev}</a>` : ''}
    <div id="txlist"></div>`;
  const draw = () => {
    const q = norm(movFilter.q);
    let list = state.tx.filter(t => state.visible.has(t.account_id));
    if (!q) list = list.filter(t => periodOf(t.date) === state.month);
    else list = list.filter(t => norm(`${t.merchant} ${t.raw_desc} ${t.note ?? ''}`).includes(q));
    if (movFilter.account) list = list.filter(t => t.account_id === movFilter.account);
    if (movFilter.type) list = list.filter(t => t.tx_type === movFilter.type);
    const box = $('#txlist');
    if (!list.length) { box.innerHTML = `<p class="muted center">Sin movimientos${q ? ' que coincidan' : ' este mes'}.</p>`; return; }
    const shown = list.slice(0, 400);
    let html = '', last = '';
    for (const t of shown) {
      if (t.date !== last) { html += `<h3 class="day">${dateLabel(t.date)}</h3>`; last = t.date; }
      html += txRow(t);
    }
    if (list.length > shown.length) html += `<p class="muted center">Mostrando 400 de ${list.length}. Afina la búsqueda.</p>`;
    box.innerHTML = html;
  };
  draw();
  view.oninput = e => { if (e.target.id === 'q') { movFilter.q = e.target.value; draw(); } };
  view.onchange = e => {
    if (e.target.id === 'fa') { movFilter.account = e.target.value; draw(); }
    if (e.target.id === 'ft') { movFilter.type = e.target.value; draw(); }
  };
  view.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (a && periodActions(a, renderMovimientos)) return;
    const r = e.target.closest('[data-tx]');
    if (r) editTx(r.dataset.tx, renderMovimientos);
  };
}

function txRow(t) {
  const acc = accById(t.account_id);
  const sub = t.tx_type === 'gasto' || t.tx_type === 'ingreso' ? (catName(t.category_id) || 'Sin categoría') : TYPE_LABEL[t.tx_type];
  const cls = t.tx_type === 'pendiente' ? 'pending' : ['interna', 'aportacion', 'ahorro', 'inversion'].includes(t.tx_type) ? 'neutral' : '';
  return `<button class="tx ${cls}" data-tx="${t.id}">
    <span class="tx-main"><b>${esc(t.merchant || 'Sin comercio')}</b><small>${esc(sub)} · ${esc(acc?.alias ?? '')}${t.photo_path ? ' · 📷' : ''}</small></span>
    <span class="tx-amt ${+t.amount > 0 ? 'pos' : ''}">${eur(+t.amount, { sign: true })}</span></button>`;
}

function categoryOptions(kind, selected) {
  const parents = state.categories.filter(c => !c.parent_id && c.kind === kind);
  return parents.map(p => `<optgroup label="${esc(p.name)}">${state.categories.filter(c => c.parent_id === p.id).map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}

function typeOptions(selected, { pending = false } = {}) {
  return Object.entries(TYPE_LABEL).filter(([k]) => pending || k !== 'pendiente').map(([k, l]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function editTx(id, after) {
  const t = state.tx.find(x => x.id === id);
  if (!t) return;
  const acc = accById(t.account_id);
  const kind = t.tx_type === 'ingreso' || (t.tx_type === 'pendiente' && +t.amount > 0) ? 'ingreso' : 'gasto';
  const s = sheet(`<h2>${eur(+t.amount, { sign: true })}</h2>
    <p class="muted">${dateLabel(t.date)} · ${esc(acc?.alias ?? '')} · ${t.source === 'manual' ? 'apuntado a mano' : 'importado'}</p>
    ${t.raw_desc ? `<p class="raw">${esc(t.raw_desc)}</p>` : ''}
    <form class="form" id="ef">
      <label>Comercio<input name="merchant" value="${esc(t.merchant ?? '')}" list="merchants"></label>
      <label>Tipo<select name="tx_type">${typeOptions(t.tx_type, { pending: true })}</select></label>
      <label class="catfield">Categoría<select name="category_id"><option value="">Sin categoría</option>${categoryOptions(kind, t.category_id)}</select></label>
      <label>Nota<input name="note" value="${esc(t.note ?? '')}"></label>
      <label class="check"><input type="checkbox" name="all"> Aplicar a todos los movimientos de este comercio y recordarlo</label>
      <div class="photo-box">${t.photo_path ? '<button type="button" class="btn ghost" data-photo>Ver foto del ticket</button>' : ''}
        <label class="btn ghost file">${t.photo_path ? 'Cambiar foto' : 'Añadir foto del ticket'}<input type="file" name="photo" accept="image/*" capture="environment" hidden></label></div>
      <div class="row-btns"><button type="button" class="btn danger ghost" data-del>Eliminar</button><button class="btn primary">Guardar</button></div>
    </form>${merchantDatalist()}`);
  const f = $('#ef', s.el);
  const syncCat = () => {
    const tp = f.tx_type.value;
    $('.catfield', f).hidden = !(tp === 'gasto' || tp === 'ingreso');
    const k = tp === 'ingreso' ? 'ingreso' : 'gasto';
    f.category_id.innerHTML = `<option value="">Sin categoría</option>${categoryOptions(k, t.category_id)}`;
  };
  syncCat();
  f.tx_type.onchange = syncCat;
  s.el.querySelector('[data-photo]')?.addEventListener('click', () => busy(null, async () => showPhoto(await photoUrl(t.photo_path))));
  s.el.querySelector('[data-del]').onclick = async () => {
    if (!await confirmBox(t.source === 'importado' ? 'Si vuelves a importar este periodo, el movimiento volverá a aparecer. ¿Eliminar?' : '¿Eliminar este movimiento?', 'Eliminar')) return;
    await busy(null, async () => {
      if (t.photo_path) await deletePhoto(t.photo_path).catch(() => {});
      await api.remove('transactions', t.id);
      state.tx = state.tx.filter(x => x.id !== t.id);
      s.close(); toast('Eliminado'); after?.();
    });
  };
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const tp = f.tx_type.value;
      const patch = {
        merchant: f.merchant.value.trim() || null, tx_type: tp,
        category_id: (tp === 'gasto' || tp === 'ingreso') ? (f.category_id.value || null) : null,
        note: f.note.value.trim() || null,
      };
      const file = f.photo.files[0];
      if (file) {
        const path = await uploadPhoto(state.household.id, t.account_id, await shrinkImage(file));
        if (t.photo_path) await deletePhoto(t.photo_path).catch(() => {});
        patch.photo_path = path;
      }
      const upd = await api.update('transactions', t.id, patch);
      Object.assign(t, upd);
      if (f.all.checked && patch.merchant && t.source === 'importado') {
        await learnRule(t, { pattern: suggestPattern(acc.bank, t.raw_desc), merchant: patch.merchant, tx_type: tp, category_id: patch.category_id, origin: 'manual' });
      } else if (f.all.checked && patch.merchant) {
        await applyToMerchant(t.merchant, patch, t.id);
      }
      s.close(); toast('Guardado'); after?.();
    });
  };
}

function merchantDatalist() {
  const names = [...new Set(state.tx.map(t => t.merchant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  return `<datalist id="merchants">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}

async function applyToMerchant(merchant, patch, exceptId) {
  const ids = state.tx.filter(x => x.id !== exceptId && x.merchant === merchant && state.visible.has(x.account_id)).map(x => x.id);
  for (let i = 0; i < ids.length; i += 200) {
    await api.updateWhere('transactions', { tx_type: patch.tx_type, category_id: patch.category_id }, q => q.in('id', ids.slice(i, i + 200)));
  }
  state.tx.forEach(x => { if (ids.includes(x.id)) Object.assign(x, { tx_type: patch.tx_type, category_id: patch.category_id }); });
}

// Crea la regla y la aplica a los movimientos sin clasificar (y a los del mismo comercio).
async function learnRule(t, { pattern, merchant, tx_type, category_id, origin = 'aprendida' }) {
  const acc = accById(t.account_id);
  const rule = await api.insert('rules', {
    household_id: state.household.id, pattern: norm(pattern), merchant, tx_type, category_id,
    bank: acc.bank, sign: +t.amount >= 0 ? '+' : '-', priority: 10, origin,
  });
  state.rules.push(rule);
  state.sortedRules = sortRules(state.rules);
  const targets = state.tx.filter(x => {
    if (!state.visible.has(x.account_id)) return false;
    const a = accById(x.account_id);
    if (a.bank !== acc.bank) return false;
    if (x.tx_type !== 'pendiente' && x.merchant !== t.merchant && x.id !== t.id) return false;
    return findRule([rule], a.bank, { desc: x.raw_desc, amount: +x.amount }) != null;
  });
  const ids = targets.map(x => x.id);
  const patch = { merchant, tx_type, category_id };
  for (let i = 0; i < ids.length; i += 200) await api.updateWhere('transactions', patch, q => q.in('id', ids.slice(i, i + 200)));
  targets.forEach(x => Object.assign(x, patch));
  return ids.length;
}

function showPhoto(url) {
  sheet(`<img class="ticket" src="${esc(url)}" alt="Foto del ticket">`);
}

async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1_500_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return new File([blob], 'ticket.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

// ---------- Bandeja ----------
function pendingGroups() {
  const groups = new Map();
  for (const t of pendingTx()) {
    const acc = accById(t.account_id);
    const key = `${acc.bank}|${+t.amount >= 0 ? '+' : '-'}|${suggestPattern(acc.bank, t.raw_desc)}`;
    if (!groups.has(key)) groups.set(key, { key, bank: acc.bank, items: [] });
    groups.get(key).items.push(t);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || Math.abs(sum(b.items)) - Math.abs(sum(a.items)));
}
const sum = items => items.reduce((s, t) => s + +t.amount, 0);
let bandejaSkip = new Set();

function counterpart(t) {
  return state.tx.find(x => x.id !== t.id && x.account_id !== t.account_id && state.visible.has(x.account_id)
    && Math.abs(+x.amount + +t.amount) < 0.005 && Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 4 * 86400000);
}

function renderBandeja() {
  setTop('Por revisar');
  const groups = pendingGroups().filter(g => !bandejaSkip.has(g.key));
  const total = pendingTx().length;
  if (!groups.length) {
    view.innerHTML = `<div class="empty card"><h2>${total ? 'Has saltado todos' : 'Todo clasificado'}</h2><p>${total ? `Quedan ${total} movimientos que has dejado para luego.` : 'No hay movimientos pendientes.'}</p>
      ${total ? '<button class="btn" data-act="reset">Volver a verlos</button>' : '<a class="btn primary" href="#/analisis">Ver análisis</a>'}</div>`;
    view.onclick = e => { if (e.target.closest('[data-act=reset]')) { bandejaSkip = new Set(); renderBandeja(); } };
    return;
  }
  const g = groups[0];
  const t0 = g.items[0];
  const acc = accById(t0.account_id);
  const income = +t0.amount > 0;
  const cp = g.items.length === 1 ? counterpart(t0) : null;
  const guessType = cp ? 'interna' : income ? 'ingreso' : 'gasto';
  const merchant = extractMerchant(acc.bank, t0.raw_desc);
  const types = [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['interna', 'Entre mis cuentas'], ['aportacion', 'Aportación'], ['ahorro', 'Ahorro'], ['inversion', 'Inversión']];
  view.innerHTML = `<p class="muted center">${total} movimiento${total > 1 ? 's' : ''} en ${groups.length} grupo${groups.length > 1 ? 's' : ''}</p>
    <form class="card form inbox" id="bf">
      <div class="inbox-h"><div><b>${esc(merchant)}</b><small>${g.items.length} movimiento${g.items.length > 1 ? 's' : ''} · ${BANK_LABEL[acc.bank]}</small></div><strong class="${income ? 'pos' : ''}">${eur(sum(g.items), { sign: true })}</strong></div>
      <ul class="mini">${g.items.slice(0, 4).map(t => `<li><span>${dateLabel(t.date)}</span><span class="raw">${esc(t.raw_desc)}</span><b>${eur(+t.amount, { sign: true })}</b></li>`).join('')}${g.items.length > 4 ? `<li class="muted">y ${g.items.length - 4} más</li>` : ''}</ul>
      ${cp ? `<p class="hint">Parece un movimiento entre vuestras cuentas: coincide con ${eur(+cp.amount, { sign: true })} en ${esc(accById(cp.account_id).alias)} el ${dateLabel(cp.date)}.</p>` : ''}
      <label>Comercio<input name="merchant" value="${esc(merchant)}" list="merchants" required></label>
      <fieldset class="seg wrap" id="tp">${types.map(([k, l]) => `<label><input type="radio" name="tx_type" value="${k}" ${k === guessType ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
      <label class="catfield">Categoría<select name="category_id" required></select></label>
      <label class="check"><input type="checkbox" name="learn" checked> Recordar: clasificar así lo que contenga</label>
      <input name="pattern" value="${esc(suggestPattern(acc.bank, t0.raw_desc))}" aria-label="Texto que identifica a este comercio">
      <div class="row-btns"><button type="button" class="btn ghost" data-act="skip">Saltar</button><button class="btn primary">Guardar</button></div>
    </form>${merchantDatalist()}`;
  const f = $('#bf');
  const last = {};
  const syncCat = () => {
    const tp = f.querySelector('[name=tx_type]:checked').value;
    const need = tp === 'gasto' || tp === 'ingreso';
    $('.catfield', f).hidden = !need;
    f.category_id.required = need;
    const prevSame = state.tx.find(x => x.merchant === f.merchant.value && x.category_id && state.catById.get(x.category_id)?.kind === (tp === 'ingreso' ? 'ingreso' : 'gasto'));
    f.category_id.innerHTML = `<option value="">Elige categoría…</option>${categoryOptions(tp === 'ingreso' ? 'ingreso' : 'gasto', last[tp] ?? prevSame?.category_id)}`;
  };
  syncCat();
  f.onchange = e => {
    if (e.target.name === 'tx_type') syncCat();
    if (e.target.name === 'category_id') last[f.querySelector('[name=tx_type]:checked').value] = e.target.value;
  };
  f.merchant.onchange = syncCat;
  f.learn.onchange = () => { f.pattern.hidden = !f.learn.checked; };
  view.onclick = e => {
    if (e.target.closest('[data-act=skip]')) { bandejaSkip.add(g.key); renderBandeja(); }
  };
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const tp = f.querySelector('[name=tx_type]:checked').value;
      const patch = { merchant: f.merchant.value.trim(), tx_type: tp, category_id: (tp === 'gasto' || tp === 'ingreso') ? f.category_id.value : null };
      const ids = g.items.map(t => t.id);
      for (let i = 0; i < ids.length; i += 200) await api.updateWhere('transactions', patch, q => q.in('id', ids.slice(i, i + 200)));
      g.items.forEach(t => Object.assign(t, patch));
      let extra = 0;
      if (f.learn.checked && f.pattern.value.trim().length >= 3) {
        extra = await learnRule(t0, { pattern: f.pattern.value, ...patch });
        extra = Math.max(0, extra - ids.length);
      }
      if (cp && tp === 'interna' && cp.tx_type === 'pendiente') {
        await api.update('transactions', cp.id, { tx_type: 'interna' });
        cp.tx_type = 'interna';
      }
      toast(extra > 0 ? `Guardado y aplicado a ${extra} más` : 'Guardado');
      renderBandeja();
    });
  };
}

// ---------- Importar ----------
function renderImportar() {
  setTop('Importar extracto');
  const accs = myAccounts().filter(a => a.kind !== 'inversion' && a.bank !== 'efectivo');
  if (!accs.length) { view.innerHTML = `<div class="empty card"><h2>Primero, una cuenta</h2><a class="btn primary" href="#/cuentas">Añadir cuentas</a></div>`; return; }
  const lastAcc = lsGet('lastImportAcc');
  const inv = myAccounts().filter(a => a.kind === 'inversion');
  view.innerHTML = `${inv.length ? `<div class="card hint-card"><p><b>Cuentas de inversión (${esc(inv.map(a => a.alias).join(', '))}):</b> no se importan. Lo que importa es su valor y lo aportado; las transferencias hacia ellas ya aparecen en la cuenta de origen como «Inversión».</p><div class="row-btns">${inv.map(a => `<button class="btn small" data-val="${a.id}">Actualizar ${esc(a.alias)}</button>`).join('')}</div></div>` : ''}
    <form class="card form" id="imf">
      <label>Cuenta<select name="account">${accs.map(a => `<option value="${a.id}" ${a.id === lastAcc ? 'selected' : ''}>${esc(a.alias)} · ${BANK_LABEL[a.bank]}</option>`).join('')}</select></label>
      <label class="drop"><input type="file" name="file" accept=".pdf,.csv,.xls,.xlsx,application/pdf" required><span>${ICON.upload}<b>Elige el extracto</b><small>PDF, Excel o CSV. Puedes importar periodos que se solapen: no se duplica nada.</small></span></label>
      <button class="btn primary block">Analizar</button>
    </form>
    <div id="impres"></div>
    <details class="card help"><summary>¿Cómo descargo el extracto?</summary>
      <ul><li><b>Santander:</b> en la web, Cuentas › Movimientos › descargar en Excel (o PDF).</li>
      <li><b>BBVA:</b> en la web, la cuenta › Movimientos › exportar a Excel (o PDF).</li>
      <li><b>Revolut:</b> en la app, la cuenta › Extracto › Excel/CSV (o PDF), en euros.</li></ul>
      <p class="muted">Cada semana basta con el último mes: lo repetido se descarta solo.</p></details>`;
  view.onclick = e => { const v = e.target.closest('[data-val]'); if (v) valuationForm(accById(v.dataset.val), () => toast('Valor guardado')); };
  const f = $('#imf');
  f.file.onchange = () => { const s = $('.drop b', f); s.textContent = f.file.files[0]?.name || 'Elige el extracto'; };
  f.onsubmit = e => {
    e.preventDefault();
    const account = accById(f.account.value);
    const file = f.file.files[0];
    lsSet('lastImportAcc', account.id);
    busy(f.querySelector('.primary'), () => runAnalysis(account, file));
  };
}

async function runAnalysis(account, file, mapping) {
  const box = $('#impres');
  const res = await analyzeFile(state, account, file, mapping);
  if (res.needsMapping) return mappingForm(account, file, res.table);
  const s = res.stats;
  const bal = res.balance;
  box.innerHTML = `<section class="card">
    <h2>${s.total} movimientos</h2>
    <p class="muted">${dateLabel(s.from)} – ${dateLabel(s.to)} · ${esc(account.alias)}</p>
    ${bal.checked ? `<p class="${bal.bad ? 'neg' : 'pos'}">${bal.bad ? `⚠ ${bal.bad} saldos no cuadran: revisa que el extracto esté completo.` : `✓ Los ${bal.checked + 1} saldos cuadran al céntimo.`}</p>` : '<p class="muted">El fichero no trae saldos para verificar.</p>'}
    <ul class="stats">
      <li><b>${s.nuevos}</b><span>nuevos</span></li>
      <li><b>${s.duplicados}</b><span>ya importados</span></li>
      <li><b>${s.clasificados}</b><span>clasificados solos</span></li>
      <li><b>${s.pendientes}</b><span>para revisar</span></li>
    </ul>
    ${s.saldos ? `<p class="hint">${s.saldos} movimientos que ya tenías sin saldo lo recibirán de este fichero.</p>` : ''}
    ${s.manual ? `<p class="hint">${s.manual} coinciden con gastos que apuntaste a mano: se unirán (conservan tu categoría y foto).</p>` : ''}
    ${s.nuevos + s.manual ? `<button class="btn primary block" id="commit">Importar ${s.nuevos + s.manual} movimientos</button>` : s.saldos ? '<button class="btn primary block" id="commit">Completar saldos</button>' : '<p class="muted">Nada nuevo que importar.</p>'}
  </section>`;
  $('#commit')?.addEventListener('click', e => busy(e.currentTarget, async () => {
    const r = await commitImport(state, account, file, res);
    await reload();
    const pend = pendingTx().length;
    box.innerHTML = `<section class="card done"><h2>Importados ${r.inserted} movimientos</h2>
      ${r.merged ? `<p>${r.merged} unidos a gastos apuntados a mano.</p>` : ''}
      <div class="row-btns">${pend ? `<a class="btn primary" href="#/bandeja">Revisar ${pend} pendientes</a>` : ''}<a class="btn" href="#/analisis">Ver análisis</a></div></section>`;
    $('#imf').reset();
  }));
}

function mappingForm(account, file, table) {
  const box = $('#impres');
  const maxCols = Math.max(...table.slice(0, 30).map(r => r.length));
  let header = Math.max(0, table.findIndex(r => r.filter(c => String(c).trim()).length >= 3));
  const draw = () => {
    const cols = (table[header] || []).map((c, i) => `<option value="${i}">${esc(String(c || `Columna ${i + 1}`))}</option>`).join('');
    const sel = (name, opt = false) => `<label>${name}<select data-m="${name}">${opt ? '<option value="-1">— ninguna —</option>' : ''}${cols}</select></label>`;
    box.innerHTML = `<section class="card form"><h2>No reconozco las columnas</h2><p class="muted">Indícalas una vez; la app lo recordará para esta cuenta.</p>
      <label>Fila de títulos<input type="number" id="hdr" min="1" max="${table.length}" value="${header + 1}"></label>
      ${sel('Fecha')}${sel('Concepto')}${sel('Importe', true)}${sel('Cargo', true)}${sel('Abono', true)}${sel('Saldo', true)}
      <div class="table-peek"><table>${table.slice(header, header + 4).map(r => `<tr>${Array.from({ length: maxCols }, (_, i) => `<td>${esc(String(r[i] ?? ''))}</td>`).join('')}</tr>`).join('')}</table></div>
      <button class="btn primary block" id="mapgo">Continuar</button></section>`;
    $('#hdr').onchange = e => { header = Math.max(0, +e.target.value - 1); draw(); };
    $('#mapgo').onclick = e => {
      const v = n => +box.querySelector(`[data-m=${n}]`).value;
      const m = { header, date: v('Fecha'), desc: v('Concepto'), amount: v('Importe'), debit: v('Cargo'), credit: v('Abono'), balance: v('Saldo'), state: -1, detail: -1, product: (table[header] || []).findIndex(c => /^(producto|product)$/i.test(String(c).trim())) };
      if (m.amount < 0 && (m.debit < 0 || m.credit < 0)) return toast('Indica la columna de importe, o las de cargo y abono.');
      busy(e.currentTarget, () => runAnalysis(account, file, m));
    };
  };
  draw();
}

// ---------- Nuevo gasto ----------
function renderNuevo() {
  setTop('Apuntar movimiento');
  const accs = myAccounts().filter(a => a.kind !== 'inversion');
  if (!accs.length) { view.innerHTML = `<div class="empty card"><h2>Primero, una cuenta</h2><a class="btn primary" href="#/cuentas">Añadir cuentas</a></div>`; return; }
  const lastAcc = lsGet('lastManualAcc') || accs.find(a => a.bank === 'efectivo')?.id;
  view.innerHTML = `<form class="card form" id="nf">
    <div class="seg"><button type="button" class="on" data-k="gasto">Gasto</button><button type="button" data-k="ingreso">Ingreso</button></div>
    <label class="amount">Importe<input name="amount" inputmode="decimal" placeholder="0,00" autocomplete="off" required></label>
    <label>Comercio<input name="merchant" list="merchants" required autocomplete="off"></label>
    <label>Categoría<select name="category_id" required><option value="">Elige categoría…</option>${categoryOptions('gasto')}</select></label>
    <div class="two"><label>Cuenta<select name="account">${accs.map(a => `<option value="${a.id}" ${a.id === lastAcc ? 'selected' : ''}>${esc(a.alias)}</option>`).join('')}</select></label>
    <label>Fecha<input type="date" name="date" value="${todayIso()}" required></label></div>
    <label>Nota<input name="note" placeholder="Opcional"></label>
    <label class="btn ghost file block" id="phl">${ICON.camera} Foto del ticket<input type="file" name="photo" accept="image/*" capture="environment" hidden></label>
    <button class="btn primary block">Guardar</button>
    <p class="muted small">Si el gasto es con tarjeta, al importar el extracto se unirá solo a este apunte.</p>
  </form>${merchantDatalist()}`;
  const f = $('#nf');
  let kind = 'gasto';
  $$('.seg button', f).forEach(b => b.onclick = () => {
    kind = b.dataset.k;
    $$('.seg button', f).forEach(x => x.classList.toggle('on', x === b));
    f.category_id.innerHTML = `<option value="">Elige categoría…</option>${categoryOptions(kind)}`;
  });
  f.merchant.onchange = () => {
    const prev = state.tx.find(t => t.merchant === f.merchant.value && t.category_id && state.catById.get(t.category_id)?.kind === kind);
    if (prev && !f.category_id.value) f.category_id.value = prev.category_id;
  };
  f.photo.onchange = () => { $('#phl').firstChild.nextSibling.textContent = f.photo.files[0] ? ' Foto añadida ✓' : ' Foto del ticket'; };
  setTimeout(() => f.amount.focus(), 50);
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const n = Math.abs(Number(f.amount.value.replace(/\./g, '').replace(',', '.')));
      if (!n) throw new Error('Importe no válido.');
      const accId = f.account.value;
      lsSet('lastManualAcc', accId);
      let photo_path = null;
      if (f.photo.files[0]) photo_path = await uploadPhoto(state.household.id, accId, await shrinkImage(f.photo.files[0]));
      const row = await api.insert('transactions', {
        household_id: state.household.id, account_id: accId, date: f.date.value,
        amount: kind === 'gasto' ? -n : n, merchant: f.merchant.value.trim(), category_id: f.category_id.value,
        tx_type: kind, source: 'manual', note: f.note.value.trim() || null, photo_path, hash: 'manual-' + crypto.randomUUID(),
        seq: 9999,
      });
      state.tx.unshift(row);
      state.tx.sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
      toast('Apuntado');
      history.length > 1 ? history.back() : go('#/inicio');
    });
  };
}

// ---------- Análisis ----------
function renderAnalisis() {
  setTop('Análisis');
  const ids = scopeAccountIds(state, state.scope);
  const path = state.path;
  const bd = breakdown(state, ids, state.month, path);
  const ser = series(state, ids, state.month, path);
  const crumbs = [['Todo', {}]];
  if (path.cat) crumbs.push([path.cat === '__none__' ? 'Sin categoría' : state.catById.get(path.cat)?.name, { cat: path.cat }]);
  if (path.sub) crumbs.push([path.sub === '__none__' ? 'Sin categoría' : state.catById.get(path.sub)?.name, { cat: path.cat, sub: path.sub }]);
  const cur = ser.at(-1).value;
  const prev = ser.at(-2).value;
  const hist = historyMonths(state, ids, state.month);
  const avg3 = hist ? (ser.at(-2).value + ser.at(-3).value + ser.at(-4).value) / hist : 0;
  const txs = txOfMonth(state, state.month, ids);
  const tt = totals(txs);
  const inc = !path.cat ? incomeBreakdown(state, txs) : [];

  view.innerHTML = `${periodBar()}
    <nav class="crumbs">${crumbs.map(([l, p], i) => i < crumbs.length - 1 ? `<button class="link" data-crumb='${JSON.stringify(p)}'>${esc(l)}</button><span>›</span>` : `<b>${esc(l)}</b>`).join('')}</nav>
    <section class="card">
      <div class="big"><strong>${eur(cur)}</strong><span>gastado en ${monthLabel(state.month)}</span></div>
      <p class="muted">Mes anterior ${eur(prev)} · ${hist ? `media de ${hist} mes${hist > 1 ? 'es' : ''} ${eur(avg3)}` : 'sin meses anteriores con datos'} ${avg3 > 0 ? `<b class="${cur > avg3 * 1.15 ? 'neg' : cur < avg3 * 0.85 ? 'pos' : ''}">(${pct(cur / avg3 - 1)})</b>` : ''}</p>
      ${chart(ser)}
    </section>
    <section class="card">
      <h2>${bd.level === 'cat' ? 'Por categoría' : bd.level === 'sub' ? 'Por subcategoría' : 'Por comercio'}</h2>
      ${bd.items.length ? `<ul class="drill">${bd.items.map(n => `
        <li><button data-key="${esc(n.key)}" data-level="${n.level}">
          <span class="d-main"><b>${esc(n.label)}</b>
          <small>${n.level === 'mer' ? `${n.count} compra${n.count === 1 ? '' : 's'}${n.count ? ` · ticket medio ${eur(n.cur / n.count)}` : ''}` : `${bd.total > 0 ? Math.round((n.cur / bd.total) * 100) : 0} % del total`}</small>
          <small class="${deltaClass(n)}">${deltaText(n)}</small></span>
          <span class="d-amt">${eur(n.cur)}</span>${ICON.chev}</button>
          <div class="bar thin"><i style="width:${bd.items[0].cur > 0 ? Math.max(1, (n.cur / bd.items[0].cur) * 100) : 0}%"></i></div></li>`).join('')}</ul>` : '<p class="muted">Sin gastos en este periodo.</p>'}
    </section>
    ${tt.pendingCount ? `<a class="card alert slim" href="#/bandeja"><span>${tt.pendingCount} movimientos sin clasificar (${eur(tt.pending, { sign: true })}) no están incluidos</span>${ICON.chev}</a>` : ''}
    ${inc.length ? `<section class="card"><h2>Ingresos · ${eur(tt.income)}</h2><ul class="list">${inc.map(([c, v]) => `<li><span>${esc(c)}</span><b class="pos">${eur(v)}</b></li>`).join('')}</ul></section>` : ''}`;

  view.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (a && periodActions(a, renderAnalisis)) return;
    const c = e.target.closest('[data-crumb]');
    if (c) { state.path = JSON.parse(c.dataset.crumb); renderAnalisis(); return; }
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const k = b.dataset.key, lv = b.dataset.level;
    if (lv === 'cat') { state.path = { cat: k }; renderAnalisis(); }
    else if (lv === 'sub') { state.path = { ...path, sub: k }; renderAnalisis(); }
    else merchantSheet({ ...path, mer: k }, ids);
  };
}

function merchantSheet(path, ids) {
  const list = state.tx.filter(t => ids.has(t.account_id) && periodOf(t.date) === state.month && inPath(state, t, path));
  const ser = series(state, ids, state.month, path);
  const s = sheet(`<h2>${esc(path.mer)}</h2><p class="muted">${monthLabel(state.month)} · ${list.length} movimientos · ${eur(-sum(list))}</p>
    ${chart(ser, true)}
    <div class="sheet-list">${list.map(txRow).join('')}</div>`);
  s.el.onclick = e => { const r = e.target.closest('[data-tx]'); if (r) { s.close(); editTx(r.dataset.tx, renderAnalisis); } };
}

function chart(ser, small = false) {
  const W = 320, H = small ? 90 : 120, pad = 18;
  const max = Math.max(1, ...ser.map(p => p.value));
  const bw = (W - 8) / ser.length;
  const bars = ser.map((p, i) => {
    const h = Math.max(0, (p.value / max) * (H - pad - 14));
    const x = 4 + i * bw + bw * 0.18, y = H - pad - h;
    const last = i === ser.length - 1;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${last ? 'cur' : ''}"><title>${monthLabel(p.ym)}: ${eur(p.value)}</title></rect>
      ${i % (small ? 3 : 2) === (ser.length - 1) % (small ? 3 : 2) ? `<text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 4}" text-anchor="middle">${monthShort(p.ym)}</text>` : ''}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto de los últimos 12 meses">${bars}</svg>`;
}

// ---------- Proyectos ----------
const activeProjects = () => state.projects.filter(p => !p.archived);

// Resultado medio mensual (ingresos − gastos) de las cuentas visibles en los meses anteriores con datos.
function monthlyMargin() {
  const ids = scopeAccountIds(state, 'todo');
  const cur = periodOf(todayIso());
  const months = [1, 2, 3].map(i => addMonths(cur, -i)).filter(m => state.tx.some(t => periodOf(t.date) === m && ids.has(t.account_id)));
  if (!months.length) return null;
  const sumRes = months.reduce((s, m) => s + totals(txOfMonth(state, m, ids)).result, 0);
  return { avg: sumRes / months.length, n: months.length };
}

function commitments(exceptId) {
  const today = todayIso();
  return activeProjects().filter(p => p.id !== exceptId).reduce((s, p) => s + (projectStats(p, state.contributions, today).needed || 0), 0);
}

function progressBar(st) {
  return `<div class="pbar ${st.status}"><i style="width:${Math.max(st.saved > 0 ? 2 : 0, st.progress * 100)}%"></i></div>`;
}

function projectsCard() {
  const list = activeProjects();
  if (!list.length) return `<a class="card slim-cta" href="#/proyectos"><span>🚢 <b>Proyectos</b> · Apartad dinero para lo que queréis hacer</span>${ICON.chev}</a>`;
  const today = todayIso();
  return `<section class="card"><div class="card-h"><h2>Proyectos</h2><a class="link" href="#/proyectos">Ver todos</a></div>
    <ul class="plist">${list.slice(0, 3).map(p => {
      const st = projectStats(p, state.contributions, today);
      return `<li><a href="#/proyecto/${p.id}"><div class="bar-top"><span>${esc(p.emoji || '🎯')} ${esc(p.name)}</span><b>${Math.round(st.progress * 100)} %</b></div>
        ${progressBar(st)}<small class="st-${st.status}">${eur(st.saved, { decimals: false })} de ${eur(st.target, { decimals: false })} · ${STATUS_LABEL[st.status]}</small></a></li>`;
    }).join('')}</ul></section>`;
}

function renderProyectos() {
  setTop('Proyectos', `<button class="btn primary small" data-act="newp">+ Nuevo</button>`);
  topbar.onclick = e => { if (e.target.closest('[data-act=newp]')) projectForm(); };
  const today = todayIso();
  const active = activeProjects();
  const archived = state.projects.filter(p => p.archived);
  const need = commitments();
  const margin = monthlyMargin();
  const free = margin ? margin.avg - need : null;
  view.innerHTML = `
    ${active.length ? `<section class="card commit">
      <div class="commit-row"><span>Para llegar a tiempo a todo</span><b>${eur(need)}/mes</b></div>
      ${margin ? `<div class="commit-row"><span>Resultado medio (${margin.n} mes${margin.n > 1 ? 'es' : ''}, tus cuentas y la común)</span><b class="${margin.avg < 0 ? 'neg' : ''}">${eur(margin.avg, { sign: true })}/mes</b></div>
      <div class="commit-row total"><span>Os quedaría libre</span><b class="${free < 0 ? 'neg' : 'pos'}">${eur(free, { sign: true })}/mes</b></div>
      ${free < 0 ? '<p class="small neg">Con el ritmo actual no llega para todos los proyectos: alarga plazos, baja importes o recorta gasto.</p>' : ''}`
      : '<p class="muted small">Cuando importes extractos, verás aquí si vuestro resultado mensual llega para estas cuotas.</p>'}
    </section>` : `<div class="empty card"><div class="big-emoji">🚢</div><h2>¿Qué queréis hacer?</h2><p>Un crucero, cambiar el coche, el colchón de emergencia… Ponle importe y fecha, y la app te dice cuánto apartar cada mes y si vais al día.</p><button class="btn primary" data-act="newp">Crear el primer proyecto</button></div>`}
    ${active.map(p => projectCard(p, today)).join('')}
    ${archived.length ? `<details class="card"><summary>Archivados (${archived.length})</summary><ul class="list">${archived.map(p => `<li><a href="#/proyecto/${p.id}">${esc(p.emoji || '🎯')} ${esc(p.name)}</a><span class="muted">${eur(projectStats(p, state.contributions, today).saved)}</span></li>`).join('')}</ul></details>` : ''}`;
  view.onclick = e => {
    if (e.target.closest('[data-act=newp]')) return projectForm();
    const q = e.target.closest('[data-quick]');
    if (q) { contributionForm(state.projects.find(p => p.id === q.dataset.quick), 1, renderProyectos); return; }
    const o = e.target.closest('[data-open]');
    if (o) go('#/proyecto/' + o.dataset.open);
  };
}

function projectCard(p, today) {
  const st = projectStats(p, state.contributions, today);
  const acc = p.account_id ? accById(p.account_id) : null;
  let line;
  if (st.done) line = 'Objetivo conseguido 🎉';
  else if (st.overdue) line = `La fecha (${dateLabel(p.deadline)}) ya pasó · faltan ${eur(st.remaining)}`;
  else if (st.needed != null) line = `Faltan ${eur(st.remaining)} · <b>${eur(st.needed)}/mes</b> hasta ${dateLabel(p.deadline)}`;
  else line = `Faltan ${eur(st.remaining)}`;
  return `<div class="card pcard" data-open="${p.id}" role="link" tabindex="0">
    <div class="pcard-h"><span class="pemoji">${esc(p.emoji || '🎯')}</span><div><b>${esc(p.name)}</b><small>${p.owner_member_id ? 'Personal' : 'Común'}${acc ? ' · en ' + esc(acc.alias) : ''}</small></div>
      <span class="badge st-${st.status}">${STATUS_LABEL[st.status]}</span></div>
    <div class="pamounts"><strong>${eur(st.saved)}</strong><span>de ${eur(st.target)}</span><span class="pct">${Math.round(st.progress * 100)} %</span></div>
    ${progressBar(st)}
    <p class="small">${line}</p>
    ${!st.done && st.pace > 0 && st.projected ? `<p class="small muted">A tu ritmo (${eur(st.pace)}/mes) llegarías ${p.deadline && st.projected > p.deadline ? 'tarde, ' : ''}el ${dateLabel(st.projected)}</p>` : ''}
    ${!st.done ? `<button class="btn small" data-quick="${p.id}">+ Aportar</button>` : ''}
  </div>`;
}

function renderProyecto() {
  const id = location.hash.split('/')[2];
  const p = state.projects.find(x => x.id === id);
  if (!p) { go('#/proyectos'); return; }
  const today = todayIso();
  const st = projectStats(p, state.contributions, today);
  const acc = p.account_id ? accById(p.account_id) : null;
  setTop(`${p.emoji || '🎯'} ${p.name}`, `<button class="icon-btn" data-act="editp" aria-label="Editar">✎</button>`);
  topbar.onclick = e => { if (e.target.closest('[data-act=editp]')) projectForm(p); };
  view.innerHTML = `<section class="card">
      <div class="pamounts big"><strong>${eur(st.saved)}</strong><span>de ${eur(st.target)}</span><span class="pct">${Math.round(st.progress * 100)} %</span></div>
      ${progressBar(st)}
      <span class="badge st-${st.status}">${STATUS_LABEL[st.status]}</span>
      <dl class="facts">
        <div><dt>Falta</dt><dd>${eur(st.remaining)}</dd></div>
        <div><dt>Fecha objetivo</dt><dd>${p.deadline ? dateLabel(p.deadline) : '—'}</dd></div>
        <div><dt>Necesitas</dt><dd>${st.needed != null ? eur(st.needed) + '/mes' : '—'}</dd></div>
        <div><dt>Tu ritmo</dt><dd>${st.pace > 0 ? eur(st.pace) + '/mes' : 'sin aportes recientes'}</dd></div>
        <div><dt>Llegarías</dt><dd>${st.done ? 'Conseguido' : st.projected ? dateLabel(st.projected) : '—'}</dd></div>
        <div><dt>Dónde está</dt><dd>${acc ? esc(acc.alias) : 'Sin cuenta'}</dd></div>
      </dl>
      ${projectChart(p, st)}
      ${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
      <div class="row-btns"><button class="btn primary" data-act="add">+ Aportar</button><button class="btn" data-act="sub">− Retirar</button></div>
    </section>
    <section class="card"><h2>Aportaciones</h2>
      ${st.list.length ? `<ul class="list">${[...st.list].reverse().map(c => `<li><div><b class="${+c.amount < 0 ? 'neg' : 'pos'}">${eur(+c.amount, { sign: true })}</b><small>${dateLabel(c.date)}${c.note ? ' · ' + esc(c.note) : ''}${c.created_by && c.created_by !== state.session.user.id ? ' · ' + esc(memberNameByUser(c.created_by)) : ''}</small></div><button class="link neg" data-delc="${c.id}">Quitar</button></li>`).join('')}</ul>` : '<p class="muted">Aún no hay aportaciones.</p>'}
    </section>`;
  view.onclick = async e => {
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'add') return contributionForm(p, 1, renderProyecto);
    if (a?.dataset.act === 'sub') return contributionForm(p, -1, renderProyecto);
    const d = e.target.closest('[data-delc]');
    if (d && await confirmBox('¿Quitar esta aportación?', 'Quitar')) {
      await busy(null, async () => {
        await api.remove('project_contributions', d.dataset.delc);
        state.contributions = state.contributions.filter(c => c.id !== d.dataset.delc);
        renderProyecto();
      });
    }
  };
}

function memberNameByUser(uid) {
  return state.members.find(m => m.user_id === uid)?.name ?? '';
}

// Gráfico: lo ahorrado acumulado frente al ritmo ideal hasta la fecha objetivo.
function projectChart(p, st) {
  if (!st.list.length && !p.deadline) return '';
  const W = 320, H = 130, L = 6, R = 6, T = 10, B = 20;
  const start = Date.parse(p.start_date);
  const endIso = [p.deadline, st.projected, todayIso()].filter(Boolean).sort().at(-1);
  const end = Math.max(Date.parse(endIso), start + 30 * 86400000);
  const x = d => L + ((Date.parse(d) - start) / (end - start)) * (W - L - R);
  const max = Math.max(+p.target, st.saved) * 1.05;
  const y = v => T + (1 - v / max) * (H - T - B);
  let acc = 0;
  const pts = [[x(p.start_date), y(0)]];
  for (const c of st.list) { pts.push([x(c.date), y(acc)]); acc += +c.amount; pts.push([x(c.date), y(acc)]); }
  pts.push([x(todayIso()), y(acc)]);
  const path = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('');
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ahorro acumulado frente al objetivo">
    <line x1="${L}" x2="${W - R}" y1="${y(+p.target)}" y2="${y(+p.target)}" class="goal"/>
    <text x="${W - R}" y="${y(+p.target) - 4}" text-anchor="end">Objetivo ${eur(+p.target, { decimals: false })}</text>
    ${p.deadline ? `<line x1="${x(p.start_date)}" y1="${y(0)}" x2="${x(p.deadline)}" y2="${y(+p.target)}" class="ideal"/><text x="${x(p.deadline)}" y="${H - 6}" text-anchor="end">${dateLabel(p.deadline)}</text>` : ''}
    <path d="${path}" class="real"/>
    <text x="${L}" y="${H - 6}">${dateLabel(p.start_date)}</text>
  </svg><p class="legend small muted"><i class="lg real"></i>Ahorrado <i class="lg ideal"></i>Ritmo para llegar a tiempo</p>`;
}

function contributionForm(p, sign, after) {
  const s = sheet(`<h2>${sign > 0 ? 'Aportar a' : 'Retirar de'} ${esc(p.name)}</h2>
    <form class="form" id="cf">
      <label class="amount">Importe<input name="amount" inputmode="decimal" placeholder="0,00" required autocomplete="off"></label>
      <label>Fecha<input type="date" name="date" value="${todayIso()}" required></label>
      <label>Nota<input name="note" placeholder="${sign > 0 ? 'Opcional (p. ej. paga extra)' : '¿Para qué?'}"></label>
      ${p.account_id ? `<p class="hint small">Recuerda mover el dinero de verdad ${sign > 0 ? 'a' : 'desde'} ${esc(accById(p.account_id)?.alias ?? 'su cuenta')}.</p>` : ''}
      <button class="btn primary block">${sign > 0 ? 'Aportar' : 'Retirar'}</button></form>`);
  const f = $('#cf', s.el);
  setTimeout(() => f.amount.focus(), 50);
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const n = Math.abs(Number(f.amount.value.replace(/\./g, '').replace(',', '.')));
      if (!n) throw new Error('Importe no válido.');
      const before = projectStats(p, state.contributions, todayIso());
      const row = await api.insert('project_contributions', {
        household_id: state.household.id, project_id: p.id, date: f.date.value, amount: sign * n, note: f.note.value.trim() || null,
      });
      state.contributions.push(row);
      const after_ = projectStats(p, state.contributions, todayIso());
      s.close();
      toast(!before.done && after_.done ? `🎉 ¡${p.name}: objetivo conseguido!` : sign > 0 ? `+${eur(n)} · llevas ${Math.round(after_.progress * 100)} %` : 'Retirada anotada');
      after();
    });
  };
}

function projectForm(p = null) {
  const accs = myAccounts();
  const s = sheet(`<h2>${p ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
    <form class="form" id="pf">
      <div class="emojis">${EMOJIS.map(e => `<label><input type="radio" name="emoji" value="${e}" ${(p?.emoji || '🚢') === e ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div>
      <label>Nombre<input name="name" value="${esc(p?.name ?? '')}" placeholder="Crucero por el Mediterráneo" required></label>
      <div class="two"><label>Importe objetivo<input name="target" inputmode="decimal" value="${p ? String(p.target).replace('.', ',') : ''}" placeholder="4.000" required></label>
      <label>Fecha objetivo<input type="date" name="deadline" value="${p?.deadline ?? ''}"></label></div>
      <label>Dónde estará el dinero<select name="account"><option value="">Sin cuenta concreta</option>${accs.map(a => `<option value="${a.id}" ${p?.account_id === a.id ? 'selected' : ''}>${esc(a.alias)}</option>`).join('')}</select></label>
      ${p ? '' : `<label>De quién<select name="owner"><option value="comun">Común (lo veis los dos)</option><option value="mio">Solo mío</option></select></label>
      <label>Ya tenéis ahorrado (opcional)<input name="initial" inputmode="decimal" placeholder="0"></label>`}
      <label>Nota<input name="note" value="${esc(p?.note ?? '')}" placeholder="Opcional"></label>
      <div id="pprev" class="hint small" hidden></div>
      <div class="row-btns">${p ? `<button type="button" class="btn ghost" data-arch>${p.archived ? 'Desarchivar' : 'Archivar'}</button><button type="button" class="btn danger ghost" data-del>Eliminar</button>` : ''}<button class="btn primary">${p ? 'Guardar' : 'Crear proyecto'}</button></div>
    </form>`);
  const f = $('#pf', s.el);
  const num = v => Math.abs(Number(String(v || '').replace(/\./g, '').replace(',', '.'))) || 0;

  // Vista previa: cuánto supone al mes y cómo queda el margen
  const preview = () => {
    const box = $('#pprev', s.el);
    const target = num(f.target.value);
    if (!target || !f.deadline.value) { box.hidden = true; return; }
    const saved = p ? projectStats(p, state.contributions, todayIso()).saved : num(f.initial?.value);
    const months = Math.max(1, (Date.parse(f.deadline.value) - Date.now()) / (30.4375 * 86400000));
    const need = Math.max(0, target - saved) / months;
    const others = commitments(p?.id);
    const margin = monthlyMargin();
    box.hidden = false;
    box.innerHTML = `Supone <b>${eur(need)}/mes</b> durante ${Math.round(months)} meses.` +
      (others > 0 ? ` Con los demás proyectos: ${eur(need + others)}/mes.` : '') +
      (margin ? ` Vuestro resultado medio es ${eur(margin.avg, { sign: true })}/mes: quedaría <b class="${margin.avg - need - others < 0 ? 'neg' : 'pos'}">${eur(margin.avg - need - others, { sign: true })}/mes</b> libre.` : '');
  };
  f.oninput = preview;
  preview();

  s.el.querySelector('[data-arch]')?.addEventListener('click', () => busy(null, async () => {
    Object.assign(p, await api.update('projects', p.id, { archived: !p.archived }));
    s.close(); go('#/proyectos');
  }));
  s.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmBox(`Se borrará «${p.name}» y sus aportaciones. Si solo está terminado, mejor archívalo.`, 'Eliminar')) return;
    await busy(null, async () => {
      await api.remove('projects', p.id);
      state.projects = state.projects.filter(x => x.id !== p.id);
      state.contributions = state.contributions.filter(c => c.project_id !== p.id);
      s.close(); go('#/proyectos');
    });
  });
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const target = num(f.target.value);
      if (!target) throw new Error('Pon un importe objetivo.');
      const data = {
        name: f.name.value.trim(), emoji: f.querySelector('[name=emoji]:checked')?.value ?? null, target,
        deadline: f.deadline.value || null, account_id: f.account.value || null, note: f.note.value.trim() || null,
      };
      if (p) {
        Object.assign(p, await api.update('projects', p.id, data));
        s.close(); route();
        return;
      }
      const row = await api.insert('projects', {
        ...data, household_id: state.household.id, owner_member_id: f.owner.value === 'mio' ? state.me.id : null, start_date: todayIso(),
      });
      state.projects.push(row);
      const initial = num(f.initial.value);
      if (initial) {
        state.contributions.push(await api.insert('project_contributions', {
          household_id: state.household.id, project_id: row.id, date: todayIso(), amount: initial, note: 'Lo que ya teníais ahorrado', is_initial: true,
        }));
      }
      s.close(); toast('Proyecto creado'); go('#/proyecto/' + row.id);
    });
  };
}

// ---------- Valor de cuentas de inversión ----------
function lastSnapshot(accountId, upTo = '9999-12-31') {
  return state.snapshots.filter(s => s.account_id === accountId && s.date <= upTo)
    .sort((x, y) => x.date.localeCompare(y.date) || x.created_at.localeCompare(y.created_at)).at(-1) || null;
}

function valuationForm(acc, after) {
  const prev = lastSnapshot(acc.id);
  const hist = state.snapshots.filter(s => s.account_id === acc.id).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6);
  const s = sheet(`<h2>${esc(acc.alias)}</h2><p class="muted">Copia los dos datos de la app del banco. Basta una vez al mes.</p>
    <form class="form" id="vf">
      <label>Valor de mercado<input name="value" inputmode="decimal" placeholder="${prev ? String(prev.value).replace('.', ',') : '0,00'}" required autocomplete="off"></label>
      <label>Total aportado (invertido)<input name="invested" inputmode="decimal" placeholder="${prev?.invested != null ? String(prev.invested).replace('.', ',') : 'Opcional'}" autocomplete="off"></label>
      <label>Fecha<input type="date" name="date" value="${todayIso()}" required></label>
      <button class="btn primary block">Guardar</button></form>
    ${hist.length ? `<h3 class="day">Anteriores</h3><ul class="list">${hist.map(h => `<li><span>${dateLabel(h.date)}</span><span>${eur(+h.value)}${h.invested != null ? ` <small class="muted">(aportado ${eur(+h.invested)})</small>` : ''}</span></li>`).join('')}</ul>` : ''}`);
  const f = $('#vf', s.el);
  const num = v => Number(String(v || '').replace(/\./g, '').replace(',', '.'));
  setTimeout(() => f.value.focus(), 50);
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const value = num(f.value.value);
      if (!Number.isFinite(value) || !f.value.value) throw new Error('Valor no válido.');
      const inv = f.invested.value ? num(f.invested.value) : (prev?.invested ?? null);
      const row = await api.insert('account_snapshots', { household_id: state.household.id, account_id: acc.id, date: f.date.value, value, invested: inv });
      state.snapshots.push(row);
      s.close(); after?.();
    });
  };
}

// ---------- Más ----------
function renderMas() {
  setTop('Más');
  view.innerHTML = `<ul class="menu card">
    <li><a href="#/resumen">${ICON.doc}<span>Resumen del mes para analizar con Claude</span>${ICON.chev}</a></li>
    <li><a href="#/bandeja">${ICON.inbox}<span>Por revisar (${pendingTx().length})</span>${ICON.chev}</a></li>
    <li><a href="#/importar">${ICON.upload}<span>Importar extracto</span>${ICON.chev}</a></li>
  </ul>
  <ul class="menu card">
    <li><a href="#/cuentas">${ICON.bank}<span>Cuentas</span>${ICON.chev}</a></li>
    <li><a href="#/categorias">${ICON.tag}<span>Categorías</span>${ICON.chev}</a></li>
    <li><a href="#/reglas">${ICON.rule}<span>Reglas de clasificación (${state.rules.length})</span>${ICON.chev}</a></li>
    <li><a href="#/hogar">${ICON.home}<span>Hogar e invitación</span>${ICON.chev}</a></li>
  </ul>
  <ul class="menu card">
    <li><button data-act="backup">${ICON.save}<span>Descargar copia de seguridad</span></button></li>
    <li><button data-act="pw">${ICON.key}<span>Cambiar contraseña</span></button></li>
    <li><button data-act="logout">${ICON.out}<span>Cerrar sesión</span></button></li>
  </ul>
  <p class="muted center small">Versión ${APP_VERSION} · ${esc(state.session.user.email)}</p>`;
  view.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'logout') auth.signOut();
    if (a.dataset.act === 'pw') changePassword();
    if (a.dataset.act === 'backup') {
      const data = {
        exportado: new Date().toISOString(), version: APP_VERSION, hogar: state.household, miembros: state.members,
        cuentas: state.accounts.filter(x => state.visible.has(x.id)), categorias: state.categories, reglas: state.rules,
        movimientos: state.tx, proyectos: state.projects, aportaciones: state.contributions, valoraciones: state.snapshots,
      };
      download(`finanzas-copia-${todayIso()}.json`, JSON.stringify(data, null, 1));
      toast('Copia descargada');
    }
  };
}

async function renderResumen() {
  setTop('Resumen del mes');
  view.innerHTML = `${periodBar()}<section class="card"><p class="muted">Cópialo y pégalo en el chat con Claude. No incluye números de cuenta ni los conceptos originales del banco.</p>
    <textarea id="sum" readonly rows="18"></textarea>
    <div class="row-btns"><button class="btn primary" data-act="copy">Copiar</button>${navigator.share ? '<button class="btn" data-act="share">Compartir</button>' : ''}</div></section>`;
  const [from, to] = monthRange(state.month);
  let sums = [];
  try { sums = await accountSummaries(from, to); } catch (e) { console.error(e); }
  const text = summaryText(state, state.month, state.scope, sums);
  $('#sum').value = text;
  view.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (periodActions(a, renderResumen)) return;
    if (a.dataset.act === 'copy') navigator.clipboard.writeText(text).then(() => toast('Copiado'), () => { $('#sum').select(); toast('Selecciónalo y cópialo'); });
    if (a.dataset.act === 'share') navigator.share({ title: `Resumen ${monthLabel(state.month)}`, text }).catch(() => {});
  };
}

// ---------- Cuentas ----------
function renderCuentas() {
  setTop('Cuentas');
  const mine = state.accounts.filter(a => state.visible.has(a.id));
  const others = state.accounts.filter(a => !state.visible.has(a.id));
  view.innerHTML = `<section class="card"><h2>Tus cuentas y la común</h2>
    ${mine.length ? `<ul class="list">${mine.map(a => `<li class="${a.archived ? 'dim' : ''}"><div><b>${esc(a.alias)}</b><small>${BANK_LABEL[a.bank]}${a.last4 ? ' ···' + esc(a.last4) : ''} · ${esc(ownerName(a))} · ${state.tx.filter(t => t.account_id === a.id).length} mov.${a.archived ? ' · archivada' : ''}</small></div><button class="btn ghost small" data-edit="${a.id}">Editar</button></li>`).join('')}</ul>` : '<p class="muted">Aún no hay cuentas.</p>'}
    </section>
    ${others.length ? `<section class="card"><h2>Cuentas de otros miembros</h2><p class="muted small">Solo ves sus totales.</p><ul class="list">${others.map(a => `<li><div><b>${esc(a.alias)}</b><small>${BANK_LABEL[a.bank]} · ${esc(ownerName(a))}</small></div></li>`).join('')}</ul></section>` : ''}
    <form class="card form" id="af"><h2>Añadir cuenta</h2>
      <div class="presets">${PRESETS.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.label)}</button>`).join('')}</div>
      <div class="two"><label>Banco<select name="bank">${Object.entries(BANK_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Tipo<select name="kind"><option value="personal">Personal</option><option value="comun">Común</option><option value="inversion">Inversión</option><option value="efectivo">Efectivo</option></select></label></div>
      <label>Nombre<input name="alias" placeholder="Santander personal" required></label>
      <label>Últimos 4 dígitos (opcional)<input name="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}"></label>
      <label class="check"><input type="checkbox" name="shared"> Es compartida (la ven y la gestionan los dos)</label>
      <button class="btn primary block">Añadir</button></form>`;
  const f = $('#af');
  f.kind.onchange = () => { f.shared.checked = f.kind.value === 'comun'; };
  view.onclick = e => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      const pr = PRESETS[+p.dataset.preset];
      f.bank.value = pr.bank; f.kind.value = pr.kind; f.alias.value = pr.alias(state.me.name); f.shared.checked = pr.kind === 'comun';
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) editAccount(ed.dataset.edit);
  };
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('.primary'), async () => {
      const row = await api.insert('accounts', {
        household_id: state.household.id, bank: f.bank.value, kind: f.kind.value, alias: f.alias.value.trim(),
        last4: f.last4.value || null, owner_member_id: f.shared.checked ? null : state.me.id,
      });
      state.accounts.push(row);
      state.visible.add(row.id);
      toast('Cuenta añadida');
      renderCuentas();
    });
  };
}

const PRESETS = [
  { label: 'Santander personal', bank: 'santander', kind: 'personal', alias: n => `Santander ${n}` },
  { label: 'Revolut personal', bank: 'revolut', kind: 'personal', alias: n => `Revolut ${n}` },
  { label: 'BBVA personal', bank: 'bbva', kind: 'personal', alias: n => `BBVA ${n}` },
  { label: 'BBVA común', bank: 'bbva', kind: 'comun', alias: () => 'BBVA común' },
  { label: 'MyInvestor', bank: 'myinvestor', kind: 'inversion', alias: n => `MyInvestor ${n}` },
  { label: 'Efectivo', bank: 'efectivo', kind: 'efectivo', alias: n => `Efectivo ${n}` },
];

function editAccount(id) {
  const a = accById(id);
  const n = state.tx.filter(t => t.account_id === id).length;
  const s = sheet(`<h2>${esc(a.alias)}</h2><form class="form" id="eaf">
    <label>Nombre<input name="alias" value="${esc(a.alias)}" required></label>
    <label>Últimos 4 dígitos<input name="last4" value="${esc(a.last4 ?? '')}" inputmode="numeric" maxlength="4" pattern="[0-9]{4}"></label>
    <label class="check"><input type="checkbox" name="archived" ${a.archived ? 'checked' : ''}> Archivada (deja de salir en listas)</label>
    <div class="row-btns"><button type="button" class="btn danger ghost" data-del>Eliminar</button><button class="btn primary">Guardar</button></div></form>`);
  const f = $('#eaf', s.el);
  f.onsubmit = e => { e.preventDefault(); busy(f.querySelector('.primary'), async () => {
    Object.assign(a, await api.update('accounts', id, { alias: f.alias.value.trim(), last4: f.last4.value || null, archived: f.archived.checked }));
    s.close(); renderCuentas();
  }); };
  f.querySelector('[data-del]').onclick = async () => {
    if (!await confirmBox(`Se borrará la cuenta y sus ${n} movimientos. No se puede deshacer.`, 'Eliminar')) return;
    await busy(null, async () => { await api.remove('accounts', id); await reload(); s.close(); renderCuentas(); });
  };
}

// ---------- Categorías ----------
function renderCategorias() {
  setTop('Categorías');
  const used = new Map();
  state.tx.forEach(t => t.category_id && used.set(t.category_id, (used.get(t.category_id) || 0) + 1));
  const block = kind => state.categories.filter(c => !c.parent_id && c.kind === kind).map(p => `
    <details class="card cat"><summary><b>${esc(p.name)}</b><button class="link" data-ren="${p.id}">Renombrar</button></summary>
      <ul class="list">${state.categories.filter(c => c.parent_id === p.id).map(c => `<li><span>${esc(c.name)} <small class="muted">${used.get(c.id) || 0} mov.</small></span>
        <span><button class="link" data-ren="${c.id}">Renombrar</button><button class="link neg" data-delc="${c.id}">Quitar</button></span></li>`).join('')}</ul>
      <form class="inline" data-addsub="${p.id}"><input name="n" placeholder="Nueva subcategoría" required><button class="btn small">Añadir</button></form>
    </details>`).join('');
  view.innerHTML = `<h2 class="sec">Gastos</h2>${block('gasto')}<h2 class="sec">Ingresos</h2>${block('ingreso')}
    <form class="card form" id="ncat"><h2>Nueva categoría</h2><div class="two"><input name="n" placeholder="Nombre" required><select name="kind"><option value="gasto">Gasto</option><option value="ingreso">Ingreso</option></select></div><button class="btn block">Crear</button></form>`;
  view.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    busy(f.querySelector('button'), async () => {
      if (f.id === 'ncat') {
        const p = await api.insert('categories', { household_id: state.household.id, name: f.n.value.trim(), kind: f.kind.value, sort: 100 + state.categories.length });
        const c = await api.insert('categories', { household_id: state.household.id, parent_id: p.id, name: 'General', kind: f.kind.value, sort: 0 });
        state.categories.push(p, c);
      } else {
        const parent = state.catById.get(f.dataset.addsub);
        const c = await api.insert('categories', { household_id: state.household.id, parent_id: parent.id, name: f.n.value.trim(), kind: parent.kind, sort: 50 });
        state.categories.push(c);
      }
      state.catById = new Map(state.categories.map(c => [c.id, c]));
      renderCategorias();
    });
  };
  view.onclick = async e => {
    const r = e.target.closest('[data-ren]');
    if (r) {
      e.preventDefault();
      const c = state.catById.get(r.dataset.ren);
      const s = sheet(`<form class="form" id="rf"><label>Nombre<input name="n" value="${esc(c.name)}" required></label><button class="btn primary block">Guardar</button></form>`);
      $('#rf', s.el).onsubmit = ev => { ev.preventDefault(); busy(null, async () => { Object.assign(c, await api.update('categories', c.id, { name: ev.target.n.value.trim() })); s.close(); renderCategorias(); }); };
      return;
    }
    const d = e.target.closest('[data-delc]');
    if (d) {
      const c = state.catById.get(d.dataset.delc);
      const n = used.get(c.id) || 0;
      if (!await confirmBox(n ? `${n} movimientos quedarán «Sin categoría». ¿Quitar «${c.name}»?` : `¿Quitar «${c.name}»?`, 'Quitar')) return;
      await busy(null, async () => { await api.remove('categories', c.id); await reload(); renderCategorias(); });
    }
  };
}

// ---------- Reglas ----------
function renderReglas() {
  setTop('Reglas');
  view.innerHTML = `<p class="lead">Cada regla dice: si el concepto del banco contiene este texto, clasifícalo así. Las que creas tú mandan sobre las de partida.</p>
    <div class="row-btns"><button class="btn" data-act="reapply">Aplicar reglas a lo pendiente</button></div>
    <input type="search" id="rq" placeholder="Buscar regla">
    <ul class="list card" id="rl"></ul>`;
  const draw = () => {
    const q = norm($('#rq').value);
    const list = state.sortedRules.filter(r => !q || norm(`${r.pattern} ${r.merchant} ${catName(r.category_id)}`).includes(q));
    $('#rl').innerHTML = list.map(r => `<li><div><b>«${esc(r.pattern)}»</b><small>${esc(r.merchant ?? '')} · ${TYPE_LABEL[r.tx_type]}${r.category_id ? ' · ' + esc(catName(r.category_id)) : ''}${r.bank ? ' · ' + BANK_LABEL[r.bank] : ''} · ${r.origin === 'base' ? 'de partida' : r.origin === 'manual' ? 'tuya (manual)' : 'aprendida'}</small></div><button class="link neg" data-delr="${r.id}">Borrar</button></li>`).join('') || '<li class="muted">Sin reglas.</li>';
  };
  draw();
  view.oninput = e => { if (e.target.id === 'rq') draw(); };
  view.onclick = async e => {
    const d = e.target.closest('[data-delr]');
    if (d) {
      if (!await confirmBox('¿Borrar la regla? Los movimientos ya clasificados no cambian.', 'Borrar')) return;
      await busy(null, async () => { await api.remove('rules', d.dataset.delr); state.rules = state.rules.filter(r => r.id !== d.dataset.delr); state.sortedRules = sortRules(state.rules); draw(); });
      return;
    }
    const a = e.target.closest('[data-act=reapply]');
    if (a) busy(a, async () => {
      let n = 0;
      for (const t of pendingTx()) {
        const acc = accById(t.account_id);
        const r = findRule(state.sortedRules, acc.bank, { desc: t.raw_desc, amount: +t.amount });
        if (!r) continue;
        const patch = { tx_type: r.tx_type, category_id: r.category_id, merchant: r.merchant || t.merchant };
        Object.assign(t, await api.update('transactions', t.id, patch)); n++;
      }
      toast(n ? `${n} movimientos clasificados` : 'Ninguna regla encaja con lo pendiente');
    });
  };
}

// ---------- Hogar ----------
function renderHogar() {
  setTop('Hogar');
  const sd = state.household.month_start_day || 1;
  view.innerHTML = `<form class="card form" id="hf"><label>Nombre del hogar<input name="n" value="${esc(state.household.name)}" required></label>
      <label>El mes empieza el día<select name="sd">${Array.from({ length: 28 }, (_, i) => i + 1).map(d => `<option value="${d}" ${d === sd ? 'selected' : ''}>${d === 1 ? '1 (mes natural)' : d}</option>`).join('')}</select></label>
      <p class="muted small">Si cobráis a final de mes, pon el día en que suele llegar la nómina (por ejemplo 24). Así el mes «noviembre» irá del 24 de octubre al 23 de noviembre: la nómina y los gastos que paga caen en el mismo mes.</p>
      <button class="btn block">Guardar</button></form>
    <section class="card"><h2>Miembros</h2><ul class="list">${state.members.map(m => `<li><span>${esc(m.name)}${m.id === state.me.id ? ' (tú)' : ''}</span></li>`).join('')}</ul></section>
    <section class="card"><h2>Invitar</h2><p>Para que se una otra persona: crea su cuenta en la app y, en «Unirme a un hogar», escribe este código:</p>
      <p class="code">${esc(state.household.invite_code)}</p><button class="btn" data-act="copy">Copiar código</button>
      <p class="muted small">Cada uno ve el detalle de sus cuentas y de la común. De las cuentas personales del otro, solo saldo, ingresos y gastos totales.</p></section>`;
  $('#hf').onsubmit = e => { e.preventDefault(); busy(e.target.querySelector('button'), async () => {
    state.household = await api.update('households', state.household.id, { name: e.target.n.value.trim(), month_start_day: +e.target.sd.value });
    setMonthStart(state.household.month_start_day);
    state.month = periodOf(todayIso());
    toast('Guardado');
  }); };
  view.onclick = e => { if (e.target.closest('[data-act=copy]')) navigator.clipboard.writeText(state.household.invite_code).then(() => toast('Código copiado')); };
}

// ---------- Iconos ----------
const svg = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'),
  chev: svg('<path d="M9 6l6 6-6 6"/>'),
  doc: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  inbox: svg('<path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>'),
  bank: svg('<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
  tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.3"/>'),
  rule: svg('<path d="M4 6h16M4 12h10M4 18h6"/>'),
  home: svg('<path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/>'),
  save: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  out: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

// ---------- Arranque ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot().catch(e => { console.error(e); toast(e.message, 'error'); });
