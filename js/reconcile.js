/* Trust Reconciliation — matching engine and three-way reconciliation math.
 *
 * Sign convention everywhere: deposits are positive cents, disbursements negative.
 *
 * Three-way test (Georgia Bar Rule 1.15 / standard escrow practice):
 *   1. Adjusted bank balance = statement ending balance
 *                              + deposits in transit (in books, not yet on statement)
 *                              - outstanding disbursements (in books, not yet cleared)
 *   2. Book balance          = trust ledger balance per QuickBooks
 *   3. Client ledger total   = sum of every open file's balance per Qualia
 * All three must be equal to the penny.
 */
(function (global) {
  'use strict';

  var DATE_WINDOW_DAYS = 12;      // max drift for amount+date matching
  var AMOUNT_ONLY_WINDOW = 45;    // max drift when matching on unique amount alone
  var STALE_CHECK_DAYS = 90;      // outstanding items older than this get flagged

  function daysBetween(aISO, bISO) {
    var a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
    var b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
    return Math.round((b - a) / 86400000);
  }

  /** Match bank-statement transactions against book (QuickBooks) transactions.
   *
   *  Pass 1 — same check number and same amount.
   *  Pass 2 — same amount, dates within DATE_WINDOW_DAYS (closest date wins, globally greedy).
   *  Pass 3 — same amount where exactly one candidate remains on each side,
   *           dates within AMOUNT_ONLY_WINDOW (flagged "amount-only").
   *
   *  Returns { matches: [{bank, book, method, dateDiff}], bankOnly: [...], bookOnly: [...] }
   */
  function matchTransactions(bankTxns, bookTxns) {
    var bankFree = bankTxns.map(function (t, i) { return { txn: t, idx: i }; });
    var bookFree = bookTxns.map(function (t, i) { return { txn: t, idx: i }; });
    var matches = [];

    function take(list, entry) {
      var i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    }

    // Pass 1: check number + amount
    bookFree.slice().forEach(function (bk) {
      if (!bk.txn.checkNo) return;
      var hit = null;
      for (var i = 0; i < bankFree.length; i++) {
        var bn = bankFree[i];
        if (bn.txn.checkNo && bn.txn.checkNo === bk.txn.checkNo && bn.txn.amount === bk.txn.amount) { hit = bn; break; }
      }
      if (hit) {
        matches.push({ bank: hit.txn, book: bk.txn, method: 'check-number', dateDiff: Math.abs(daysBetween(bk.txn.date, hit.txn.date)) });
        take(bankFree, hit); take(bookFree, bk);
      }
    });

    // Pass 2: amount + date proximity, globally greedy (closest pairs assigned first)
    var pairs = [];
    bookFree.forEach(function (bk) {
      bankFree.forEach(function (bn) {
        if (bn.txn.amount !== bk.txn.amount) return;
        var diff = Math.abs(daysBetween(bk.txn.date, bn.txn.date));
        if (diff <= DATE_WINDOW_DAYS) pairs.push({ bk: bk, bn: bn, diff: diff });
      });
    });
    pairs.sort(function (a, b) { return a.diff - b.diff || a.bk.idx - b.bk.idx || a.bn.idx - b.bn.idx; });
    pairs.forEach(function (p) {
      if (bankFree.indexOf(p.bn) === -1 || bookFree.indexOf(p.bk) === -1) return;
      matches.push({ bank: p.bn.txn, book: p.bk.txn, method: 'amount+date', dateDiff: p.diff });
      take(bankFree, p.bn); take(bookFree, p.bk);
    });

    // Pass 3: unique amount on both sides, wider window
    var byAmountBank = {}, byAmountBook = {};
    bankFree.forEach(function (bn) { (byAmountBank[bn.txn.amount] = byAmountBank[bn.txn.amount] || []).push(bn); });
    bookFree.forEach(function (bk) { (byAmountBook[bk.txn.amount] = byAmountBook[bk.txn.amount] || []).push(bk); });
    Object.keys(byAmountBook).forEach(function (amt) {
      var bks = byAmountBook[amt], bns = byAmountBank[amt];
      if (!bns || bks.length !== 1 || bns.length !== 1) return;
      var diff = Math.abs(daysBetween(bks[0].txn.date, bns[0].txn.date));
      if (diff > AMOUNT_ONLY_WINDOW) return;
      matches.push({ bank: bns[0].txn, book: bks[0].txn, method: 'amount-only', dateDiff: diff });
      take(bankFree, bns[0]); take(bookFree, bks[0]);
    });

    return {
      matches: matches,
      bankOnly: bankFree.map(function (e) { return e.txn; }),
      bookOnly: bookFree.map(function (e) { return e.txn; })
    };
  }

  /** Perform the full three-way reconciliation.
   *
   *  input = {
   *    statementDate: 'YYYY-MM-DD',
   *    bankEnding:  cents,           // bank statement ending balance
   *    bankTxns:    [txn],           // statement activity for the period
   *    bookEnding:  cents,           // QuickBooks trust ledger ending balance
   *    bookTxns:    [txn],           // book activity for the period
   *    ledgers:     [{fileNo, name, balance}]   // Qualia client-ledger balances
   *  }
   */
  function reconcile(input) {
    var match = matchTransactions(input.bankTxns || [], input.bookTxns || []);

    var outstanding = match.bookOnly.filter(function (t) { return t.amount < 0; });
    var inTransit = match.bookOnly.filter(function (t) { return t.amount >= 0; });

    var outstandingTotal = sum(outstanding);   // negative number
    var inTransitTotal = sum(inTransit);

    var adjustedBank = input.bankEnding + inTransitTotal + outstandingTotal;

    var ledgers = input.ledgers || [];
    var ledgerTotal = ledgers.reduce(function (s, l) { return s + l.balance; }, 0);
    var negativeLedgers = ledgers.filter(function (l) { return l.balance < 0; });

    var diffs = {
      bankVsBook: adjustedBank - input.bookEnding,
      bankVsLedgers: adjustedBank - ledgerTotal,
      bookVsLedgers: input.bookEnding - ledgerTotal
    };
    var balanced = diffs.bankVsBook === 0 && diffs.bankVsLedgers === 0 && diffs.bookVsLedgers === 0;

    var warnings = [];
    if (negativeLedgers.length > 0) {
      warnings.push({
        level: 'error',
        code: 'negative-ledger',
        message: negativeLedgers.length + ' client ledger(s) show a negative balance. A negative client ledger means one client’s funds were used for another matter — investigate immediately (Rule 1.15 violation risk).'
      });
    }
    if (match.bankOnly.length > 0) {
      warnings.push({
        level: 'warn',
        code: 'bank-only',
        message: match.bankOnly.length + ' bank transaction(s) have no matching book entry. Record them in QuickBooks (e.g. wires, bank adjustments) — the books will not tie until they are posted.'
      });
    }
    var stale = input.statementDate ? outstanding.filter(function (t) {
      return daysBetween(t.date, input.statementDate) > STALE_CHECK_DAYS;
    }) : [];
    if (stale.length > 0) {
      warnings.push({
        level: 'warn',
        code: 'stale-checks',
        message: stale.length + ' outstanding disbursement(s) are more than ' + STALE_CHECK_DAYS + ' days old. Follow up with the payee, and consider stop-payment/reissue (unclaimed funds may be subject to Georgia escheatment rules).'
      });
    }
    if (!balanced) {
      warnings.push({
        level: 'error',
        code: 'out-of-balance',
        message: 'The three balances do not agree. Review unmatched items and ledger balances below before signing off.'
      });
    }

    return {
      statementDate: input.statementDate,
      bank: { ending: input.bankEnding, adjusted: adjustedBank },
      book: { ending: input.bookEnding },
      ledger: { total: ledgerTotal, count: ledgers.length, negatives: negativeLedgers },
      outstanding: outstanding,
      outstandingTotal: outstandingTotal,
      inTransit: inTransit,
      inTransitTotal: inTransitTotal,
      bankOnly: match.bankOnly,
      matches: match.matches,
      staleOutstanding: stale,
      diffs: diffs,
      balanced: balanced,
      warnings: warnings
    };
  }

  function sum(txns) {
    return txns.reduce(function (s, t) { return s + t.amount; }, 0);
  }

  global.TWR = global.TWR || {};
  global.TWR.reconcile = {
    matchTransactions: matchTransactions,
    reconcile: reconcile,
    DATE_WINDOW_DAYS: DATE_WINDOW_DAYS,
    STALE_CHECK_DAYS: STALE_CHECK_DAYS
  };
})(typeof window !== 'undefined' ? window : globalThis);
