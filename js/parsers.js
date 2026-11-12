// Lectores de extractos bancarios.
// Entrada: páginas de pdf.js convertidas a items {str, x, y}. Salida: movimientos
// {date:'YYYY-MM-DD', amount, balance|null, desc, detail, seq} en orden cronológico.

const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };

export function parseEsNumber(s) {
  if (s == null) return null;
  let t = String(s).replace(/\s/g, '').replace('€', '').replace(/[−–]/g, '-');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function isoDate(d, m, y) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function textDate(s) {
  const m = /^(\d{1,2}) ([a-zé]+)\.? (\d{4})$/i.exec(s.trim());
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  return mo ? isoDate(+m[1], mo, +m[3]) : null;
}

// Agrupa los items de cada página en líneas (tolerancia vertical de 3 puntos).
export function toLines(pages) {
  const out = [];
  pages.forEach((items, pi) => {
    const sorted = items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it);
      else lines.push({ y: it.y, items: [it], page: pi });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.text = l.items.map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
      out.push(l);
    }
  });
  return out;
}

function finish(rows, newestFirst) {
  const r = newestFirst ? rows.reverse() : rows;
  r.forEach((x, i) => { x.seq = i; x.desc = x.desc.trim(); x.detail = (x.detail || '').trim(); });
  return r;
}

// Comprueba que cada saldo = saldo anterior + importe. Devuelve nº de saltos.
export function checkBalances(rows) {
  let checked = 0, bad = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.balance == null || b.balance == null) continue;
    checked++;
    if (Math.abs(a.balance + b.amount - b.balance) > 0.011) bad++;
  }
  return { checked, bad };
}

// ---------- Santander (PDF de "Movimientos de tu cuenta") ----------
export function parseSantander(pages) {
  const lines = toLines(pages);
  const rows = [];
  const re = /^(\d{2} [a-z]+ \d{4}) (.+?) ([−-])? ?([\d.]+,\d\d) ?€ ([−-])? ?([\d.]+,\d\d) ?€$/i;
  for (const l of lines) {
    const m = re.exec(l.text);
    if (m) {
      const date = textDate(m[1]);
      if (!date) continue;
      const amt = parseEsNumber(m[4]) * (m[3] ? -1 : 1);
      const bal = parseEsNumber(m[6]) * (m[5] ? -1 : 1);
      rows.push({ date, amount: round2(amt), balance: round2(bal), desc: m[2], detail: '', _page: l.page });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last && last._page === l.page && /^F\. valor:/.test(l.text)) {
      const extra = l.text.replace(/^F\. valor: \d{1,2} [a-z]+ \d{4}\s*/i, '');
      if (extra) last.desc += ' ' + extra;
    }
  }
  rows.forEach(r => delete r._page);
  return finish(rows, isNewestFirst(rows));
}

// ---------- BBVA (PDF de "Últimos movimientos") ----------
export function parseBBVA(pages) {
  const lines = toLines(pages);
  const rows = [];
  const re = /^(\d{2})\/(\d{2})\/(\d{4}) (.+?) (-?[\d.]+,\d\d) ?€ (-?[\d.]+,\d\d) ?€$/;
  for (const l of lines) {
    const m = re.exec(l.text);
    if (m) {
      rows.push({ date: isoDate(+m[1], +m[2], +m[3]), amount: round2(parseEsNumber(m[5])), balance: round2(parseEsNumber(m[6])), desc: m[4], detail: '', _page: l.page });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last && last._page === l.page && /^Fecha valor/.test(l.text) && !last.detail) {
      last.detail = l.text
        .replace(/^Fecha valor \d{2}\/\d{2}\/\d{4}\s*/, '')
        .replace(/^N \d{6,}\s*/, '')
        .replace(/\s+CPVR$/, '');
    }
  }
  rows.forEach(r => delete r._page);
  return finish(rows, isNewestFirst(rows));
}

// ---------- Revolut (extracto PDF en EUR) ----------
// El signo depende de la columna (Dinero saliente / Dinero entrante).
export function parseRevolut(pages) {
  const lines = toLines(pages);
  const rows = [];
  let section = null, xOut = null, xIn = null, descX = null;
  const amtRe = /^-?[\d.]+,\d\d ?€$/;
  for (const l of lines) {
    const t = l.text;
    if (/^Transacciones de la cuenta/i.test(t)) { section = 'cuenta'; continue; }
    if (/^Transacciones de Pockets/i.test(t)) { section = 'pocket'; continue; }
    if (/^Pendientes/i.test(t)) { section = 'pendiente'; continue; }
    const hOut = l.items.find(i => /Dinero saliente/i.test(i.str));
    const hIn = l.items.find(i => /Dinero entrante/i.test(i.str));
    if (hOut && hIn) { xOut = hOut.x; xIn = hIn.x; const d = l.items.find(i => /Descripci/i.test(i.str)); if (d) descX = d.x; continue; }
    if (section !== 'cuenta' || xOut == null) continue;

    const it = l.items;
    const d1 = it[0] && textDate(it[0].str);
    const d2 = it[1] && textDate(it[1].str);
    if (d1 && d2) {
      const amts = it.filter(i => amtRe.test(i.str.trim()));
      if (!amts.length) continue;
      const a = amts[0];
      const sign = Math.abs(a.x - xOut) <= Math.abs(a.x - xIn) ? -1 : 1;
      const desc = it.slice(2).filter(i => !amts.includes(i)).map(i => i.str.trim()).join(' ');
      rows.push({
        date: d1, amount: round2(sign * parseEsNumber(a.str)),
        balance: amts.length > 1 ? round2(parseEsNumber(amts[amts.length - 1].str)) : null,
        desc, detail: '', _page: l.page, _y: l.y, _where: false,
      });
      continue;
    }
    const last = rows[rows.length - 1];
    if (!last || last._page !== l.page || last._y - l.y > 30) continue;
    if (descX != null && l.items[0].x < descX - 8) continue;
    if (/^Tarjeta:/.test(t)) continue;
    if (/^A /.test(t)) { last.detail = t.slice(2); last._where = true; }
    else if (/^De /.test(t)) { last.detail = t; }
    else if (!last._where && !last.detail) last.desc += ' ' + t;
  }
  rows.forEach(r => { delete r._page; delete r._y; delete r._where; });
  return finish(rows, false);
}

function isNewestFirst(rows) {
  return rows.length > 1 && rows[0].date > rows[rows.length - 1].date;
}

function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

export function detectBank(pages) {
  const sample = toLines(pages.slice(0, 2)).map(l => l.text).join('\n');
  if (/Revolut Bank/i.test(sample)) return 'revolut';
  if (/BANCO BILBAO VIZCAYA|Últimos movimientos/i.test(sample)) return 'bbva';
  if (/Movimientos de tu cuenta|F\. valor:/i.test(sample)) return 'santander';
  return null;
}

export function parsePdfPages(bank, pages) {
  const b = detectBank(pages) || bank;
  if (b === 'revolut') return { bank: b, rows: parseRevolut(pages) };
  if (b === 'bbva') return { bank: b, rows: parseBBVA(pages) };
  if (b === 'santander') return { bank: b, rows: parseSantander(pages) };
  throw new Error('No reconozco el formato de este PDF. Prueba con el Excel o CSV del banco.');
}

// Convierte un documento pdf.js en páginas de items.
export async function pdfToPages(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
  }
  return pages;
}

// ---------- Tablas (CSV / Excel) ----------
// mapping: {header: índice fila cabecera, date, desc, amount | debit+credit, balance?, dateFormat}
const H = {
  date: /^(fecha( (de )?(operaci[oó]n|transacci[oó]n|inicio))?|f\.? ?operaci[oó]n|started date|date|completed date|fecha de finalizaci[oó]n)$/i,
  desc: /^(concepto|descripci[oó]n|description|movimiento|operaci[oó]n|detalle)$/i,
  amount: /^(importe|amount|cantidad|importe \(?eur\)?)$/i,
  debit: /^(cargo|cargos|debe|dinero saliente|salida)$/i,
  credit: /^(abono|abonos|haber|dinero entrante|entrada)$/i,
  balance: /^(saldo|balance|saldo \(?eur\)?)$/i,
  state: /^(state|estado)$/i,
  detail: /^(observaciones|m[aá]s datos|referencia|beneficiario)$/i,
};

export function guessMapping(table) {
  for (let r = 0; r < Math.min(table.length, 30); r++) {
    const row = (table[r] || []).map(c => String(c ?? '').trim());
    const find = re => row.findIndex(c => re.test(c));
    const date = find(H.date), desc = find(H.desc), amount = find(H.amount);
    const debit = find(H.debit), credit = find(H.credit);
    if (date >= 0 && desc >= 0 && (amount >= 0 || (debit >= 0 && credit >= 0))) {
      return { header: r, date, desc, amount, debit, credit, balance: find(H.balance), state: find(H.state), detail: find(H.detail) };
    }
  }
  return null;
}

export function parseAnyDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return isoDate(v.getDate(), v.getMonth() + 1, v.getFullYear());
  if (typeof v === 'number' && v > 20000 && v < 80000) { // fecha serial de Excel
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isoDate(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return isoDate(+m[1], +m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]);
  return textDate(s.toLowerCase());
}

export function parseTable(table, map) {
  const rows = [];
  for (let r = map.header + 1; r < table.length; r++) {
    const row = table[r] || [];
    const date = parseAnyDate(row[map.date]);
    if (!date) continue;
    if (map.state >= 0 && /pend|revert|declin|rechaz/i.test(String(row[map.state] ?? ''))) continue;
    let amount;
    if (map.amount >= 0) amount = toNum(row[map.amount]);
    else amount = (toNum(row[map.credit]) || 0) - Math.abs(toNum(row[map.debit]) || 0);
    if (amount == null || amount === 0 && map.amount >= 0) continue;
    rows.push({
      date, amount: round2(amount),
      balance: map.balance >= 0 ? round2(toNum(row[map.balance])) : null,
      desc: String(row[map.desc] ?? '').trim(),
      detail: map.detail >= 0 ? String(row[map.detail] ?? '').trim() : '',
    });
  }
  return finish(rows, isNewestFirst(rows));
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  return parseEsNumber(v);
}
