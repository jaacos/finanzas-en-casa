import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { SEED_CATEGORIES, SEED_RULES } from './seed.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'finanzas-familia-auth' },
});

function check({ data, error }) {
  if (error) throw new Error(traducir(error.message));
  return data;
}

function traducir(msg) {
  const map = [
    [/Invalid login credentials/i, 'Correo o contraseña incorrectos.'],
    [/User already registered/i, 'Ese correo ya tiene cuenta. Entra con tu contraseña.'],
    [/Password should be at least/i, 'La contraseña debe tener al menos 6 caracteres.'],
    [/Email not confirmed/i, 'Falta confirmar el correo: revisa tu bandeja de entrada.'],
    [/rate limit/i, 'Demasiados intentos seguidos. Espera un minuto.'],
    [/Failed to fetch|NetworkError/i, 'Sin conexión con el servidor. Comprueba internet.'],
  ];
  for (const [re, t] of map) if (re.test(msg)) return t;
  return msg;
}

export async function fetchAll(table, columns = '*', build = q => q) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = check(await build(sb.from(table).select(columns)).range(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

// ---------- Sesión y hogar ----------
export const auth = {
  async session() { return check(await sb.auth.getSession()).session; },
  async signIn(email, password) { return check(await sb.auth.signInWithPassword({ email, password })); },
  async signUp(email, password) {
    return check(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
  },
  async signOut() { await sb.auth.signOut(); },
  async resetPassword(email) {
    return check(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
  },
  async updatePassword(password) { return check(await sb.auth.updateUser({ password })); },
};

export async function loadMe(userId) {
  const rows = check(await sb.from('members').select('*').eq('user_id', userId));
  return rows[0] || null;
}

export async function createHousehold(name, memberName) {
  const hid = check(await sb.rpc('create_household', { p_name: name, p_member_name: memberName }));
  await seedHousehold(hid);
  return hid;
}

export async function joinHousehold(code, memberName) {
  return check(await sb.rpc('join_household', { p_code: code, p_member_name: memberName }));
}

async function seedHousehold(hid) {
  const catIds = {};
  let sort = 0;
  for (const kind of ['gasto', 'ingreso']) {
    for (const [parent, subs] of Object.entries(SEED_CATEGORIES[kind])) {
      const p = check(await sb.from('categories').insert({ household_id: hid, name: parent, kind, sort: sort++ }).select().single());
      const rows = subs.map((name, i) => ({ household_id: hid, parent_id: p.id, name, kind, sort: i }));
      const children = check(await sb.from('categories').insert(rows).select());
      for (const c of children) catIds[`${parent} › ${c.name}`] = c.id;
    }
  }
  const rules = SEED_RULES.map(([pattern, merchant, tx_type, cat, o]) => ({
    household_id: hid, pattern, merchant, tx_type,
    category_id: cat ? catIds[cat] ?? null : null,
    bank: o.bank ?? null, sign: o.sign ?? null, priority: o.priority ?? 10, origin: 'base',
  }));
  check(await sb.from('rules').insert(rules));
}

// ---------- Carga general ----------
export async function loadHousehold() {
  const [household, members, accounts, categories, rules, projects, contributions] = await Promise.all([
    sb.from('households').select('*').single().then(check),
    fetchAll('members'),
    fetchAll('accounts', '*', q => q.order('created_at')),
    fetchAll('categories', '*', q => q.order('sort')),
    fetchAll('rules'),
    fetchAll('projects', '*', q => q.order('created_at')),
    fetchAll('project_contributions', '*', q => q.order('date')),
  ]);
  return { household, members, accounts, categories, rules, projects, contributions };
}

export async function loadTransactions() {
  return fetchAll('transactions',
    'id,account_id,date,seq,amount,balance,raw_desc,merchant,category_id,tx_type,source,note,photo_path,created_at',
    q => q.order('date', { ascending: false }).order('seq', { ascending: false }));
}

export async function accountSummaries(from, to) {
  return check(await sb.rpc('account_summaries', { p_from: from, p_to: to }));
}

// ---------- Escrituras ----------
export const api = {
  async insert(table, row) { return check(await sb.from(table).insert(row).select().single()); },
  async insertMany(table, rows) { return rows.length ? check(await sb.from(table).insert(rows).select()) : []; },
  async update(table, id, patch) { return check(await sb.from(table).update(patch).eq('id', id).select().single()); },
  async updateWhere(table, patch, build) { return check(await build(sb.from(table).update(patch)).select('id')); },
  async remove(table, id) { check(await sb.from(table).delete().eq('id', id)); },
  async upsertIgnore(table, rows, onConflict) {
    if (!rows.length) return [];
    return check(await sb.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }).select());
  },
};

export async function uploadPhoto(householdId, accountId, file) {
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `${householdId}/${accountId}/${crypto.randomUUID()}.${ext}`;
  check(await sb.storage.from('tickets').upload(path, file, { contentType: file.type, upsert: false }));
  return path;
}

export async function photoUrl(path) {
  const data = check(await sb.storage.from('tickets').createSignedUrl(path, 600));
  return data.signedUrl;
}

export async function deletePhoto(path) {
  check(await sb.storage.from('tickets').remove([path]));
}
