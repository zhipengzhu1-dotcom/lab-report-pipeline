// UI wiring. All parsing, matching and extraction lives in pipeline.js.
import {
  readSamples, readResults, matchBatch, reportStatus, isOverLimit, fileName, safeName,
  recordCSV, fmtDate, sigTooltip, exportRows
} from './pipeline.js';
import { BUILTIN_TEMPLATE, createTemplate, buildReport, readReport } from './template.js';
import { DEMO_SAMPLES, DEMO_RESULTS, DEMO_SETTINGS } from './demo.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const libsOk = typeof ExcelJS !== 'undefined' && typeof JSZip !== 'undefined';

let builtinBuf = null, templates = {}, reports = [], lastBuilt = [];
const extracted = [];

/* ---------- tabs ---------- */
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  tabs.forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(n); n.focus();
  });
});

/* ---------- storage (IndexedDB, falls back to this session only) ---------- */
const store = (() => {
  let dbp = null, mem = {}, live = true;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      let rq; try { rq = indexedDB.open('lab-report-pipeline', 1); } catch { live = false; return res(null); }
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { live = false; res(null); };
      setTimeout(() => { if (live === true) res(rq.result || null); }, 1500);
    });
    return dbp;
  }
  return {
    async get(k) {
      const db = await open(); if (!db) return mem[k];
      return new Promise(r => {
        try { const rq = db.transaction('kv').objectStore('kv').get(k); rq.onsuccess = () => r(rq.result); rq.onerror = () => r(undefined); }
        catch { r(mem[k]); }
      });
    },
    async set(k, v) {
      mem[k] = v; const db = await open(); if (!db) return;
      return new Promise(r => {
        try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => r(); tx.onerror = () => r(); }
        catch { r(); }
      });
    },
    live: () => live
  };
})();

/* ---------- template library ---------- */
const tplName = () => $('tplPick').value;
const tplBufFor = () => tplName() === BUILTIN_TEMPLATE ? builtinBuf : templates[tplName()];

function renderTpl(sel) {
  const p = $('tplPick');
  p.innerHTML = [BUILTIN_TEMPLATE, ...Object.keys(templates)]
    .map(n => '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  $('tplDel').disabled = p.value === BUILTIN_TEMPLATE;
  $('tplState').textContent = store.live()
    ? 'Library saved in this browser. Your templates: ' + (Object.keys(templates).length || 'none yet') + '.'
    : 'This browser blocks local storage, so the library lasts for this session only.';
}
$('tplFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  templates[f.name] = await f.arrayBuffer();
  await store.set('templates', templates);
  renderTpl(f.name); saveSettings(); e.target.value = '';
});
$('tplPick').addEventListener('change', () => { renderTpl(tplName()); saveSettings(); });
$('tplDel').addEventListener('click', async () => {
  const n = tplName(); if (n === BUILTIN_TEMPLATE) return;
  delete templates[n]; await store.set('templates', templates);
  renderTpl(BUILTIN_TEMPLATE); saveSettings();
});
$('tplGet').addEventListener('click', e => {
  e.preventDefault();
  if (builtinBuf) save(new Blob([builtinBuf]), 'Report-of-Analysis-template.xlsx');
});

/* ---------- settings ---------- */
const SETTINGS = ['pattern', 'genBy', 'limit', 'specFP', 'rmSpec', 'doseFP', 'doseRM', 'dpNg', 'dpPpm',
  'analyte', 'method', 'docrev', 'po', 'client', 'attn', 'addr1', 'addr2', 'preparedBy', 'authorizedBy'];
const FLAGS = ['xlot', 'presign'];
function saveSettings() {
  const s = { template: tplName() };
  SETTINGS.forEach(k => s[k] = $(k).value);
  FLAGS.forEach(k => s[k] = $(k).checked);
  store.set('settings', s);
}
const batchSettings = () => {
  const s = {}; SETTINGS.forEach(k => s[k] = $(k).value); FLAGS.forEach(k => s[k] = $(k).checked); return s;
};

async function init() {
  templates = (await store.get('templates')) || {};
  const s = (await store.get('settings')) || {};
  SETTINGS.forEach(k => { if (s[k] !== undefined && s[k] !== '') $(k).value = s[k]; });
  FLAGS.forEach(k => { if (s[k] !== undefined) $(k).checked = s[k]; });
  renderTpl(s.template && (s.template === BUILTIN_TEMPLATE || templates[s.template]) ? s.template : BUILTIN_TEMPLATE);
  SETTINGS.concat(FLAGS).forEach(k => $(k).addEventListener('change', saveSettings));
  if (libsOk) builtinBuf = await createTemplate(ExcelJS);
}

/* ---------- matching ---------- */
function build() {
  const log = $('buildLog');
  log.textContent = ''; log.className = 'log';
  let samples, res;
  try { samples = readSamples($('samples').value); res = readResults($('results').value); }
  catch (err) { log.className = 'log err'; log.textContent = err.message; return; }
  if (!samples.length) { log.className = 'log err'; log.textContent = 'No sample rows read.'; return; }
  const out = matchBatch(samples, res, {
    limit: $('limit').value, specFP: $('specFP').value, rmSpec: $('rmSpec').value,
    doseFP: $('doseFP').value, doseRM: $('doseRM').value, dpNg: $('dpNg').value, dpPpm: $('dpPpm').value,
    xlot: $('xlot').checked
  });
  reports = out.reports;
  log.textContent = out.message;
  if (out.isError) log.className = 'log err';
  render(); trace();
}

/* ---------- review table ---------- */
const TAG_CLASS = { 'no result': 'none', 'check match': 'none', 'lot mismatch': 'none', 'over limit': 'over', 'pass': 'ok' };
function render() {
  if (!reports.length) return;
  let h = '<table><thead><tr><th><span class="sr">Include</span></th><th>Ref</th><th>Code</th><th>Lot</th><th>Type</th>'
    + '<th>Daily dose</th><th>Specification</th><th>Result</th><th>Date</th>'
    + '<th title="Result rows averaged; * = lot shared with another sample">n</th><th>Status</th></tr></thead><tbody>';
  reports.forEach((r, i) => {
    const st = reportStatus(r);
    h += '<tr class="on" data-i="' + i + '">'
      + '<td><input type="checkbox" data-k="sel" data-i="' + i + '" ' + (r.sel ? 'checked' : '') + ' aria-label="Include ' + esc(r.ref) + '"></td>'
      + '<td>' + esc(r.ref) + '</td><td>' + esc(r.code) + '</td><td>' + esc(r.lot) + '</td><td>' + esc(r.type) + '</td>'
      + '<td><input data-k="dose" data-i="' + i + '" value="' + esc(r.dose) + '" size="9" aria-label="Daily dose"></td>'
      + '<td><input data-k="spec" data-i="' + i + '" value="' + esc(r.spec) + '" size="13" aria-label="Specification"></td>'
      + '<td><input data-k="result" data-i="' + i + '" value="' + esc(r.result) + '" size="12" aria-label="Result"></td>'
      + '<td><input data-k="date" data-i="' + i + '" value="' + esc(r.date) + '" size="10" aria-label="Report date"></td>'
      + '<td class="reps' + (r.shared ? ' sh' : '') + '" title="' + esc(r.from || 'no rows matched') + '">'
      + (r.reps ? r.reps + (r.shared ? '*' : '') : '—') + '</td>'
      + '<td><span class="tag ' + TAG_CLASS[st] + '">' + st + '</span></td></tr>';
  });
  $('tableWrap').innerHTML = h + '</tbody></table>';
  $('genBar').hidden = false;
  $('tableWrap').querySelectorAll('input').forEach(el => {
    el.addEventListener('input', () => {
      const r = reports[+el.dataset.i];
      if (el.dataset.k === 'sel') r.sel = el.checked;
      else {
        r[el.dataset.k] = el.value;
        if (el.dataset.k === 'result') { const v = parseFloat(el.value); r.num = isNaN(v) ? null : v; trace(); }
      }
    });
  });
  $('tableWrap').querySelectorAll('tr.on').forEach(tr => {
    tr.addEventListener('mouseenter', () => highlight(+tr.dataset.i));
    tr.addEventListener('mouseleave', () => highlight(-1));
  });
}
function highlight(i) {
  document.querySelectorAll('.pk').forEach(p => p.style.opacity = (i < 0 || +p.dataset.i === i) ? 1 : .2);
  document.querySelectorAll('tr.on').forEach(tr => tr.classList.toggle('hl', +tr.dataset.i === i));
}

/* ---------- review trace: one peak per sample, height relative to the limit ---------- */
function trace() {
  const svg = $('trace'), H = 96, base = H - 14, top = 8;
  const has = reports.filter(r => r.num !== null);
  $('traceFig').hidden = !has.length;
  if (!has.length) { svg.innerHTML = ''; return; }
  const W = Math.max(320, Math.round(svg.clientWidth) || 1000);   // draw in CSS pixels so marks stay round
  const rmMax = Math.max(...reports.filter(x => x.limit === null && x.num !== null).map(x => x.num), 1e-9);
  const amp = r => r.limit ? Math.min(r.num / r.limit, 1.3) : (r.num / rmMax) * 0.7;
  const hue = r => r.reps === 0 ? 'var(--attn)' : isOverLimit(r) ? 'var(--over)'
    : r.limit === null ? 'var(--w-blue-deep)' : 'var(--ok)';
  const n = reports.length, step = W / (n + 1), span = base - top;
  let d = 'M0,' + base, marks = '';
  reports.forEach((r, i) => {
    const x = step * (i + 1);
    if (r.num === null) {
      marks += '<line x1="' + x + '" y1="' + base + '" x2="' + x + '" y2="' + (base - 12) + '" stroke="var(--attn)" stroke-dasharray="2 3"/>';
      return;
    }
    const hgt = Math.max(5, amp(r) * span), y = base - hgt, w = step * 0.32;
    d += ' L' + (x - w) + ',' + base
      + ' C' + (x - w * .44) + ',' + base + ' ' + (x - w * .30) + ',' + y + ' ' + x + ',' + y
      + ' C' + (x + w * .30) + ',' + y + ' ' + (x + w * .44) + ',' + base + ' ' + (x + w) + ',' + base;
    marks += '<circle class="pk" data-i="' + i + '" cx="' + x + '" cy="' + y + '" r="4" fill="' + hue(r) + '"/>';
  });
  d += ' L' + W + ',' + base;
  const limY = base - span / 1.3;
  const lim = reports.some(r => r.limit)
    ? '<line x1="0" y1="' + limY + '" x2="' + W + '" y2="' + limY + '" stroke="var(--over)" stroke-dasharray="3 6" opacity=".7"/>' : '';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = lim
    + '<path d="' + d + ' L0,' + base + ' Z" fill="var(--w-blue)" opacity=".55"/>'
    + '<path d="' + d + '" fill="none" stroke="var(--ink)" stroke-width="1.4"/>'
    + '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="var(--line)"/>'
    + marks;
  const over = reports.filter(isOverLimit).length;
  $('trL').textContent = reports.length + ' samples · ' + has.length + ' with results';
  $('trR').textContent = (reports.some(r => r.limit) ? 'limit ' + $('limit').value + ' ng/day (dashed) · ' : '')
    + (over ? over + ' over limit' : 'all within limit');
}
addEventListener('resize', () => { if (reports.length) trace(); });

/* ---------- generating ---------- */
function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function generate(onlySelected) {
  const log = $('genLog');
  const list = reports.filter(r => onlySelected ? r.sel : true);
  if (!list.length) { log.className = 'log err'; log.textContent = 'Nothing selected.'; return; }
  if (!libsOk) { log.className = 'log err'; log.textContent = 'ExcelJS and JSZip did not load; check the connection and reload.'; return; }
  log.className = 'log'; log.textContent = 'Building ' + list.length + ' reports…';
  try {
    const s = batchSettings();
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const zip = new JSZip();
    const built = [];
    for (const r of list) {
      const name = fileName(s.pattern, r);
      const buf = await buildReport(ExcelJS, tplBufFor(), r, s);
      zip.file(name, buf); built.push({ name, buf });
    }
    const tag = safeName(list[0].book || list[0].code);
    zip.file('generation-record_' + tag + '.csv', recordCSV(list, {
      analyte: s.analyte, method: s.method, pattern: s.pattern, template: tplName(), genBy: s.genBy, stamp
    }));
    save(await zip.generateAsync({ type: 'blob' }), 'reports_' + tag + '.zip');
    lastBuilt = built;
    $('toExtract').hidden = false; $('useBuilt').disabled = false;
    log.textContent = list.length + ' reports downloaded, with the batch record. Unzip them and drop the .xlsx files (or the .zip) on the Extract tab.';
  } catch (e) { log.className = 'log err'; log.textContent = 'Generate failed: ' + e.message; }
}

$('build').addEventListener('click', build);
$('genZip').addEventListener('click', () => generate(false));
$('genSel').addEventListener('click', () => generate(true));
['limit', 'specFP', 'rmSpec', 'doseFP', 'doseRM', 'dpNg', 'dpPpm', 'xlot']
  .forEach(id => $(id).addEventListener('change', () => { if (reports.length) build(); }));
$('toExtract').addEventListener('click', () => { selectTab(tabs[1]); useBuilt(); });

$('demo').addEventListener('click', () => {
  Object.entries(DEMO_SETTINGS).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
  $('presign').checked = true;
  $('samples').value = DEMO_SAMPLES;
  $('results').value = DEMO_RESULTS;
  saveSettings();
  build();
  $('tableWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* =================== Extract =================== */
const dropZone = $('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('over'); handleFiles(e.dataTransfer.files); });
$('fileInput').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
$('useBuilt').addEventListener('click', useBuilt);
$('clearAll').addEventListener('click', () => { extracted.length = 0; renderExtracted(); });
$('exportXlsx').addEventListener('click', exportXlsx);

const isXlsx = n => /\.xlsx$/i.test(n) && !/(^|\/)~\$/.test(n) && !/^__MACOSX\//.test(n);

/** Expand dropped files into [{name, buf}], unpacking any .zip. */
async function collect(files) {
  const out = [], bad = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const e of Object.values(zip.files)) {
        if (!e.dir && isXlsx(e.name)) out.push({ name: e.name.split('/').pop(), buf: await e.async('arraybuffer') });
      }
    } else if (isXlsx(f.name)) out.push({ name: f.name, buf: await f.arrayBuffer() });
    else bad.push(f.name);
  }
  return { out, bad };
}

async function handleFiles(files) {
  if (!libsOk) { showStatus(0, 0, 'ExcelJS and JSZip did not load; check the connection and reload.'); return; }
  let items, bad;
  try { ({ out: items, bad } = await collect([...files])); }
  catch (e) { showStatus(0, 1); return; }
  await extractAll(items, bad.length);
}
function useBuilt() { if (lastBuilt.length) extractAll(lastBuilt, 0); }

async function extractAll(items, preErrors) {
  let ok = 0, errors = preErrors;
  for (const { name, buf } of items) {
    try {
      const row = await readReport(ExcelJS, buf.slice(0), name);
      if (row) { extracted.push(row); ok++; } else errors++;
    } catch (err) { console.error(name, err); errors++; }
  }
  showStatus(ok, errors);
  renderExtracted();
}

function renderExtracted() {
  const any = extracted.length > 0;
  $('resultsArea').hidden = !any; $('emptyState').hidden = any;
  if (!any) return;
  $('rowCount').textContent = extracted.length + ' record' + (extracted.length !== 1 ? 's' : '');
  $('tableBody').innerHTML = extracted.map((r, i) => '<tr>'
    + '<td>' + (i + 1) + '</td>'
    + '<td>' + esc(r.productCode || '—') + '</td>'
    + '<td>' + esc(r.lotNumber || '—') + '</td>'
    + '<td>' + esc(r.productType || '—') + '</td>'
    + '<td title="' + esc(sigTooltip(r)) + '">' + esc(fmtDate(r.signedDate) || '—') + '</td>'
    + '<td><span class="file-tag">' + esc(r.source) + '</span></td>'
    + '<td class="num">' + (r.result !== null ? r.result.toFixed(1) : '—') + '</td></tr>').join('');
}

let statusTimer = null;
function showStatus(ok, err, msg) {
  let h = '';
  if (msg) h = '<p class="status error">' + esc(msg) + '</p>';
  if (ok > 0) h += '<p class="status success">Extracted data from ' + ok + ' file' + (ok > 1 ? 's' : '') + '.</p>';
  if (err > 0) h += '<p class="status error">' + err + ' file' + (err > 1 ? 's' : '') + ' could not be read. Only .xlsx (or a .zip of them) is supported.</p>';
  $('statusArea').innerHTML = h;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('statusArea').innerHTML = ''; }, 6000);
}

async function exportXlsx() {
  if (!extracted.length || !libsOk) return;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Extracted Data');
  exportRows(extracted).forEach((row, i) => {
    const r = ws.addRow(row.map(v => v instanceof Date ? new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())) : v));
    if (i === 0) r.font = { bold: true };
  });
  ws.getColumn(4).numFmt = 'mm/dd/yyyy';
  ws.getColumn(5).numFmt = '0.0';
  ws.columns.forEach((c, i) => { c.width = [16, 14, 24, 14, 16][i]; });
  save(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Extracted_Results.xlsx');
}

if (!libsOk) {
  document.querySelector('.foot').insertAdjacentHTML('afterbegin',
    '<p class="log err">The spreadsheet libraries did not load. Open this page with an internet connection so ExcelJS and JSZip can be fetched.</p>');
}
init();
