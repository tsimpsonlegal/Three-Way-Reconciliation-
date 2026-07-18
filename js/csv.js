/* Trust Reconciliation — CSV parsing and column detection.
 * All money is handled as integer cents to avoid floating-point drift. */
(function (global) {
  'use strict';

  /** RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
   *  escaped quotes ("") and CR/LF line endings. Returns array of rows. */
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    // Strip UTF-8 BOM if present
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    // Drop fully-empty trailing rows
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  }

  /** Parse a currency string into integer cents. Returns null when not a number.
   *  Accepts: 1,234.56  $1234.56  (500.00)  -500  1234.5  */
  function parseAmountCents(value) {
    if (value === null || value === undefined) return null;
    var s = String(value).trim();
    if (s === '') return null;
    var negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s]/g, '');
    if (s.charAt(0) === '-') { negative = !negative; s = s.slice(1); }
    if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
    var parts = s.split('.');
    var whole = parseInt(parts[0] || '0', 10);
    var fracStr = (parts[1] || '').slice(0, 2);
    while (fracStr.length < 2) fracStr += '0';
    var cents = whole * 100 + parseInt(fracStr, 10);
    return negative ? -cents : cents;
  }

  /** Format integer cents as a display string, e.g. -123456 -> "-1,234.56" */
  function formatCents(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '';
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(cents);
    var whole = Math.floor(abs / 100).toString();
    var frac = (abs % 100).toString().padStart(2, '0');
    var withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + withCommas + '.' + frac;
  }

  /** Parse common US date formats into 'YYYY-MM-DD'. Returns null on failure.
   *  Accepts: 2026-06-30, 06/30/2026, 6/30/26, 06-30-2026, Jun 30, 2026 */
  function parseDateISO(value) {
    if (value === null || value === undefined) return null;
    var s = String(value).trim();
    if (s === '') return null;
    var m;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoOrNull(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      var year = +m[3];
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      return isoOrNull(year, +m[1], +m[2]);
    }
    var months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) {
      var mon = months[m[1].slice(0, 3).toLowerCase()];
      if (mon) return isoOrNull(+m[3], mon, +m[2]);
    }
    return null;
  }

  function isoOrNull(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    return String(y) + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /** Days between two ISO dates (b - a). */
  function daysBetween(aISO, bISO) {
    var a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
    var b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
    return Math.round((b - a) / 86400000);
  }

  var HEADER_HINTS = {
    date: ['date', 'txn date', 'transaction date', 'posted', 'post date', 'posting date'],
    description: ['description', 'memo', 'memo/description', 'payee', 'name', 'details', 'transaction', 'narrative'],
    amount: ['amount', 'amt', 'transaction amount'],
    moneyIn: ['deposit', 'deposits', 'credit', 'credits', 'money in', 'receipts', 'received', 'increase'],
    moneyOut: ['withdrawal', 'withdrawals', 'debit', 'debits', 'money out', 'disbursement', 'disbursements', 'payment', 'payments', 'checks', 'decrease'],
    checkNo: ['check', 'check #', 'check no', 'check number', 'chk', 'num', 'no.', 'ref', 'reference', 'ref no', 'number'],
    balance: ['balance', 'running balance', 'ledger balance'],
    fileNo: ['file', 'file #', 'file no', 'file number', 'order', 'order #', 'order number', 'matter', 'matter no', 'escrow no', 'escrow number'],
    name: ['name', 'client', 'buyer', 'borrower', 'buyer/borrower', 'parties', 'property', 'property address', 'description']
  };

  /** Guess which column index serves each role, from header names. */
  function guessColumns(headers) {
    var lower = headers.map(function (h) { return String(h).trim().toLowerCase(); });
    function find(hints) {
      // exact match first, then substring
      for (var i = 0; i < lower.length; i++) if (hints.indexOf(lower[i]) !== -1) return i;
      for (var j = 0; j < lower.length; j++) {
        for (var k = 0; k < hints.length; k++) {
          if (lower[j].indexOf(hints[k]) !== -1) return j;
        }
      }
      return -1;
    }
    return {
      date: find(HEADER_HINTS.date),
      description: find(HEADER_HINTS.description),
      amount: find(HEADER_HINTS.amount),
      moneyIn: find(HEADER_HINTS.moneyIn),
      moneyOut: find(HEADER_HINTS.moneyOut),
      checkNo: find(HEADER_HINTS.checkNo),
      balance: find(HEADER_HINTS.balance),
      fileNo: find(HEADER_HINTS.fileNo),
      name: find(HEADER_HINTS.name)
    };
  }

  /** Convert parsed rows to transaction objects using a column mapping.
   *  mapping: {date, description, amount, moneyIn, moneyOut, checkNo} (indices, -1 = unused)
   *  options: {flipSigns: bool}
   *  Returns {transactions: [...], skipped: n, lastBalance: cents|null} */
  function rowsToTransactions(rows, mapping, options) {
    options = options || {};
    var out = [];
    var skipped = 0;
    var lastBalance = null;
    rows.forEach(function (row) {
      var dateISO = mapping.date >= 0 ? parseDateISO(row[mapping.date]) : null;
      var amount = null;
      if (mapping.amount >= 0) {
        amount = parseAmountCents(row[mapping.amount]);
      } else {
        var inc = mapping.moneyIn >= 0 ? parseAmountCents(row[mapping.moneyIn]) : null;
        var dec = mapping.moneyOut >= 0 ? parseAmountCents(row[mapping.moneyOut]) : null;
        if (inc !== null || dec !== null) {
          amount = (inc || 0) - Math.abs(dec || 0);
        }
      }
      if (dateISO === null || amount === null) { skipped++; return; }
      if (options.flipSigns) amount = -amount;
      if (mapping.balance >= 0) {
        var bal = parseAmountCents(row[mapping.balance]);
        if (bal !== null) lastBalance = bal;
      }
      out.push({
        date: dateISO,
        description: mapping.description >= 0 ? String(row[mapping.description] || '').trim() : '',
        amount: amount,
        checkNo: mapping.checkNo >= 0 ? normalizeCheckNo(row[mapping.checkNo]) : ''
      });
    });
    return { transactions: out, skipped: skipped, lastBalance: lastBalance };
  }

  /** Convert parsed rows to client-ledger entries (Qualia trial balance).
   *  mapping: {fileNo, name, balance} */
  function rowsToLedgers(rows, mapping) {
    var out = [];
    var skipped = 0;
    rows.forEach(function (row) {
      var bal = mapping.balance >= 0 ? parseAmountCents(row[mapping.balance]) : null;
      if (bal === null) { skipped++; return; }
      var fileNo = mapping.fileNo >= 0 ? String(row[mapping.fileNo] || '').trim() : '';
      var name = mapping.name >= 0 ? String(row[mapping.name] || '').trim() : '';
      if (fileNo === '' && name === '') { skipped++; return; }
      // Skip obvious total rows
      var label = (fileNo + ' ' + name).toLowerCase();
      if (/\btotals?\b/.test(label)) { skipped++; return; }
      out.push({ fileNo: fileNo, name: name, balance: bal });
    });
    return { ledgers: out, skipped: skipped };
  }

  function normalizeCheckNo(value) {
    if (value === null || value === undefined) return '';
    var s = String(value).trim();
    var m = s.match(/\d+/);
    return m ? String(parseInt(m[0], 10)) : '';
  }

  var api = {
    parseCSV: parseCSV,
    parseAmountCents: parseAmountCents,
    formatCents: formatCents,
    parseDateISO: parseDateISO,
    daysBetween: daysBetween,
    guessColumns: guessColumns,
    rowsToTransactions: rowsToTransactions,
    rowsToLedgers: rowsToLedgers,
    normalizeCheckNo: normalizeCheckNo
  };

  global.TWR = global.TWR || {};
  global.TWR.csv = api;
})(typeof window !== 'undefined' ? window : globalThis);
