// Lectura de ficheros, vista previa e inserción de movimientos.
import { parsePdfPages, pdfToPages, checkBalances, guessMapping, parseTable } from './parsers.js';
import { classify, txHash, occurrences } from './classify.js';
import { api, fetchAll } from './db.js';

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

export async function readTable(file) {
  await loadScript('vendor/xlsx.full.min.js');
  const buf = new Uint8Array(await file.arrayBuffer());
  let wb;
  if (/\.csv$|\.txt$/i.test(file.name)) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const FS = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    wb = window.XLSX.read(text, { type: 'string', FS, raw: true });
  } else {
    wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

// Paso 1: leer y preparar. No escribe nada.
export async function analyzeFile(state, account, file, mappingOverride) {
  let bank = account.bank, rows, table = null, mapping = null;
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const lib = await loadPdfjs();
    const pages = await pdfToPages(lib, new Uint8Array(await file.arrayBuffer()));
    const res = parsePdfPages(account.bank, pages);
    if (['santander', 'bbva', 'revolut'].includes(account.bank) && res.bank !== account.bank) {
      throw new Error(`Este extracto parece de ${res.bank.toUpperCase()} y la cuenta elegida es de ${account.bank.toUpperCase()}.`);
    }
    bank = res.bank; rows = res.rows;
  } else {
    table = await readTable(file);
    mapping = mappingOverride || validMapping(account.import_mapping, table) || guessMapping(table);
    if (!mapping) return { needsMapping: true, table };
    rows = parseTable(table, mapping);
  }
  if (!rows.length) throw new Error('No he encontrado movimientos en el fichero.');

  const balance = checkBalances(rows);
  const occ = occurrences(rows);
  for (let i = 0; i < rows.length; i++) rows[i].hash = await txHash(rows[i], occ[i]);

  // Duplicados: misma huella, o mismo día e importe (y saldo si ambos lo tienen).
  // Lo segundo detecta el mismo movimiento importado antes desde otro formato (PDF frente a Excel).
  const from = rows[0].date, to = rows[rows.length - 1].date;
  const existing = (await fetchAll('transactions', 'id,hash,date,amount,balance,source', q => q.eq('account_id', account.id).gte('date', from).lte('date', to)))
    .filter(e => e.source !== 'manual');
  const byHash = new Map(existing.map(e => [e.hash, e]));
  const byDay = new Map();
  for (const e of existing) {
    const k = `${e.date}|${(+e.amount).toFixed(2)}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const used = new Set();
  const enrich = [];
  const findTwin = r => {
    const h = byHash.get(r.hash);
    if (h && !used.has(h.id)) return h;
    const list = byDay.get(`${r.date}|${r.amount.toFixed(2)}`) || [];
    return list.find(e => !used.has(e.id) && (e.balance == null || r.balance == null || Math.abs(+e.balance - r.balance) < 0.005));
  };

  // Gastos apuntados a mano que ahora llegan por el banco
  const manual = state.tx.filter(t => t.account_id === account.id && t.source === 'manual');
  const usedManual = new Set();

  const prepared = [];
  for (const r of rows) {
    const twin = findTwin(r);
    if (twin) {
      used.add(twin.id);
      r.status = 'duplicado';
      if (twin.balance == null && r.balance != null) enrich.push({ id: twin.id, balance: r.balance });
      continue;
    }
    const m = manual.find(t => !usedManual.has(t.id) && Math.abs(+t.amount - r.amount) < 0.005 && Math.abs(daysBetween(t.date, r.date)) <= 5);
    if (m) { usedManual.add(m.id); r.status = 'manual'; r.manualId = m.id; prepared.push(r); continue; }
    const c = classify(state.sortedRules, bank, r);
    Object.assign(r, { status: c.tx_type === 'pendiente' ? 'pendiente' : 'clasificado', tx_type: c.tx_type, category_id: c.category_id, merchant: c.merchant });
    prepared.push(r);
  }
  const count = s => rows.filter(r => r.status === s).length;
  return {
    bank, rows, prepared, balance, mapping, table, enrich,
    stats: {
      total: rows.length, from, to,
      nuevos: prepared.length - count('manual'), duplicados: count('duplicado'), manual: count('manual'),
      clasificados: count('clasificado'), pendientes: count('pendiente'), saldos: enrich.length,
    },
  };
}

function validMapping(m, table) {
  if (!m || m.header == null || !table[m.header]) return null;
  const row = table[m.header].map(c => String(c ?? '').trim());
  // Mapeos guardados antes de existir la columna de producto se vuelven a deducir
  if (!('product' in m)) return null;
  return m.headerText && m.headerText === row.join('|') ? m : null;
}

export function headerText(table, header) {
  return (table[header] || []).map(c => String(c ?? '').trim()).join('|');
}

function daysBetween(a, b) {
  return (Date.parse(a) - Date.parse(b)) / 86400000;
}

// Paso 2: escribir.
export async function commitImport(state, account, file, analysis) {
  const imp = await api.insert('imports', {
    household_id: state.household.id, account_id: account.id, filename: file.name, stats: analysis.stats,
  });
  const fresh = analysis.prepared.filter(r => r.status !== 'manual').map(r => ({
    household_id: state.household.id, account_id: account.id, date: r.date, seq: r.seq,
    amount: r.amount, balance: r.balance, raw_desc: [r.desc, r.detail].filter(Boolean).join(' · '),
    merchant: r.merchant, category_id: r.category_id, tx_type: r.tx_type, source: 'importado',
    hash: r.hash, import_id: imp.id,
  }));
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 400) {
    const res = await api.upsertIgnore('transactions', fresh.slice(i, i + 400), 'account_id,hash');
    inserted += res.length;
  }
  for (const e of analysis.enrich || []) await api.update('transactions', e.id, { balance: e.balance });
  for (const r of analysis.prepared.filter(r => r.status === 'manual')) {
    await api.update('transactions', r.manualId, {
      date: r.date, seq: r.seq, balance: r.balance, raw_desc: [r.desc, r.detail].filter(Boolean).join(' · '),
      hash: r.hash, source: 'importado', import_id: imp.id,
    });
  }
  if (analysis.mapping && analysis.table) {
    const m = { ...analysis.mapping, headerText: headerText(analysis.table, analysis.mapping.header) };
    await api.update('accounts', account.id, { import_mapping: m });
  }
  return { inserted, merged: analysis.stats.manual };
}
