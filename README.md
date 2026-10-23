# Lab Report Pipeline

Two small browser tools for an analytical lab's reporting step, combined on one page:

- **Build reports** turns two pasted tables, a sample receiving log and a results sheet, into one
  Report of Analysis workbook (.xlsx) per sample, plus a CSV batch record.
- **Extract from signed reports** reads a folder of finished reports and pulls out Product Code,
  Lot Number, Product Type, the signed date and the ng/day result into a single spreadsheet.

The page runs entirely in the browser; no data leaves the machine. All names, codes, lots and
results in the demo are fictional.

## Build reports

1. **Template.** A generic Report of Analysis template is generated at runtime. You can add your own
   .xlsx templates to a library kept in the browser (IndexedDB). Fillable cells are marked with
   placeholders such as `<Product code goes here>`; download the built-in template to see them all.
   The file name pattern accepts `{ref} {code} {lot} {type} {name} {date}`.
2. **Method and recipient.** Analyte, test method, document revision, PO#, client and address apply
   to the whole batch and are remembered between sessions.
3. **Paste data.** Columns are found by header name, so column order does not matter and extra
   columns are ignored. The results paste may hold several blocks (an ng/day block and a PPM block).
   Matching rules:
   - samples are matched to result rows on lot number and product code;
   - several result rows for one sample are replicates and are averaged;
   - when several samples share a lot, rows are split by word similarity between the sample type
     and the result status (for example "Vial" and "Blister"); ties are flagged for a manual check;
   - raw materials (type `RM`) report in PPM with no limit; everything else reports ng/day and is
     flagged when at or above the limit;
   - optionally, unmatched samples can be paired across a lot-number disagreement on code and
     status; the discrepancy is tagged and written to the batch record.

   Results are rounded half-up on the decimal value, so 22.95 becomes 23.0 rather than the 22.9
   that `toFixed` gives.
4. **Review.** Every field stays editable. Download all reports, or only the selected rows, as a
   .zip with the CSV batch record.

## Extract from signed reports

Drop .xlsx files, or a .zip of them. In each first sheet the tool looks for the cells labelled
`Product Code:`, `Lot Number:` and `Product Type:` and takes the first usable value to their right;
the result is the first number to the right of a cell mentioning ng/day. The signed date comes from
the signature block: a row with `Signature` or a "... by" role next to a bare `Date` label, read
from the cell below. A `Date Received:` label in the header is ignored. An explicit `Date Signed`
label wins; otherwise an authorizing signature beats prepared-by. Hover a date to see the signer
and the prepared-by date. Results export to .xlsx.

## The round trip

Click **Load demo batch**, then **Download all as .zip**. Switch to the Extract tab and drop the
.zip (or the unzipped files), or click **Use the reports built in this session**. The demo leaves
"Pre-sign the reports" on, which fills the signature block (prepared on the report date,
authorized the day after) so the extractor has dates to find. You get back the codes, lots, types
and ng/day results you built, with the authorized date as the signed date. Raw-material reports
come back without a result because the extractor reads ng/day only.

`test/roundtrip.test.js` does the same thing in Node: it builds every demo report with the same
functions the page uses, writes real .xlsx bytes, reads them back and checks each value.

## Running it

The page uses ES modules, so serve the folder rather than opening the file directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

ExcelJS 4.4.0 and JSZip 3.10.1 load from cdnjs.

## Code layout

- `src/pipeline.js`: all logic, with no DOM or spreadsheet library: TSV parsing, column picking,
  sample and result reading, matching, rounding, spec flags, file names, the CSV record, template
  filling, date parsing, signature-block resolution and extraction from a plain cell grid.
- `src/template.js`: the generated template and the build/read helpers, given ExcelJS as a parameter.
- `src/app.js`: page wiring. `src/demo.js`: the fictional batch.

## Tests

```sh
npm install   # dev dependency: exceljs, used only by the round-trip test
npm test
```

Requires Node 22 or later. CI runs the suite on Node 22 and 24.

## License

MIT
