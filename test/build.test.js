import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTSV, pick, readSamples, readResults, roundHalfUp, sim, averageResult,
  matchBatch, isOverLimit, reportStatus, fileName, recordCSV, fillWorksheet, cellText
} from '../src/pipeline.js';

describe('parseTSV', () => {
  test('splits tabs and lines, trims cells', () => {
    assert.deepEqual(parseTSV('a\t b \tc\n1\t2\t3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  });
  test('drops blank and whitespace-only lines, keeps empty cells', () => {
    assert.deepEqual(parseTSV('a\tb\n\n \t \n\tx\n'), [['a', 'b'], ['', 'x']]);
  });
  test('normalises CRLF and lone CR', () => {
    assert.deepEqual(parseTSV('a\r\nb\rc'), [['a'], ['b'], ['c']]);
  });
  test('quoted cells keep tabs, newlines and doubled quotes', () => {
    assert.deepEqual(parseTSV('"line 1\nline 2"\t"say ""hi"""\t"a\tb"\nz'),
      [['line 1\nline 2', 'say "hi"', 'a\tb'], ['z']]);
  });
  test('a quote mid-cell is literal', () => {
    assert.deepEqual(parseTSV('5" vial\tx'), [['5" vial', 'x']]);
  });
});

describe('pick', () => {
  test('exact match on any alias beats a substring match on an earlier alias', () => {
    // "lot" is a substring of "Lot Description", but "LOT#" is an exact hit
    assert.equal(pick(['Lot Description', 'LOT#'], ['lot#', 'lot']), 1);
  });
  test('falls back to substring, ignoring case and punctuation', () => {
    assert.equal(pick(['#', 'Impurity A (ng/day)'], ['ng/day']), 1);
  });
  test('-1 when absent', () => {
    assert.equal(pick(['a', 'b'], ['ppm']), -1);
  });
});

const SAMPLES = [
  'Batch notes\t\t',
  'Product Code\tProduct Name\tType\tLot#\tLab Ref\tRec. Date\tReport Date',
  'PC-1\tLorem\tFP\tL1\tEX-1\t01/02/26\t01/05/2026',
  'Product Code\tProduct Name\tType\tLot#\tLab Ref\tRec. Date\tReport Date',
  '\t\t\t\t\t\t',
  'PC-2\tIpsum\tRM\tL2\tEX-2\t01/02/26\t'
].join('\n');

describe('readSamples', () => {
  test('finds the header below preamble, skips repeated headers and empty rows', () => {
    const s = readSamples(SAMPLES);
    assert.equal(s.length, 2);
    assert.deepEqual([s[0].code, s[0].lot, s[0].ref, s[0].rdate, s[0].repd], ['PC-1', 'L1', 'EX-1', '01/02/26', '01/05/2026']);
    assert.equal(s[1].type, 'RM');
  });
  test('throws without a header row', () => {
    assert.throws(() => readSamples('x\ty\n1\t2'), /No header row/);
  });
  test('empty input gives no rows', () => {
    assert.deepEqual(readSamples('  \n'), []);
  });
});

describe('readResults', () => {
  test('reads several blocks, each with its own header', () => {
    const r = readResults([
      'Code\tStatus\tLot#\tDaily dose Unit\tImpurity A (ng/day)',
      'PC-1\tFP-1\tL1\t8\t20.5',
      'PC-1\tFP-2\tL1\t8\tn/a',
      '',
      'Code\tStatus\tLot#\tPPM',
      'PC-2\tRM\tL2\t0.0412',
      'PC-2\tRM\t\t0.05'
    ].join('\n'));
    assert.deepEqual(r, [
      { code: 'PC-1', lot: 'L1', status: 'FP-1', ng: 20.5, ppm: null, dose: '8' },
      { code: 'PC-2', lot: 'L2', status: 'RM', ng: null, ppm: 0.0412, dose: '' }
    ]);
  });
  test('rows before any header are ignored', () => {
    assert.deepEqual(readResults('PC-1\tL1\t3'), []);
  });
});

describe('roundHalfUp', () => {
  test('rounds decimal ties up where toFixed rounds down', () => {
    assert.equal((22.95).toFixed(1), '22.9');
    assert.equal(roundHalfUp(22.95, 1), '23.0');
    assert.equal(roundHalfUp(1.005, 2), '1.01');
    assert.equal(roundHalfUp(0.125, 2), '0.13');
  });
  test('pads to the requested places', () => {
    assert.equal(roundHalfUp(23, 1), '23.0');
    assert.equal(roundHalfUp(0.04, 4), '0.0400');
  });
  test('negative ties go toward +Infinity', () => {
    assert.equal(roundHalfUp(-1.25, 1), '-1.2');
    assert.equal(roundHalfUp(-1.26, 1), '-1.3');
  });
  test('tiny negatives do not print as -0', () => {
    assert.equal(roundHalfUp(-0.04, 1), '0.0');
  });
  test('averageResult uses the reporting unit and its decimals', () => {
    assert.equal(averageResult([{ ng: 24.1 }, { ng: 22.8 }], false, 1, 4), '23.5');
    assert.equal(averageResult([{ ppm: 0.04125 }], true, 1, 4), '0.0413');
    assert.equal(averageResult([], false), null);
  });
});

describe('sim', () => {
  test('Dice coefficient over words, plural-insensitive', () => {
    assert.equal(sim('Blister', 'blisters'), 1);
    assert.equal(sim('Initial FP', 'FP'), 2 / 3);
    assert.equal(sim('Vial', 'Blister'), 0);
    assert.equal(sim('', 'x'), 0);
  });
});

const S = (o) => ({ code: 'PC-1', name: 'Lorem', type: 'FP', lot: 'L1', ref: 'EX-1', repd: '01/05/2026', ...o });
const R = (o) => ({ code: 'PC-1', lot: 'L1', status: 'FP-1', ng: 10, ppm: null, dose: '8', ...o });

describe('matchBatch', () => {
  test('exact lot+code match; replicates averaged', () => {
    const { reports } = matchBatch([S()], [R({ ng: 24.1 }), R({ status: 'FP-2', ng: 22.8 })]);
    assert.equal(reports[0].reps, 2);
    assert.equal(reports[0].result, '23.5 ng/day');
    assert.equal(reports[0].from, 'FP-1 + FP-2');
    assert.equal(reports[0].sel, true);
    assert.equal(reports[0].spec, '<26.5 ng/day');
    assert.equal(reports[0].dose, '8 Units');
  });
  test('lot match ignores case and punctuation; a blank code on either side still matches', () => {
    const { reports } = matchBatch([S({ lot: 'lot-0001' })], [R({ lot: 'LOT 0001', code: '' })]);
    assert.equal(reports[0].reps, 1);
  });
  test('a different product code does not match', () => {
    const { reports } = matchBatch([S()], [R({ code: 'PC-9' })]);
    assert.equal(reports[0].reps, 0);
  });
  test('shared lot is split by fuzzy similarity of type to status', () => {
    const { reports } = matchBatch(
      [S({ type: 'Vial', ref: 'A' }), S({ type: 'Blister', ref: 'B' })],
      [R({ status: 'Blisters', ng: 14.2 }), R({ status: 'vial', ng: 12.6 })]);
    assert.deepEqual(reports.map(r => r.result), ['12.6 ng/day', '14.2 ng/day']);
    assert.ok(reports.every(r => r.shared && !r.ambiguous && r.sel));
  });
  test('shared lot with no similar status is flagged for a manual check and deselected', () => {
    const { reports, message } = matchBatch(
      [S({ type: 'Vial' }), S({ type: 'Blister' })], [R({ status: 'Bulk' })]);
    assert.equal(reports[0].ambiguous, true);
    assert.equal(reports[0].sel, false);
    assert.equal(reportStatus(reports[0]), 'check match');
    assert.match(message, /need a manual check/);
  });
  test('raw materials use PPM rows only, with no limit', () => {
    const { reports } = matchBatch([S({ type: 'RM' })], [R({ ng: 5 }), R({ ng: null, ppm: 0.04125 })]);
    assert.equal(reports[0].result, '0.0413 PPM');
    assert.equal(reports[0].limit, null);
    assert.equal(reports[0].spec, 'Report in PPM');
  });
  test('unmatched: no result, lot disagreement reported', () => {
    const { reports, message, isError, unused } = matchBatch([S({ lot: 'L1' })], [R({ lot: 'L9' })]);
    assert.equal(reports[0].reps, 0);
    assert.equal(reports[0].sel, false);
    assert.equal(reports[0].result, '');
    assert.equal(reportStatus(reports[0]), 'no result');
    assert.equal(unused.length, 1);
    assert.equal(isError, true);
    assert.match(message, /receiving log has L1, results have L9/);
  });
  test('xlot pairs across a lot mismatch on code + status and records it', () => {
    const { reports } = matchBatch([S({ lot: 'L1', type: 'FP' })], [R({ lot: 'L9', status: 'FP' })], { xlot: true });
    assert.equal(reports[0].altLot, 'L9');
    assert.equal(reportStatus(reports[0]), 'lot mismatch');
  });
  test('xlot will not pair when status shares nothing with type', () => {
    const { reports } = matchBatch([S({ type: 'Blend' })], [R({ lot: 'L9', status: 'FP-1' })], { xlot: true });
    assert.equal(reports[0].reps, 0);
  });
  test('report date falls back to today', () => {
    const { reports } = matchBatch([S({ repd: '' })], [], { today: '02/03/2026' });
    assert.equal(reports[0].date, '02/03/2026');
  });
});

describe('spec flag', () => {
  const r = num => ({ reps: 1, limit: 26.5, num });
  test('at the limit is over; just below passes', () => {
    assert.equal(isOverLimit(r(26.5)), true);
    assert.equal(reportStatus(r(26.5)), 'over limit');
    assert.equal(isOverLimit(r(26.4)), false);
    assert.equal(reportStatus(r(26.4)), 'pass');
  });
  test('no limit or no value never flags', () => {
    assert.equal(isOverLimit({ limit: null, num: 999 }), false);
    assert.equal(isOverLimit({ limit: 26.5, num: null }), false);
  });
  test('a limit is parsed from the option and substituted into the spec', () => {
    const { reports } = matchBatch([S()], [R({ ng: 10 })], { limit: '10', specFP: 'NMT {limit} ng/day' });
    assert.equal(reports[0].spec, 'NMT 10 ng/day');
    assert.equal(reportStatus(reports[0]), 'over limit');
  });
});

describe('fileName', () => {
  const r = { ref: 'EX-1', code: 'PC-1', lot: 'L/1', type: 'FP', name: 'Lorem 10 mg', date: '01/05/2026' };
  test('renders every token', () => {
    assert.equal(fileName('{ref}_{code}_{lot}_{type}_{name}_{date}.xlsx', r),
      'EX-1_PC-1_L-1_FP_Lorem 10 mg_01-05-2026.xlsx');
  });
  test('replaces characters illegal in file names', () => {
    assert.equal(fileName('{code}:?*.xlsx', r), 'PC-1---.xlsx');
  });
  test('values containing $ patterns are inserted literally', () => {
    assert.equal(fileName('{ref}.xlsx', { ref: "A$&B$'" }), "A$&B$'.xlsx");
  });
  test('unknown tokens stay as written', () => {
    assert.equal(fileName('{bogus}.xlsx', r), '{bogus}.xlsx');
  });
});

describe('recordCSV', () => {
  test('BOM, CRLF, quoting, limit text', () => {
    const csv = recordCSV(
      [{ ref: 'EX-1', code: 'PC-1', name: 'He said "hi"', lot: 'L1', type: 'FP', isRM: false, result: '1.0 ng/day',
        spec: '<26.5 ng/day', dose: '8 Units', reps: 2, from: 'FP-1 + FP-2', altLot: '', limit: 26.5, date: '01/05/2026' },
       { ref: 'EX-2', code: 'RM-1', name: 'x', lot: 'L2', type: 'RM', isRM: true, result: '', spec: '', dose: '',
        reps: 0, from: '', altLot: 'L9', limit: null, date: '' }],
      { analyte: 'A', method: 'M', pattern: '{ref}.xlsx', template: 'T', genBy: 'AA', stamp: 'now' });
    assert.ok(csv.startsWith('﻿"Ref","Analyte"'));
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[1].includes('"He said ""hi"""'));
    assert.ok(lines[1].includes('"26.5 ng/day"'));
    assert.ok(lines[1].includes('"EX-1.xlsx"'));
    assert.ok(lines[2].includes('"PPM"') && lines[2].includes('"n/a"') && lines[2].includes('"L9"'));
  });
});

/* minimal stand-in for an ExcelJS worksheet */
function fakeSheet(rows) {
  const cells = rows.map((vals, ri) => vals.map((v, ci) => ({ value: v, col: ci + 1, row: ri + 1 })));
  const getCell = (ri, c) => {
    while (cells[ri].length < c) cells[ri].push({ value: null, col: cells[ri].length + 1 });
    return cells[ri][c - 1];
  };
  return {
    cells,
    eachRow(_, fn) {
      cells.forEach((row, ri) => fn({
        eachCell(_, f) { row.filter(c => c.value != null).forEach(f); },
        getCell: c => getCell(ri, c)
      }));
    }
  };
}

describe('fillWorksheet', () => {
  const r = { ref: 'EX-1', code: 'PC-1', name: 'Lorem', lot: 'L1', type: 'FP', dose: '8 Units',
    spec: '<26.5 ng/day', result: '23.5 ng/day', date: '01/05/2026', rdate: '01/02/26' };
  const s = { analyte: 'Impurity A', method: 'TM', docrev: 'B', po: 'PO-1', client: 'Lorem Ipsum Pharma',
    attn: 'Attn. Dolor Sit', addr1: 'a1', addr2: 'a2', presign: true, preparedBy: 'P', authorizedBy: 'Q' };

  test('fills placeholders, leaves labels alone, fills the ref and label-addressed cells', () => {
    const ws = fakeSheet([
      ['Product Code:', '<Product code goes here>'],
      ['Report Ref#', null],
      ['Document Revision:', 'old'],
      ['Attn: someone'],
      ['<Specification>', { richText: [{ text: '<results ' }, { text: 'in>' }] }],
      ['Specification'],
      ['<Prepared date>', '<Authorized date>']
    ]);
    fillWorksheet(ws, r, s);
    const v = ws.cells.map(row => row.map(c => c.value));
    assert.deepEqual(v[0], ['Product Code:', 'PC-1']);
    assert.deepEqual(v[1], ['Report Ref#', 'EX-1']);
    assert.deepEqual(v[2], ['Document Revision:', 'B']);
    assert.deepEqual(v[3], ['Attn. Dolor Sit']);
    assert.deepEqual(v[4], ['<26.5 ng/day', '23.5 ng/day']);
    assert.deepEqual(v[5], ['Specification']);
    assert.equal(v[6][0].toISOString().slice(0, 10), '2026-01-05');
    assert.equal(v[6][1].toISOString().slice(0, 10), '2026-01-06');
    assert.equal(ws.cells[6][0].numFmt, 'mm/dd/yyyy');
  });
  test('an existing ref value is kept; without presign the signature dates are blank', () => {
    const ws = fakeSheet([['REF#', 'keep'], ['<Prepared date>']]);
    fillWorksheet(ws, r, { ...s, presign: false });
    assert.equal(ws.cells[0][1].value, 'keep');
    assert.equal(ws.cells[1][0].value, '');
  });
  test('cellText reads rich text, formula results and hyperlinks', () => {
    assert.equal(cellText({ richText: [{ text: 'a' }, { text: 'b' }] }), 'ab');
    assert.equal(cellText({ formula: 'A1', result: 3 }), '3');
    assert.equal(cellText({ text: 'link', hyperlink: 'x' }), 'link');
    assert.equal(cellText(null), '');
  });
});
