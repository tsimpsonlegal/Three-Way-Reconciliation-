/* Test suite for the reconciliation engine and CSV utilities.
 * Run with:  node tests/run-tests.mjs  */
import '../js/csv.js';
import '../js/reconcile.js';
import '../js/sample-data.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { csv, reconcile: engine, sample } = globalThis.TWR;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

console.log('— amount parsing —');
eq('plain', csv.parseAmountCents('1234.56'), 123456);
eq('commas and dollar sign', csv.parseAmountCents('$1,234.56'), 123456);
eq('parentheses negative', csv.parseAmountCents('(500.00)'), -50000);
eq('minus sign', csv.parseAmountCents('-425'), -42500);
eq('single decimal digit', csv.parseAmountCents('10.5'), 1050);
eq('junk is null', csv.parseAmountCents('N/A'), null);
eq('empty is null', csv.parseAmountCents(''), null);

console.log('— date parsing —');
eq('iso', csv.parseDateISO('2026-06-30'), '2026-06-30');
eq('us slashes', csv.parseDateISO('06/30/2026'), '2026-06-30');
eq('short year', csv.parseDateISO('6/3/26'), '2026-06-03');
eq('month name', csv.parseDateISO('Jun 30, 2026'), '2026-06-30');
eq('junk is null', csv.parseDateISO('Balance'), null);

console.log('— csv parsing —');
{
  const rows = csv.parseCSV('a,b,c\n"x, y",2,"say ""hi"""\r\n1,2,3\n');
  eq('rows', rows.length, 3);
  eq('quoted comma', rows[1][0], 'x, y');
  eq('escaped quote', rows[1][2], 'say "hi"');
}

console.log('— column guessing —');
{
  const g = csv.guessColumns(['Date', 'Memo/Description', 'Num', 'Amount', 'Balance']);
  eq('date col', g.date, 0);
  eq('desc col', g.description, 1);
  eq('check col', g.checkNo, 2);
  eq('amount col', g.amount, 3);
  eq('balance col', g.balance, 4);
}

console.log('— matching engine —');
{
  const bank = [
    { date: '2026-06-09', description: 'Check 1105', amount: -215000, checkNo: '1105' },
    { date: '2026-06-03', description: 'wire', amount: 1500000, checkNo: '' },
    { date: '2026-06-15', description: 'service fee', amount: -1500, checkNo: '' }
  ];
  const book = [
    { date: '2026-06-05', description: 'title premium', amount: -215000, checkNo: '1105' },
    { date: '2026-06-03', description: 'Lee earnest money', amount: 1500000, checkNo: '' },
    { date: '2026-06-28', description: 'recording fees', amount: -42500, checkNo: '1108' }
  ];
  const m = engine.matchTransactions(bank, book);
  eq('two matches', m.matches.length, 2);
  eq('check-number match method', m.matches[0].method, 'check-number');
  eq('bank-only fee', m.bankOnly.map(t => t.amount), [-1500]);
  eq('book-only outstanding check', m.bookOnly.map(t => t.checkNo), ['1108']);
}
{
  // Two same-amount checks — nearest dates must pair up.
  const bank = [
    { date: '2026-06-20', description: '', amount: -10000, checkNo: '' },
    { date: '2026-06-05', description: '', amount: -10000, checkNo: '' }
  ];
  const book = [
    { date: '2026-06-04', description: 'a', amount: -10000, checkNo: '' },
    { date: '2026-06-19', description: 'b', amount: -10000, checkNo: '' }
  ];
  const m = engine.matchTransactions(bank, book);
  eq('both matched', m.matches.length, 2);
  const pairA = m.matches.find(x => x.book.description === 'a');
  eq('nearest-date pairing', pairA.bank.date, '2026-06-05');
}

console.log('— three-way reconciliation on sample data —');
{
  const r = engine.reconcile({
    statementDate: sample.statementDate,
    bankEnding: sample.bank.ending,
    bankTxns: sample.bank.txns,
    bookEnding: sample.book.ending,
    bookTxns: sample.book.txns,
    ledgers: sample.ledgers
  });
  eq('outstanding count', r.outstanding.length, 2);
  eq('outstanding total', r.outstandingTotal, -174350);
  eq('in-transit count', r.inTransit.length, 1);
  eq('in-transit total', r.inTransitTotal, 500000);
  eq('adjusted bank', r.bank.adjusted, 14824650);
  eq('ledger total', r.ledger.total, 14824650);
  check('balanced', r.balanced === true, JSON.stringify(r.diffs));
  eq('no bank-only items', r.bankOnly.length, 0);
  eq('no negative ledgers', r.ledger.negatives.length, 0);
}

console.log('— out-of-balance and warning scenarios —');
{
  const r = engine.reconcile({
    statementDate: '2026-06-30',
    bankEnding: 100000,
    bankTxns: [],
    bookEnding: 90000,
    bookTxns: [],
    ledgers: [
      { fileNo: '1', name: 'A', balance: 100000 },
      { fileNo: '2', name: 'B', balance: -10000 }
    ]
  });
  check('not balanced', r.balanced === false);
  check('negative ledger flagged', r.warnings.some(w => w.code === 'negative-ledger'));
  check('out-of-balance flagged', r.warnings.some(w => w.code === 'out-of-balance'));
  eq('bank vs book diff', r.diffs.bankVsBook, 10000);
}
{
  // Stale outstanding check (> 90 days old at statement date)
  const r = engine.reconcile({
    statementDate: '2026-06-30',
    bankEnding: 50000,
    bankTxns: [],
    bookEnding: 0,
    bookTxns: [{ date: '2026-01-15', description: 'old check', amount: -50000, checkNo: '900' }],
    ledgers: [{ fileNo: '1', name: 'A', balance: 0 }]
  });
  check('stale check flagged', r.warnings.some(w => w.code === 'stale-checks'));
  check('stale scenario still balances', r.balanced === true);
}

console.log('— importing the sample CSV files end-to-end —');
{
  const text = readFileSync(join(root, 'sample-data', 'bank-statement-june-2026.csv'), 'utf8');
  const rows = csv.parseCSV(text);
  const mapping = { ...{ date: -1, description: -1, amount: -1, moneyIn: -1, moneyOut: -1, checkNo: -1, balance: -1 }, ...csv.guessColumns(rows[0]) };
  const res = csv.rowsToTransactions(rows.slice(1), mapping, {});
  eq('bank csv txn count', res.transactions.length, 6);
  eq('bank csv net', res.transactions.reduce((s, t) => s + t.amount, 0), 3843450);
  eq('bank csv last balance', res.lastBalance, 14499000);
}
{
  const text = readFileSync(join(root, 'sample-data', 'quickbooks-trust-ledger-june-2026.csv'), 'utf8');
  const rows = csv.parseCSV(text);
  const mapping = { ...{ date: -1, description: -1, amount: -1, moneyIn: -1, moneyOut: -1, checkNo: -1, balance: -1 }, ...csv.guessColumns(rows[0]) };
  const res = csv.rowsToTransactions(rows.slice(1), mapping, {});
  eq('qb csv txn count', res.transactions.length, 9);
  eq('qb csv last balance', res.lastBalance, 14824650);
  eq('qb check numbers found', res.transactions.filter(t => t.checkNo).length, 5);
}
{
  const text = readFileSync(join(root, 'sample-data', 'qualia-trial-balance-june-2026.csv'), 'utf8');
  const rows = csv.parseCSV(text);
  const mapping = { ...{ fileNo: -1, name: -1, balance: -1 }, ...csv.guessColumns(rows[0]) };
  const res = csv.rowsToLedgers(rows.slice(1), mapping);
  eq('qualia ledger count (totals row skipped)', res.ledgers.length, 4);
  eq('qualia total', res.ledgers.reduce((s, l) => s + l.balance, 0), 14824650);
}
{
  // Full pipeline: CSVs in → reconciled out
  const read = f => csv.parseCSV(readFileSync(join(root, 'sample-data', f), 'utf8'));
  const base = { date: -1, description: -1, amount: -1, moneyIn: -1, moneyOut: -1, checkNo: -1, balance: -1, fileNo: -1, name: -1 };
  const bankRows = read('bank-statement-june-2026.csv');
  const bank = csv.rowsToTransactions(bankRows.slice(1), { ...base, ...csv.guessColumns(bankRows[0]) }, {});
  const bookRows = read('quickbooks-trust-ledger-june-2026.csv');
  const book = csv.rowsToTransactions(bookRows.slice(1), { ...base, ...csv.guessColumns(bookRows[0]) }, {});
  const qRows = read('qualia-trial-balance-june-2026.csv');
  const ledgers = csv.rowsToLedgers(qRows.slice(1), { ...base, ...csv.guessColumns(qRows[0]) }).ledgers;
  const r = engine.reconcile({
    statementDate: '2026-06-30',
    bankEnding: bank.lastBalance,
    bankTxns: bank.transactions,
    bookEnding: book.lastBalance,
    bookTxns: book.transactions,
    ledgers
  });
  check('sample CSVs reconcile to the penny', r.balanced === true, JSON.stringify(r.diffs));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
