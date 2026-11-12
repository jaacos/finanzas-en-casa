// Normalización, extracción de comercio y aplicación de reglas.

export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function txText(t) {
  return norm(`${t.desc ?? t.raw_desc ?? ''} ${t.detail ?? ''}`);
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s(/-])([a-zñáéíóú])/g, (m, a, b) => a + b.toUpperCase());
}

function cleanCompany(s) {
  return s
    .replace(/,?\s*(s\.?\s?l\.?\s?u\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?l\.?|s\.?\s?c\.?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,.\s]+$/, '')
    .trim();
}

// Propuesta de nombre de comercio a partir del concepto del banco.
export function extractMerchant(bank, desc, detail = '') {
  let d = String(desc || '').trim();
  if (!detail && d.includes(' · ')) { const i = d.indexOf(' · '); detail = d.slice(i + 3); d = d.slice(0, i); }
  let m;
  if (bank === 'revolut') {
    if (/^al pocket|^retirada del pocket/i.test(d)) return 'Pocket';
    return d.replace(/\s+/g, ' ').slice(0, 60);
  }
  if (bank === 'bbva') {
    const det = String(detail || '').replace(/^de\s+/i, '').trim();
    if (det && !/^\d+$/.test(det)) return titleCase(cleanCompany(det)).slice(0, 60);
    return d.slice(0, 60);
  }
  // Santander y genérico
  if ((m = /^pago m[oó]vil en (.+?)(,|$)/i.exec(d))) return titleCase(m[1]);
  if ((m = /^compra (?:paypal \*)?(.+?)(,|$)/i.exec(d))) return titleCase(m[1].replace(/\*+$/, ''));
  if ((m = /^recibo (.+?)(?:,? n[ºo°] recibo|, concepto|,|$)/i.exec(d))) return titleCase(cleanCompany(m[1]));
  if ((m = /^bizum a favor de (.+?) concepto/i.exec(d))) return 'Bizum a ' + titleCase(m[1]);
  if ((m = /^bizum de (.+?) concepto/i.exec(d))) return 'Bizum de ' + titleCase(m[1]);
  if ((m = /^transferencia(?: inmediata)? a favor de (.+?) concepto/i.exec(d))) return titleCase(cleanCompany(m[1]));
  if ((m = /^transferencia(?: inmediata)? de (.+?),? concepto/i.exec(d))) return titleCase(cleanCompany(m[1]));
  if (/^ingreso en cajero/i.test(d)) return 'Ingreso en cajero';
  return d.replace(/\s+/g, ' ').slice(0, 50);
}

// Texto que se propone para reconocer el comercio la próxima vez.
export function suggestPattern(bank, desc, detail = '') {
  const merchant = extractMerchant(bank, desc, detail);
  return norm(merchant).replace(/\d{4,}/g, '').trim().slice(0, 40);
}

function patternMatches(pattern, text, rawDesc) {
  const p = norm(pattern);
  if (!p) return false;
  if (p.startsWith('=')) return norm(String(rawDesc).split(' · ')[0]) === p.slice(1);
  if (p.startsWith('^')) return text.startsWith(p.slice(1));
  return text.includes(p);
}

const ORIGIN_WEIGHT = { manual: 30, aprendida: 20, base: 10 };

export function sortRules(rules) {
  return [...rules].sort((a, b) =>
    (ORIGIN_WEIGHT[b.origin] ?? 0) - (ORIGIN_WEIGHT[a.origin] ?? 0) ||
    (b.priority ?? 0) - (a.priority ?? 0) ||
    norm(b.pattern).length - norm(a.pattern).length);
}

// rules debe venir ordenado con sortRules.
export function findRule(rules, bank, t) {
  const text = txText(t);
  const raw = t.desc ?? t.raw_desc ?? '';
  for (const r of rules) {
    if (r.bank && r.bank !== bank) continue;
    if (r.sign === '+' && t.amount < 0) continue;
    if (r.sign === '-' && t.amount > 0) continue;
    if (patternMatches(r.pattern, text, raw)) return r;
  }
  return null;
}

export function classify(rules, bank, t) {
  const r = findRule(rules, bank, t);
  if (!r) return { tx_type: 'pendiente', category_id: null, merchant: extractMerchant(bank, t.desc ?? t.raw_desc, t.detail), rule: null };
  return {
    tx_type: r.tx_type,
    category_id: r.category_id ?? null,
    merchant: r.merchant || extractMerchant(bank, t.desc ?? t.raw_desc, t.detail),
    rule: r,
  };
}

// Huella para descartar duplicados al reimportar periodos solapados.
export async function txHash(t, occurrence = 0) {
  const key = [t.date, t.amount.toFixed(2), t.balance == null ? `#${occurrence}` : t.balance.toFixed(2), norm(t.desc)].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Asigna el índice de repetición a movimientos idénticos sin saldo dentro de un mismo fichero.
export function occurrences(rows) {
  const seen = new Map();
  return rows.map(r => {
    const k = [r.date, r.amount, r.balance, norm(r.desc)].join('|');
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n;
  });
}
