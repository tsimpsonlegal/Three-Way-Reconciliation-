/* Trust Reconciliation — built-in sample data (June 2026, fictional).
 * Embedded here (rather than fetched from sample-data/*.csv) so the
 * "Load sample data" button works when index.html is opened directly
 * from disk. The CSV files in sample-data/ mirror this data for
 * practicing the import workflow. */
(function (global) {
  'use strict';

  global.TWR = global.TWR || {};
  global.TWR.sample = {
    accountName: 'IOLTA Real Estate Trust — Example Bank ...4321 (SAMPLE DATA)',
    statementDate: '2026-06-30',
    bank: {
      ending: 14499000, // $144,990.00
      txns: [
        { date: '2026-06-03', description: 'Incoming wire — Lee earnest money', amount: 1500000, checkNo: '' },
        { date: '2026-06-09', description: 'Check 1105', amount: -215000, checkNo: '1105' },
        { date: '2026-06-10', description: 'Incoming wire — Davis refinance funds', amount: 3174650, checkNo: '' },
        { date: '2026-06-16', description: 'Check 1106', amount: -3891200, checkNo: '1106' },
        { date: '2026-06-19', description: 'Check 1107', amount: -1125000, checkNo: '1107' },
        { date: '2026-06-20', description: 'Incoming wire — Brown closing funds', amount: 4400000, checkNo: '' }
      ]
    },
    book: {
      ending: 14824650, // $148,246.50
      txns: [
        { date: '2026-06-03', description: 'Deposit — Lee earnest money (24-0110)', amount: 1500000, checkNo: '' },
        { date: '2026-06-05', description: 'Hartwell Title — owner policy premium (Thompson)', amount: -215000, checkNo: '1105' },
        { date: '2026-06-10', description: 'Deposit — Davis refinance funds (24-0102)', amount: 3174650, checkNo: '' },
        { date: '2026-06-12', description: 'Seller proceeds — Thompson closing', amount: -3891200, checkNo: '1106' },
        { date: '2026-06-15', description: 'Broker commission — Thompson closing', amount: -1125000, checkNo: '1107' },
        { date: '2026-06-20', description: 'Deposit — Brown closing funds (24-0115)', amount: 4400000, checkNo: '' },
        { date: '2026-06-28', description: 'Fulton County Clerk — recording fees', amount: -42500, checkNo: '1108' },
        { date: '2026-06-29', description: 'Refund of payoff overage — Thompson', amount: -131850, checkNo: '1109' },
        { date: '2026-06-30', description: 'Deposit — Brown earnest money wire', amount: 500000, checkNo: '' }
      ]
    },
    ledgers: [
      { fileNo: '24-0091', name: 'Smith to Jones — 123 Peachtree St NE', balance: 5250000 },
      { fileNo: '24-0102', name: 'Davis refinance — 45 Magnolia Way', balance: 3174650 },
      { fileNo: '24-0110', name: 'Lee purchase — 780 Cascade Rd SW', balance: 1500000 },
      { fileNo: '24-0115', name: 'Brown closing — 12 Highland Ave', balance: 4900000 }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
