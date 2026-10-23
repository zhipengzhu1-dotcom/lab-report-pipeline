// Build every demo report with the same code the page runs, write real .xlsx
// bytes, read them back and extract. Needs the exceljs dev dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readSamples, readResults, matchBatch, fileName, fmtDate } from '../src/pipeline.js';
import { createTemplate, buildReport, readReport } from '../src/template.js';
import { DEMO_SAMPLES, DEMO_RESULTS, DEMO_SETTINGS } from '../src/demo.js';

test('demo batch survives build -> .xlsx -> extract', async () => {
  const tpl = await createTemplate(ExcelJS);
  const { reports } = matchBatch(readSamples(DEMO_SAMPLES), readResults(DEMO_RESULTS), { xlot: true });
  const settings = { ...DEMO_SETTINGS, presign: true };
  assert.equal(reports.length, 8);

  for (const r of reports) {
    const name = fileName('{ref}_{code}_{lot}.xlsx', r);
    const buf = await buildReport(ExcelJS, tpl, r, settings);
    const x = await readReport(ExcelJS, buf, name);
    assert.ok(x, name);
    assert.equal(x.productCode, r.code, name);
    assert.equal(x.lotNumber, r.lot, name);
    assert.equal(x.productType, r.type, name);
    assert.equal(x.result, r.isRM ? null : r.num, name);          // the extractor reads ng/Day only
    assert.equal(fmtDate(x.signedDate), '10/18/2026', name);       // authorized: report date + 1
    assert.equal(fmtDate(x.preparedDate), '10/17/2026', name);
    assert.equal(x.signedBy, 'Authorized by', name);
  }
});

test('unsigned reports extract fields but no signed date; header dates ignored', async () => {
  const tpl = await createTemplate(ExcelJS);
  const { reports } = matchBatch(readSamples(DEMO_SAMPLES), readResults(DEMO_RESULTS));
  const buf = await buildReport(ExcelJS, tpl, reports[0], { ...DEMO_SETTINGS, presign: false });
  const x = await readReport(ExcelJS, buf, 'r.xlsx');
  assert.equal(x.productCode, 'PC-1001');
  assert.equal(x.result, 23.5);
  assert.equal(x.signedDate, null);
});

test('the filled workbook keeps no placeholders and carries the batch settings', async () => {
  const tpl = await createTemplate(ExcelJS);
  const { reports } = matchBatch(readSamples(DEMO_SAMPLES), readResults(DEMO_RESULTS));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildReport(ExcelJS, tpl, reports[0], { ...DEMO_SETTINGS, presign: true }));
  const text = [];
  wb.worksheets[0].eachRow(row => row.eachCell(c => text.push(String(c.value))));
  const all = text.join('\n');
  assert.ok(!/<[A-Za-z]/.test(all), 'placeholder left behind');
  for (const v of ['Lorem Ipsum Pharma', 'Attn. Dolor Sit', 'Nitrosamine Impurity A', 'EX-0001', '23.5 ng/day', '8 Units'])
    assert.ok(all.includes(v), v);
});
