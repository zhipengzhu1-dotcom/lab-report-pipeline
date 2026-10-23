import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellToDate, fmtDate, excelSerialToDate, findSignedDates, extractFromGrid,
  sigTooltip, worksheetToGrid, plainValue, exportRows
} from '../src/pipeline.js';

const ymd = d => d && fmtDate(d);

describe('cellToDate', () => {
  test('Excel serial numbers', () => {
    assert.equal(ymd(cellToDate(46027)), '01/05/2026');
    assert.equal(ymd(cellToDate(46027.75)), '01/05/2026');   // time of day dropped
    assert.equal(ymd(excelSerialToDate(25569)), '01/01/1970');
  });
  test('numbers outside the serial window are not dates (result values)', () => {
    assert.equal(cellToDate(23.5), null);
    assert.equal(cellToDate(19999), null);
    assert.equal(cellToDate(80001), null);
  });
  test('ISO and dotted Y-M-D', () => {
    assert.equal(ymd(cellToDate('2026-01-05')), '01/05/2026');
    assert.equal(ymd(cellToDate('2026.1.5')), '01/05/2026');
  });
  test('US M/D/Y with 2- and 4-digit years', () => {
    assert.equal(ymd(cellToDate('1/5/2026')), '01/05/2026');
    assert.equal(ymd(cellToDate('01-05-26')), '01/05/2026');
    assert.equal(ymd(cellToDate('12/31/69')), '12/31/2069');
    assert.equal(ymd(cellToDate('12/31/70')), '12/31/1970');
  });
  test('day-month-name and month-name forms', () => {
    assert.equal(ymd(cellToDate('5-Jan-2026')), '01/05/2026');
    assert.equal(ymd(cellToDate('5 January 26')), '01/05/2026');
    assert.equal(ymd(cellToDate('January 5, 2026')), '01/05/2026');
    assert.equal(ymd(cellToDate('Sept 30 2026')), '09/30/2026');
  });
  test('Date values pass through; invalid Date is rejected', () => {
    const d = new Date(2026, 0, 5);
    assert.equal(cellToDate(d), d);
    assert.equal(cellToDate(new Date('nope')), null);
  });
  test('out-of-range and malformed input is rejected', () => {
    for (const s of ['13/01/2026', '0/10/2026', '1/32/2026', '2/30/2026', '1/1/1949', '1/1/2121',
      '2026-13-01', '5-Foo-2026', 'Date', '', '   ', 'N/A', null, undefined, true]) {
      assert.equal(cellToDate(s), null, String(s));
    }
  });
});

// Header-row signature layout: labels on one row, values beneath.
const signedReport = () => [
  ['Example Labs'],
  ['Product Code:', 'PC-1001', null, 'Date Received:', '01/02/26'],
  ['Lot Number:', 'LOT-0001', null, 'Date:', '01/03/2026'],
  ['Product Type:', 'Initial-FP'],
  ['Test', 'Daily Dose', 'Specification', 'Result'],
  ['Impurity A', '8 Units', '<26.5 ng/day', '23.45 ng/day'],
  [],
  ['Prepared by', 'Signature', 'Date'],
  ['A. Analyst', null, new Date(2026, 0, 5)],
  [],
  ['Authorized by', 'Signature', 'Date'],
  ['B. Reviewer', null, '01/06/2026']
];

describe('findSignedDates', () => {
  test('authorizing signature beats prepared-by, prepared date kept', () => {
    const s = findSignedDates(signedReport());
    assert.equal(ymd(s.signedDate), '01/06/2026');
    assert.equal(s.signedBy, 'Authorized by');
    assert.equal(ymd(s.preparedDate), '01/05/2026');
  });
  test('authorizing wins even when it sits above prepared-by', () => {
    const g = [
      ['Approved by:', 'Signature', 'Date'], ['x', null, '2026-02-01'],
      ['Prepared by:', 'Signature', 'Date'], ['y', null, '2026-02-09']
    ];
    const s = findSignedDates(g);
    assert.equal(s.signedBy, 'Approved by');
    assert.equal(ymd(s.signedDate), '02/01/2026');
  });
  test('among equal-priority blocks the bottom-most wins', () => {
    const g = [['Reviewed by', 'Date'], [null, '3/1/2026'], ['Checked by', 'Date'], [null, '3/2/2026']];
    assert.equal(ymd(findSignedDates(g).signedDate), '03/02/2026');
  });
  test('an explicit "Date Signed" label wins over every role', () => {
    const g = [...signedReport(), ['Date Signed:', '5-Feb-2026']];
    const s = findSignedDates(g);
    assert.equal(ymd(s.signedDate), '02/05/2026');
    assert.equal(s.signedBy, 'Signed');
  });
  test('explicit label may carry its value on the row below', () => {
    const g = [['Signature Date'], [46027]];
    assert.equal(ymd(findSignedDates(g).signedDate), '01/05/2026');
  });
  test('"Date Received" and a bare header "Date:" are not signature dates', () => {
    const s = findSignedDates(signedReport().slice(0, 7));
    assert.deepEqual(s, { signedDate: null, signedBy: null, preparedDate: null });
  });
  test('a bare Date with Signature (no role) counts, value inline to the right', () => {
    const g = [['Signature', 'Date', 'January 9, 2026']];
    const s = findSignedDates(g);
    assert.equal(ymd(s.signedDate), '01/09/2026');
    assert.equal(s.signedBy, 'Signed');
  });
  test('the search below stops at the next block header', () => {
    const g = [['Prepared by', 'Date'], [null, 'Date'], [null, '1/1/2026']];
    assert.equal(findSignedDates(g).signedDate, null);
  });
  test('an unsigned block yields nothing', () => {
    const g = [['Prepared by', 'Signature', 'Date'], ['', null, '']];
    assert.equal(findSignedDates(g).signedDate, null);
  });
});

describe('extractFromGrid', () => {
  test('reads labelled fields, result beside the ng/day spec, signed date', () => {
    const r = extractFromGrid(signedReport(), 'any.xlsx');
    assert.equal(r.productCode, 'PC-1001');
    assert.equal(r.lotNumber, 'LOT-0001');
    assert.equal(r.productType, 'Initial-FP');
    assert.equal(r.result, 23.5);
    assert.equal(ymd(r.signedDate), '01/06/2026');
    assert.equal(r.source, 'any.xlsx');
  });
  test('skips blanks, formulas and "0" next to Product Code', () => {
    const r = extractFromGrid([['Product Code:', '', '=A1', '0', 'PC-7']]);
    assert.equal(r.productCode, 'PC-7');
  });
  test('result is the first numeric cell right of an ng/day cell', () => {
    const r = extractFromGrid([['<26.5 ng/Day', 'n/a', '12.04', '99']]);
    assert.equal(r.result, 12);
  });
  test('falls back to the file name for code and lot', () => {
    const r = extractFromGrid([['nothing here']], 'EX-0003_PC-1001_LOT-0003.xlsx');
    assert.equal(r.productCode, 'PC-1001');
    assert.equal(r.lotNumber, 'LOT-0003');
  });
  test('null when nothing recognisable is found', () => {
    assert.equal(extractFromGrid([['hello']], 'notes.xlsx'), null);
  });
  test('tooltip names the signer and a differing prepared date', () => {
    const r = extractFromGrid(signedReport());
    assert.equal(sigTooltip(r), 'Authorized by · Prepared by: 01/05/2026');
    assert.equal(sigTooltip({ signedDate: null }), 'No signature date found');
  });
  test('export rows start with the header', () => {
    const rows = exportRows([extractFromGrid(signedReport())]);
    assert.deepEqual(rows[0], ['Product Code', 'Lot Number', 'Product Type', 'Signed Date', 'Result (ng/Day)']);
    assert.equal(rows[1][4], 23.5);
  });
});

describe('worksheetToGrid', () => {
  test('flattens ExcelJS values and blanks merged followers', () => {
    const master = { address: 'A1' };
    const rows = {
      1: [{ value: 'Product Code:', isMerged: false }, { value: { richText: [{ text: 'PC-' }, { text: '9' }] } }],
      3: [{ value: 'm', isMerged: true, master, address: 'A1' }, { value: 'm', isMerged: true, master, address: 'B3' },
        { value: { formula: 'X', result: new Date(Date.UTC(2026, 0, 5)) } }]
    };
    const ws = {
      eachRow(_, fn) {
        Object.entries(rows).forEach(([rn, cells]) => fn({
          eachCell(_, f) { cells.forEach((c, i) => f(c, i + 1)); }
        }, +rn));
      }
    };
    const g = worksheetToGrid(ws);
    assert.equal(g.length, 3);
    assert.deepEqual(g[0], ['Product Code:', 'PC-9']);
    assert.deepEqual(g[1], []);
    assert.equal(g[2][0], 'm');
    assert.equal(g[2][1], undefined);
    assert.equal(ymd(g[2][2]), '01/05/2026');
  });
  test('plainValue handles hyperlinks, errors and invalid dates', () => {
    assert.equal(plainValue({ text: 'x', hyperlink: 'y' }), 'x');
    assert.equal(plainValue({ error: '#N/A' }), null);
    assert.equal(plainValue(new Date('bad')), null);
  });
});
