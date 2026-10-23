// Generic Report of Analysis template, generated at runtime with ExcelJS.
// Placeholder cells contain "<...>" and are filled by fillWorksheet() in pipeline.js.
// Labels ("Product Code:", "Lot Number:", ...) are what the extractor looks for.

import { fillWorksheet, worksheetToGrid, extractFromGrid } from './pipeline.js';

export const BUILTIN_TEMPLATE = 'Built-in: generic Report of Analysis';

/** Build the template workbook. Pass the ExcelJS namespace (global in the
 *  browser, the npm package under node). Returns an ArrayBuffer-like buffer. */
export async function createTemplate(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Example Labs';
  const ws = wb.addWorksheet('Report', {
    pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  ws.columns = [{ width: 30 }, { width: 26 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 14 }];

  const ink = { argb: 'FF1F2430' }, soft = { argb: 'FF5B6170' };
  const put = (addr, value, style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    if (style.font) c.font = style.font;
    if (style.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
    if (style.border) c.border = style.border;
    c.alignment = { vertical: 'middle', wrapText: true, ...(style.align || {}) };
    return c;
  };
  const label = { font: { bold: true, color: ink, size: 10 } };
  const value = { font: { color: ink, size: 10 } };
  const thin = { style: 'thin', color: { argb: 'FF9AA3B5' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  put('A1', 'Example Labs', { font: { bold: true, size: 16, color: ink } });
  put('A2', 'Report of Analysis', { font: { size: 12, color: soft } });
  put('A3', '1 Lorem Ipsum Way, Suite 100, Dolor City, ST 00000', { font: { size: 9, color: soft } });

  put('A5', 'Client:', label);            put('B5', '<Client>', value);
  put('D5', 'Report Ref#', label);
  put('A6', '<Attn>', value);             put('D6', 'Document Revision:', label); put('E6', '<Document revision>', value);
  put('A7', '<Address line 1>', value);   put('D7', 'PO#:', label);               put('E7', '<PO#>', value);
  put('A8', '<Address line 2>', value);

  put('A10', 'Product Name:', label);     put('B10', '<Product name goes here>', value);
  put('A11', 'Product Code:', label);     put('B11', '<Product code goes here>', value);
  put('D11', 'Date Received:', label);    put('E11', '<Date Received>', value);
  put('A12', 'Lot Number:', label);       put('B12', '<Lot number goes here>', value);
  put('D12', 'Time Received:', label);    put('E12', '<Time Received>', value);
  put('A13', 'Product Type:', label);     put('B13', '<Product type>', value);
  put('D13', 'Received by:', label);      put('E13', '<Received by>', value);
  put('A14', 'Test Method:', label);      put('B14', '<Test method>', value);
  put('D14', 'Book Reference:', label);   put('E14', '<Book Reference>', value);

  const head = { font: { bold: true, color: ink, size: 10 }, fill: 'FFE8EEF6', border: box };
  const cellB = { font: { color: ink, size: 10 }, border: box };
  put('A16', 'Test', head); put('B16', 'Daily Dose', head); put('C16', 'Specification', head); put('D16', 'Result', head);
  put('A17', '<Analyte>', cellB); put('B17', '<Daily dose>', cellB); put('C17', '<Specification>', cellB);
  put('D17', '<results in>', { ...cellB, font: { bold: true, color: ink, size: 10 } });

  put('A19', 'Report Date:', label);      put('B19', "<today's date>", value);
  put('A20', 'Results relate only to the sample as received.', { font: { italic: true, size: 9, color: soft } });

  const sigHead = { font: { bold: true, color: ink, size: 10 }, border: { bottom: thin } };
  put('A22', 'Prepared by', sigHead);   put('B22', 'Signature', sigHead); put('C22', 'Date', sigHead);
  put('A23', '<Prepared by name>', value); put('C23', '<Prepared date>', value);
  put('A25', 'Authorized by', sigHead); put('B25', 'Signature', sigHead); put('C25', 'Date', sigHead);
  put('A26', '<Authorized by name>', value); put('C26', '<Authorized date>', value);

  [23, 26].forEach(r => { ws.getRow(r).height = 30; });
  return wb.xlsx.writeBuffer();
}

/** Fill a copy of the template for one report. Same path the page uses. */
export async function buildReport(ExcelJS, templateBuf, r, settings) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuf.slice(0));
  fillWorksheet(wb.worksheets[0], r, settings);
  return wb.xlsx.writeBuffer();
}

/** Read a report workbook and extract its values from the first sheet. */
export async function readReport(ExcelJS, buf, filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return null;
  return extractFromGrid(worksheetToGrid(ws), filename);
}
