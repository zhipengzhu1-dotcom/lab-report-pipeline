// Pure logic for the lab report pipeline: building Report of Analysis workbooks
// from pasted TSV data, and extracting values back out of signed reports.
// No DOM, no spreadsheet library. Workbook access goes through small duck-typed
// adapters (fillWorksheet, worksheetToGrid) so everything here runs under node --test.

/* =========================================================================
   Build side
   ========================================================================= */

/** Parse tab-separated text as pasted from a spreadsheet. Quoted cells may hold
 *  tabs, newlines and doubled quotes. Cells are trimmed; blank lines are dropped. */
export function parseTSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') { q = true; }
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}

export const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Index of the first header cell matching an alias: exact (normalised) matches
 *  across all aliases first, then substring matches. -1 when nothing matches. */
export function pick(header, aliases) {
  for (const a of aliases) {
    const t = norm(a);
    const i = header.findIndex(h => norm(h) === t);
    if (i > -1) return i;
  }
  for (const a of aliases) {
    const t = norm(a);
    const i = header.findIndex(h => norm(h).includes(t));
    if (i > -1) return i;
  }
  return -1;
}

/** Rows of the sample receiving log. The header row is the first row naming
 *  both a lot column and a product code column; anything above it is ignored. */
export function readSamples(text) {
  const rows = parseTSV(text); if (!rows.length) return [];
  const hdrIdx = rows.findIndex(r => pick(r, ['lot#', 'lot number', 'lot']) > -1 && pick(r, ['product code', 'code']) > -1);
  if (hdrIdx < 0) throw new Error('No header row found in the receiving log.');
  const h = rows[hdrIdx];
  const c = {
    code: pick(h, ['product code', 'code']),
    name: pick(h, ['product name', 'name']),
    type: pick(h, ['type']),
    lot: pick(h, ['lot#', 'lot number', 'lot']),
    ref: pick(h, ['lab ref', 'labref', 'ref']),
    rdate: pick(h, ['rec date', 'recdate', 'date received', 'received date']),
    rtime: pick(h, ['rec time', 'rectime', 'time received']),
    rby: pick(h, ['recd by', 'received by', 'recdby']),
    book: pick(h, ['book ref#', 'book ref', 'bookref']),
    repd: pick(h, ['report date', 'reportdate'])
  };
  const out = [];
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i]; const g = k => c[k] > -1 ? (r[c[k]] || '') : '';
    if (!g('lot') && !g('code')) continue;
    if (norm(g('lot')) === 'lot') continue;          // a repeated header row
    out.push({ code: g('code'), name: g('name'), type: g('type'), lot: g('lot'), ref: g('ref'),
      rdate: g('rdate'), rtime: g('rtime'), rby: g('rby'), book: g('book'), repd: g('repd') });
  }
  return out;
}

/** Result rows. Several blocks may be pasted together (an ng/day block and a
 *  PPM block, each with its own header); every header row resets the columns. */
export function readResults(text) {
  const rows = parseTSV(text); const out = []; let c = null;
  for (const r of rows) {
    const isHeader = pick(r, ['lot#', 'lot number', 'lot']) > -1 && pick(r, ['code']) > -1;
    if (isHeader) {
      c = {
        code: pick(r, ['code']),
        lot: pick(r, ['lot#', 'lot number', 'lot']),
        status: pick(r, ['status']),
        ng: pick(r, ['impurity ngday', 'ng/day', 'ngday']),
        ppm: pick(r, ['ppm']),
        dose: pick(r, ['daily dose unit', 'daily dose'])
      };
      continue;
    }
    if (!c) continue;
    const g = k => c[k] > -1 ? (r[c[k]] || '') : '';
    const lot = g('lot'); if (!lot) continue;
    const ng = c.ng > -1 ? parseFloat(g('ng')) : NaN;
    const ppm = c.ppm > -1 ? parseFloat(g('ppm')) : NaN;
    if (isNaN(ng) && isNaN(ppm)) continue;
    out.push({ code: g('code'), lot, status: g('status'),
      ng: isNaN(ng) ? null : ng, ppm: isNaN(ppm) ? null : ppm, dose: g('dose') });
  }
  return out;
}

/** Half-up rounding on the decimal value, not the binary float.
 *  (22.95).toFixed(1) yields "22.9" because 22.95 is stored just under; this gives "23.0".
 *  Ties go toward +Infinity (Math.round), so -1.25 -> "-1.2". Returns a string. */
export function roundHalfUp(v, dp) {
  const shifted = Math.round(Number(v + 'e' + dp));
  return Number(shifted + 'e-' + dp).toFixed(dp);
}

/* token similarity (Dice coefficient over words, trailing "s" dropped),
   used only to split one lot across several samples */
const toks = s => new Set((s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(/\s+/).map(w => w.replace(/s$/, '')).filter(Boolean));
export function sim(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach(x => { if (B.has(x)) n++; });
  return 2 * n / (A.size + B.size);
}

export const isRawMaterial = s => norm(s.type) === 'rm';

/** Mean of the matched replicate rows in the sample's reporting unit
 *  (PPM for raw materials, ng/day otherwise), rounded half-up. null when no rows. */
export function averageResult(hits, rm, dpNg = 1, dpPpm = 4) {
  if (!hits.length) return null;
  const vals = hits.map(r => rm ? r.ppm : r.ng);
  return roundHalfUp(vals.reduce((a, b) => a + b, 0) / vals.length, rm ? dpPpm : dpNg);
}

export const DEFAULT_OPTIONS = {
  limit: '26.5', specFP: '<{limit} ng/day', rmSpec: 'Report in PPM',
  doseFP: '{n} Units', doseRM: 'N/A', dpNg: '1', dpPpm: '4', xlot: false
};

/**
 * Match receiving-log samples to result rows and produce one report row per sample.
 *  - a lot+code carried by one sample takes every usable row (replicates are averaged)
 *  - a lot+code shared by several samples is split by similarity of sample type to
 *    result status; ties or zero similarity mark the sample ambiguous
 *  - opts.xlot: unmatched samples may pair with unused rows of the same code whose
 *    status matches, across a lot-number disagreement (recorded as altLot)
 * Returns { reports, used, unused, message, isError }.
 */
export function matchBatch(samples, res, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const limit = parseFloat(o.limit);
  const specFP = String(o.specFP).replace(/{limit}/g, o.limit);
  const dpNg = parseInt(o.dpNg) || 1, dpPpm = parseInt(o.dpPpm) || 4;
  const today = o.today || new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const usable = (s, r) => isRawMaterial(s) ? r.ppm !== null : r.ng !== null;

  const assigned = samples.map(() => []);
  const flagged = samples.map(() => false);
  const altLot = samples.map(() => '');
  const used = new Set();
  const groups = {};
  samples.forEach((s, i) => { const k = norm(s.lot) + '|' + norm(s.code); (groups[k] = groups[k] || []).push(i); });

  Object.values(groups).forEach(idxs => {
    const s0 = samples[idxs[0]];
    const cands = res.filter(r => norm(r.lot) === norm(s0.lot)
      && (!r.code || !s0.code || norm(r.code) === norm(s0.code)));
    if (idxs.length === 1) {
      assigned[idxs[0]] = cands.filter(r => usable(s0, r));
      assigned[idxs[0]].forEach(r => used.add(r));
      return;
    }
    cands.forEach(r => {
      const pool = idxs.filter(i => usable(samples[i], r));
      if (!pool.length) return;
      const scores = pool.map(i => sim(samples[i].type, r.status));
      const best = Math.max(...scores);
      const win = pool.filter((_, j) => scores[j] === best);
      if (best === 0 || win.length > 1) win.forEach(i => flagged[i] = true);
      assigned[win[0]].push(r); used.add(r);
    });
  });

  if (o.xlot) {
    samples.forEach((s, i) => {
      if (assigned[i].length) return;
      const pool = res.filter(r => !used.has(r) && usable(s, r)
        && (!r.code || !s.code || norm(r.code) === norm(s.code)));
      if (!pool.length) return;
      const scored = pool.map(r => ({ r, sc: sim(s.type, r.status) })).sort((a, b) => b.sc - a.sc);
      if (scored[0].sc <= 0) return;
      const take = scored.filter(x => x.sc === scored[0].sc).map(x => x.r);
      take.forEach(r => used.add(r));
      assigned[i] = take;
      altLot[i] = take[0].lot;
    });
  }

  const reports = samples.map((s, i) => {
    const rm = isRawMaterial(s);
    const hits = assigned[i];
    const unit = rm ? 'PPM' : 'ng/day';
    const value = averageResult(hits, rm, dpNg, dpPpm);
    const dose = hits.find(h => h.dose)?.dose || '';
    return {
      sel: hits.length > 0 && !flagged[i],
      ref: s.ref, code: s.code, name: s.name, lot: s.lot, type: s.type,
      rdate: s.rdate, rtime: s.rtime, rby: s.rby, book: s.book,
      date: s.repd || today,
      reps: hits.length,
      from: hits.map(h => h.status || '—').join(' + '),
      altLot: altLot[i],
      shared: groups[norm(s.lot) + '|' + norm(s.code)].length > 1,
      ambiguous: flagged[i],
      isRM: rm,
      spec: rm ? o.rmSpec : specFP,
      dose: rm ? o.doseRM : String(o.doseFP).replace(/{n}/g, dose || '8'),
      result: value === null ? '' : value + ' ' + unit,
      num: value === null ? null : parseFloat(value),
      limit: rm ? null : limit
    };
  });

  const matched = reports.filter(r => r.reps > 0).length;
  const missing = reports.length - matched;
  const amb = reports.filter(r => r.ambiguous).length;
  const split = reports.filter(r => r.shared).length;
  const xl = reports.filter(r => r.altLot).length;
  let message = matched + ' of ' + reports.length + ' samples matched'
    + (missing ? ' — ' + missing + ' without results' : '')
    + (split ? ' · ' + split + ' share a lot, split by status' : '')
    + (reports.some(r => r.reps > 1) ? ' · replicates averaged' : '')
    + (xl ? ' · ' + xl + ' paired across a lot mismatch' : '')
    + (amb ? ' · ' + amb + ' need a manual check' : '');
  let isError = false;
  const unused = res.filter(r => !used.has(r));
  if (missing && unused.length) {
    const sl = [...new Set(samples.map(s => s.lot).filter(Boolean))].join(', ');
    const rl = [...new Set(unused.map(r => r.lot).filter(Boolean))].join(', ');
    if (sl !== rl) {
      message += '\nLot numbers do not agree — receiving log has ' + sl + ', results have ' + rl + '.';
      isError = true;
    }
    message += '\nUnused result rows: ' + unused.map(r => (r.lot || '?') + ' / ' + (r.status || '—')).join(' · ');
  }
  return { reports, used, unused, message, isError };
}

/** At or above the limit is out of specification. Raw materials carry no limit. */
export const isOverLimit = r => r.limit !== null && r.limit !== undefined && !isNaN(r.limit)
  && r.num !== null && r.num >= r.limit;

/** Review-table status, in the order the original tool checks them. */
export function reportStatus(r) {
  if (r.reps === 0) return 'no result';
  if (r.ambiguous) return 'check match';
  if (r.altLot) return 'lot mismatch';
  if (isOverLimit(r)) return 'over limit';
  return 'pass';
}

const ILLEGAL = /[\\/:*?"<>|]/g;
export const safeName = s => String(s || 'batch').replace(ILLEGAL, '-');

/** Render a file-name pattern. Tokens: {ref} {code} {lot} {type} {name} {date}.
 *  Slashes in the date become dashes; characters illegal in file names become dashes. */
export function fileName(pattern, r) {
  const v = k => String(r[k] ?? '');
  return String(pattern)
    .replace(/{ref}/g, () => v('ref')).replace(/{code}/g, () => v('code')).replace(/{lot}/g, () => v('lot'))
    .replace(/{type}/g, () => v('type')).replace(/{name}/g, () => v('name'))
    .replace(/{date}/g, () => v('date').replace(/\//g, '-'))
    .replace(ILLEGAL, '-');
}

/** CSV batch record: one row per generated report. BOM + CRLF so Excel opens it cleanly.
 *  ctx: { analyte, method, pattern, template, genBy, stamp } */
export function recordCSV(list, ctx) {
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const head = ['Ref', 'Analyte', 'Test Method', 'Product Code', 'Product Name', 'Lot', 'Type', 'Reporting Basis', 'Result',
    'Specification', 'Daily Dose', 'Replicates Averaged', 'Source Result Rows', 'Lot On Results Sheet', 'Limit Applied', 'Report Date',
    'Output File', 'Template', 'Generated By', 'Generated At'];
  const rows = list.map(r => [
    r.ref, ctx.analyte, ctx.method, r.code, r.name, r.lot, r.type, r.isRM ? 'PPM' : 'ng/day', r.result,
    r.spec, r.dose, r.reps, r.from, r.altLot || r.lot, r.limit === null ? 'n/a' : r.limit + ' ng/day', r.date,
    fileName(ctx.pattern, r), ctx.template, ctx.genBy, ctx.stamp
  ]);
  return '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}

/* ---------- filling a template worksheet ---------- */

/** Plain text of an ExcelJS-style cell value (rich text, formula result, hyperlink). */
export function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

/** Label cells whose right-hand neighbour receives the report reference, if empty. */
export const REF_LABELS = ['Report Ref#', 'REF#'];

/** Placeholder text -> value. A placeholder cell is any cell containing "<" whose
 *  text includes the needle; the first matching needle wins. */
export function placeholderMap(r, s) {
  return [
    ['Analyte', s.analyte],
    ['Test method', s.method],
    ['Document revision', s.docrev],
    ['PO#', s.po],
    ['Client', s.client],
    ['Attn', s.attn],
    ['Address line 1', s.addr1],
    ['Address line 2', s.addr2],
    ['Product name goes here', r.name],
    ['Lot number goes here', r.lot],
    ['Product code goes here', r.code],
    ['Product type', r.type],
    ['Date Received', r.rdate],
    ['Time Received', r.rtime],
    ['Received by', r.rby],
    ['Book Reference', r.book],
    ['Daily dose', r.dose],
    ['Specification', r.spec],
    ['results in', r.result],
    ["today's date", r.date],
    ['Prepared by name', s.presign ? s.preparedBy : ''],
    ['Prepared date', s.presign ? signDates(r.date).prepared : ''],
    ['Authorized by name', s.presign ? s.authorizedBy : ''],
    ['Authorized date', s.presign ? signDates(r.date).authorized : '']
  ];
}

/** Demo pre-signing: prepared on the report date, authorized the next day.
 *  Returned as UTC-midnight Dates, which is how a spreadsheet date cell is stored. */
export function signDates(reportDate, now = new Date()) {
  const d = cellToDate(reportDate) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const utc = (x, plus) => new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate() + plus));
  return { prepared: utc(d, 0), authorized: utc(d, 1) };
}

/**
 * Fill one worksheet (ExcelJS Worksheet or anything with eachRow / row.eachCell /
 * row.getCell) for report r with batch settings s. Only placeholder cells (text
 * containing "<") are replaced; field labels are never touched. Older templates
 * without placeholders are still reached by label: Document Revision:, PO#:, Attn.
 */
export function fillWorksheet(ws, r, s) {
  const map = placeholderMap(r, s);
  const byLabel = { 'Document Revision:': s.docrev, 'PO#:': s.po };
  ws.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      const t = cellText(cell.value);
      if (!t) return;
      const tt = t.trim();
      if (REF_LABELS.includes(tt)) {
        const nx = row.getCell(cell.col + 1);
        if (!cellText(nx.value)) nx.value = r.ref;
        return;
      }
      if (byLabel[tt] !== undefined) { row.getCell(cell.col + 1).value = byLabel[tt]; return; }
      if (/^Attn\b/.test(tt)) { cell.value = s.attn; return; }
      if (!t.includes('<')) return;
      for (const [needle, val] of map) {
        if (t.includes(needle)) {
          cell.value = val ?? '';
          if (val instanceof Date) cell.numFmt = 'mm/dd/yyyy';
          return;
        }
      }
    });
  });
  return ws;
}

/* =========================================================================
   Extract side
   ========================================================================= */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Local-midnight Date, or null when the parts are out of range or roll over (Feb 30). */
export function mkDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1950 && y <= 2120)) return null;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt) || dt.getMonth() !== m - 1) return null;
  return dt;
}

export const fullYear = y => y >= 100 ? y : (y < 70 ? 2000 + y : 1900 + y);

/** Excel 1900-system serial -> local date (time of day dropped). */
export function excelSerialToDate(v) {
  const ms = Math.round((Math.floor(v) - 25569) * 86400000);   // 25569 = 1970-01-01
  const u = new Date(ms);
  return mkDate(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
}

/** Accepts Date values, Excel serial numbers and the common text formats:
 *  ISO Y-M-D, US M/D/Y (2- or 4-digit year), "5-Jan-2026", "January 5, 2026". */
export function cellToDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;   // outside ~1954-2119; ignores result values
    return excelSerialToDate(v);
  }
  const s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)))
    return mkDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)))
    return mkDate(fullYear(+m[3]), +m[1], +m[2]);          // US M/D/Y
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{2,4})$/))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mo >= 0) return mkDate(fullYear(+m[3]), mo + 1, +m[1]);
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mo >= 0) return mkDate(fullYear(+m[3]), mo + 1, +m[2]);
  }
  return null;
}

export function fmtDate(d) {
  if (!d) return null;
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' + d.getFullYear();
}

const RE_DATE_LABEL = /^date\s*:?$/i;
const RE_SIG_LABEL = /^signature\s*:?$/i;
const RE_ROLE_LABEL = /^(prepared|authoriz(?:ed)?|approved|reviewed|checked|released|verified)\s*by\s*:?$/i;
const RE_EXPLICIT_SIGN = /^(date\s*signed|signed\s*date|signature\s*date|date\s*of\s*signature)\s*:?$/i;
const RE_FINAL_ROLE = /^(authoriz|approv|releas)/i;

/* A cell grid is an array of rows, each an array of plain values
   (string | number | boolean | Date | null). Rows may be ragged. */
const gridAt = (grid, r, c) => (grid[r] && grid[r][c] !== undefined) ? grid[r][c] : null;
const gridCols = grid => grid.reduce((n, row) => Math.max(n, row ? row.length : 0), 0);
const txt = v => (v != null && !(v instanceof Date)) ? String(v).trim() : '';

/**
 * Signature-block dates. Handles a header-row layout ("Prepared by | Signature | Date"
 * with values on the row beneath) and an inline "Date Signed:" label with the value
 * alongside or below. A bare "Date" only counts on a row that also carries
 * "Signature" or a "... by" role, so "Date Received:" in a header block is ignored.
 * Priority: explicit "Date Signed" > authorizing/approving/releasing role > others,
 * then the bottom-most block.
 */
export function findSignedDates(grid) {
  const rows = grid.length, cols = gridCols(grid);
  const at = (r, c) => gridAt(grid, r, c);
  const blocks = [];

  for (let r = 0; r < rows; r++) {
    let dateCol = null, hasSig = false, role = '';
    for (let c = 0; c < cols; c++) {
      const v = txt(at(r, c));
      if (!v || v.length > 40) continue;
      if (RE_EXPLICIT_SIGN.test(v)) {
        let d = null;
        for (let j = c + 1; j < cols && !d; j++) d = cellToDate(at(r, j));
        for (let rr = r + 1; rr <= Math.min(r + 2, rows - 1) && !d; rr++) d = cellToDate(at(rr, c));
        if (d) blocks.push({ role: 'Signed', date: d, priority: 0, row: r });
      } else if (RE_DATE_LABEL.test(v)) {
        dateCol = c;
      } else if (RE_SIG_LABEL.test(v)) {
        hasSig = true;
      } else if (RE_ROLE_LABEL.test(v)) {
        role = v.replace(/\s*:$/, '').trim();
      }
    }
    if (dateCol !== null && (hasSig || role)) {
      let d = null;
      for (let rr = r + 1; rr <= Math.min(r + 2, rows - 1); rr++) {
        const below = txt(at(rr, dateCol));
        if (RE_DATE_LABEL.test(below) || RE_SIG_LABEL.test(below)) break;   // next block starts
        d = cellToDate(at(rr, dateCol));
        if (d) break;
      }
      for (let j = dateCol + 1; j < cols && !d; j++) d = cellToDate(at(r, j));
      if (d) blocks.push({ role: role || 'Signed', date: d, priority: RE_FINAL_ROLE.test(role) ? 1 : 2, row: r });
    }
  }

  if (!blocks.length) return { signedDate: null, signedBy: null, preparedDate: null };
  blocks.sort((a, b) => a.priority - b.priority || b.row - a.row);
  const prepared = blocks.find(b => /^prepared/i.test(b.role));
  return { signedDate: blocks[0].date, signedBy: blocks[0].role, preparedDate: prepared ? prepared.date : null };
}

/** Patterns used to recover code / lot from the file name when the labels are missing.
 *  They follow this demo's naming (PC-1001, LOT-0001); adjust for a real scheme. */
export const FILENAME_PATTERNS = {
  code: /(?<![A-Za-z0-9])(PC-\d{4})(?!\d)/i,
  lot: /(?<![A-Za-z0-9])(LOT-\d{4})(?!\d)/i
};

/**
 * Pull Product Code, Lot Number, Product Type, the ng/Day result and the signed
 * date out of one report's first sheet, given as a cell grid. Returns null when
 * nothing recognisable was found.
 */
export function extractFromGrid(grid, filename = '', patterns = FILENAME_PATTERNS) {
  const rows = grid.length, cols = gridCols(grid);
  const at = (r, c) => gridAt(grid, r, c);
  const present = x => x != null && String(x).trim() !== '';
  const firstRight = (r, c, ok) => {
    for (let j = c + 1; j < cols; j++) { const x = at(r, j); if (ok(x)) return x; }
    return undefined;
  };
  let productCode = null, lotNumber = null, productType = null, result = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = at(r, c);
      if (cell == null) continue;
      const v = String(cell || '').trim();
      if (v === 'Product Code:') {
        const x = firstRight(r, c, x => present(x) && !String(x).startsWith('=') && String(x) !== '0');
        if (x !== undefined) productCode = String(x).trim();
      } else if (v === 'Lot Number:') {
        const x = firstRight(r, c, x => present(x) && !String(x).startsWith('='));
        if (x !== undefined) lotNumber = String(x).trim();
      } else if (v === 'Product Type:') {
        const x = firstRight(r, c, present);
        if (x !== undefined) productType = String(x).trim();
      } else if (/ng\/day/i.test(v)) {
        const x = firstRight(r, c, x => x != null && !(x instanceof Date) && !isNaN(parseFloat(x)));
        if (x !== undefined) result = Number(roundHalfUp(parseFloat(x), 1));
      }
    }
  }

  if (!productCode) { const m = filename.match(patterns.code); if (m) productCode = m[1]; }
  if (!lotNumber) { const m = filename.match(patterns.lot); if (m) lotNumber = m[1]; }

  const sig = findSignedDates(grid);
  if (!productCode && !lotNumber && result === null && !sig.signedDate) return null;
  return { productCode, lotNumber, productType, result,
    signedDate: sig.signedDate, signedBy: sig.signedBy, preparedDate: sig.preparedDate, source: filename };
}

export function sigTooltip(r) {
  if (!r.signedDate) return 'No signature date found';
  const parts = [];
  if (r.signedBy) parts.push(r.signedBy);
  if (r.preparedDate && fmtDate(r.preparedDate) !== fmtDate(r.signedDate))
    parts.push('Prepared by: ' + fmtDate(r.preparedDate));
  return parts.join(' · ');
}

/** Plain value of an ExcelJS cell value, for the grid. Dates come back from
 *  ExcelJS as UTC midnight; they are re-anchored to local midnight. */
export function plainValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('result' in v) return plainValue(v.result);
    if ('text' in v) return plainValue(v.text);
    return null;                                    // errors, bare formulas without a cached result
  }
  return v;
}

/** ExcelJS worksheet -> cell grid. Merged-range followers are left empty, so a
 *  merged value appears once, at its top-left cell. */
export function worksheetToGrid(ws) {
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    const out = grid[rn - 1] = [];
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      out[cn - 1] = plainValue(cell.value);
    });
  });
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  return grid;
}

/** Rows for the extraction export, header first. Dates stay Date objects. */
export function exportRows(list) {
  return [['Product Code', 'Lot Number', 'Product Type', 'Signed Date', 'Result (ng/Day)'],
    ...list.map(r => [r.productCode || '', r.lotNumber || '', r.productType || '', r.signedDate || '', r.result])];
}
