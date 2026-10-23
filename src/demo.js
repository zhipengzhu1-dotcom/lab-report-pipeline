// Fictional demo batch. Every name, code, lot, reference and number here is invented.

export const DEMO_SETTINGS = {
  analyte: 'Nitrosamine Impurity A',
  method: 'EX-TM-0042',
  docrev: 'N/A',
  po: 'PO-0000',
  client: 'Lorem Ipsum Pharma',
  attn: 'Attn. Dolor Sit',
  addr1: '100 Lorem Ipsum Ave.',
  addr2: 'Consectetur, ST 00000',
  preparedBy: 'A. Analyst',
  authorizedBy: 'B. Reviewer'
};

const T = '\t';
const row = (...c) => c.join(T);

export const DEMO_SAMPLES = [
  row('Rec. DATE', 'Rec. Time', 'Product Code', 'PRODUCT NAME', 'TYPE', 'LOT#', 'CLIENT', 'EXP DATE', 'QTY RECD', 'SENT BY', 'RECD BY', 'LAB REF', 'REPORT DATE', 'BOOK REF#'),
  row('10/14/26', '9:10 AM', 'PC-1001', 'Lorem Tablets 10 mg', 'Initial-FP', 'LOT-0001', 'LIP', 'TBD', '1 Pouch', 'DS', 'AA', 'EX-0001', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'PC-1001', 'Lorem Tablets 10 mg', 'Blend', 'LOT-0002', 'LIP', 'TBD', '1 Pouch', 'DS', 'AA', 'EX-0002', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'PC-1001', 'Lorem Tablets 10 mg', 'Blend', 'LOT-0003', 'LIP', 'TBD', '1 Pouch', 'DS', 'AA', 'EX-0003', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'PC-1002', 'Ipsum Capsules 25 mg', 'Vial', 'LOT-0004', 'LIP', 'TBD', '2 Vials', 'DS', 'AA', 'EX-0004', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'PC-1002', 'Ipsum Capsules 25 mg', 'Blister', 'LOT-0004', 'LIP', 'TBD', '1 Card', 'DS', 'AA', 'EX-0005', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'RM-2001', 'Dolor API', 'RM', 'LOT-0101', 'LIP', 'TBD', '1 Pouch', 'DS', 'AA', 'EX-0006', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'RM-2001', 'Dolor API', 'RM', 'LOT-0102', 'LIP', 'TBD', '1 Pouch', 'DS', 'AA', 'EX-0007', '10/17/2026', 'BK-014/22-25'),
  row('10/14/26', '9:10 AM', 'RM-2001', 'Dolor API', 'RM', 'LOT-0103', 'LIP', 'TBD', '1 Pouch', 'DS', 'AA', 'EX-0008', '10/17/2026', 'BK-014/22-25')
].join('\n');

const NG_HEAD = row('#', 'Code', 'Name', 'Status', 'Lot#', 'Wt Taken (mg)', 'Average Wt (mg)', 'Conc. (mg/mL)', 'Recovery (ng/mL)', 'Daily dose Unit', 'Daily amount (mg/day)', 'Impurity A (ng/day)');
const PPM_HEAD = row('#', 'Code', 'Name', 'Status', 'Lot#', 'Wt Taken (mg)', 'Conc. (mg/mL)', 'Recovery (ng/mL)', 'PPM');

// LOT-0001 has two replicates; LOT-0004 is shared by two samples and split by status;
// LOT-0103 was keyed as LOT-0130 on the results sheet (a lot mismatch to resolve).
export const DEMO_RESULTS = [
  NG_HEAD,
  row('1', 'PC-1001', 'Lorem Tablets 10 mg', 'FP-1', 'LOT-0001', '1102.40', '220.48', '5.010', '0.6012', '8', '80', '24.1'),
  row('2', 'PC-1001', 'Lorem Tablets 10 mg', 'FP-2', 'LOT-0001', '1098.75', '220.48', '4.994', '0.5687', '8', '80', '22.8'),
  row('3', 'PC-1001', 'Lorem Tablets 10 mg', 'Blend', 'LOT-0002', '2210.06', '221.00', '5.022', '0.7075', '8', '80', '28.3'),
  row('4', 'PC-1001', 'Lorem Tablets 10 mg', 'Blend', 'LOT-0003', '2204.91', '221.00', '5.011', '0.6350', '8', '80', '25.4'),
  row('5', 'PC-1002', 'Ipsum Capsules 25 mg', 'Vial', 'LOT-0004', '515.20', '257.60', '5.152', '0.3150', '4', '100', '12.6'),
  row('6', 'PC-1002', 'Ipsum Capsules 25 mg', 'Blister', 'LOT-0004', '512.88', '257.60', '5.128', '0.3550', '4', '100', '14.2'),
  '',
  PPM_HEAD,
  row('1', 'RM-2001', 'Dolor API', 'RM', 'LOT-0101', '502.18', '5.022', '0.4138', '0.0412'),
  row('2', 'RM-2001', 'Dolor API', 'RM', 'LOT-0102', '503.40', '5.034', '0.5905', '0.0587'),
  row('3', 'RM-2001', 'Dolor API', 'RM', 'LOT-0130', '501.77', '5.018', '0.3628', '0.0362')
].join('\n');
