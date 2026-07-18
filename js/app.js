/* Trust Reconciliation — UI wiring, state, and report rendering. */
(function () {
  'use strict';

  var csv = TWR.csv;
  var engine = TWR.reconcile;
  var STORAGE_KEY = 'twr-state-v1';

  /* ---------------- state ---------------- */

  function emptyState() {
    return {
      accountName: '',
      statementDate: '',
      bank: { ending: null, txns: [] },
      book: { ending: null, txns: [] },
      ledgers: []
    };
  }

  var state = loadState();

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.bank && s.book && s.ledgers) return s;
      }
    } catch (e) { /* corrupted storage — start fresh */ }
    return emptyState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function changed() {
    saveState();
    renderAll();
  }

  /* ---------------- helpers ---------------- */

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function money(cents) { return csv.formatCents(cents); }

  function sortTxns(txns) {
    return txns.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  /* ---------------- tabs ---------------- */

  $all('nav.tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $all('nav.tabs button').forEach(function (b) { b.classList.remove('active'); });
      $all('section.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      $('#panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  /* ---------------- toolbar ---------------- */

  $('#account-name').addEventListener('input', function (e) {
    state.accountName = e.target.value; saveState(); renderReconcile(); renderReport();
  });
  $('#statement-date').addEventListener('change', function (e) {
    state.statementDate = e.target.value; changed();
  });

  $('#btn-load-sample').addEventListener('click', function () {
    if (hasData() && !confirm('Replace everything currently entered with the built-in sample data?')) return;
    state = JSON.parse(JSON.stringify(TWR.sample));
    changed();
  });

  $('#btn-clear').addEventListener('click', function () {
    if (!confirm('Clear all data for this reconciliation? (Save a session file first if you want to keep it.)')) return;
    state = emptyState();
    changed();
  });

  $('#btn-save-session').addEventListener('click', function () {
    var name = 'trust-reconciliation-' + (state.statementDate || 'draft') + '.json';
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  });

  $('#btn-load-session').addEventListener('click', function () { $('#session-file-input').click(); });
  $('#session-file-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = JSON.parse(reader.result);
        if (!s || !s.bank || !s.book || !s.ledgers) throw new Error('bad shape');
        state = s;
        changed();
      } catch (err) {
        alert('That file is not a saved reconciliation session.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  function hasData() {
    return state.bank.txns.length || state.book.txns.length || state.ledgers.length ||
      state.bank.ending !== null || state.book.ending !== null;
  }

  /* ---------------- balance inputs ---------------- */

  function wireMoneyInput(inputSel, get, set) {
    var input = $(inputSel);
    input.addEventListener('change', function () {
      var cents = csv.parseAmountCents(input.value);
      set(cents);
      input.value = cents === null ? '' : money(cents);
      saveState(); renderReconcile(); renderReport();
    });
    input.value = get() === null ? '' : money(get());
  }

  /* ---------------- CSV import ---------------- */

  var pendingImport = null; // {source, headers, rows, hasHeader}

  $all('.csv-input').forEach(function (input) {
    input.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var source = input.dataset.source;
      var reader = new FileReader();
      reader.onload = function () {
        var rows = csv.parseCSV(String(reader.result));
        if (rows.length === 0) { alert('That file appears to be empty.'); return; }
        pendingImport = { source: source, allRows: rows, fileName: file.name };
        renderMappingPanel(source);
        e.target.value = '';
      };
      reader.readAsText(file);
    });
  });

  var ROLE_DEFS = {
    bank: [
      { key: 'date', label: 'Date', required: true },
      { key: 'description', label: 'Description', required: false },
      { key: 'amount', label: 'Amount (signed)', required: false },
      { key: 'moneyIn', label: 'Deposits / money in', required: false },
      { key: 'moneyOut', label: 'Withdrawals / money out', required: false },
      { key: 'checkNo', label: 'Check number', required: false }
    ],
    book: [
      { key: 'date', label: 'Date', required: true },
      { key: 'description', label: 'Description / memo', required: false },
      { key: 'amount', label: 'Amount (signed)', required: false },
      { key: 'moneyIn', label: 'Deposits / money in', required: false },
      { key: 'moneyOut', label: 'Payments / money out', required: false },
      { key: 'checkNo', label: 'Check number', required: false },
      { key: 'balance', label: 'Running balance', required: false }
    ],
    qualia: [
      { key: 'fileNo', label: 'File / order number', required: false },
      { key: 'name', label: 'Client / property', required: false },
      { key: 'balance', label: 'Ledger balance', required: true }
    ]
  };

  function renderMappingPanel(source) {
    var panel = $('#import-' + source + ' .mapping-panel');
    panel.hidden = false;
    panel.innerHTML = '';
    var p = pendingImport;

    var hasHeader = true;
    var headers = headerNames();

    function headerNames() {
      if (hasHeader) return p.allRows[0].map(function (h, i) { return String(h).trim() || ('Column ' + (i + 1)); });
      return p.allRows[0].map(function (_, i) { return 'Column ' + (i + 1); });
    }
    function dataRows() { return hasHeader ? p.allRows.slice(1) : p.allRows; }

    var guessed = csv.guessColumns(hasHeader ? p.allRows[0] : []);
    var roles = ROLE_DEFS[source];

    panel.appendChild(el('p', { text: 'File: ' + p.fileName + ' — ' + dataRows().length + ' data row(s). Match each field to a column, check the preview, then import.', style: 'font-size:13px;color:var(--muted);margin:0 0 10px' }));

    var headerToggle = el('label', { style: 'font-size:13px;display:block;margin-bottom:10px' }, [
      el('input', {
        type: 'checkbox', checked: '', onchange: function (e) {
          hasHeader = e.target.checked;
          headers = headerNames();
          guessed = hasHeader ? csv.guessColumns(p.allRows[0]) : {};
          rebuildSelects(); renderPreview();
        }
      }),
      el('span', { text: ' First row is a header row' })
    ]);
    panel.appendChild(headerToggle);

    var grid = el('div', { 'class': 'mapping-grid' });
    panel.appendChild(grid);
    var selects = {};

    function rebuildSelects() {
      grid.innerHTML = '';
      selects = {};
      roles.forEach(function (role) {
        var sel = el('select', { onchange: renderPreview });
        sel.appendChild(el('option', { value: '-1', text: '— not used —' }));
        headers.forEach(function (h, i) {
          sel.appendChild(el('option', { value: String(i), text: h }));
        });
        var g = guessed[role.key];
        if (g !== undefined && g !== -1) sel.value = String(g);
        selects[role.key] = sel;
        grid.appendChild(el('div', { 'class': 'field' }, [
          el('label', { text: role.label + (role.required ? ' *' : '') }),
          sel
        ]));
      });
    }
    rebuildSelects();

    var flipWrap = null;
    if (source !== 'qualia') {
      flipWrap = el('label', { style: 'font-size:13px;display:block;margin-bottom:10px' }, [
        el('input', { type: 'checkbox', onchange: renderPreview }),
        el('span', { text: ' Flip signs (use if deposits come in negative)' })
      ]);
      panel.appendChild(flipWrap);
    }

    var previewWrap = el('div', { 'class': 'preview-table-wrap' });
    panel.appendChild(previewWrap);
    var summaryLine = el('p', { style: 'font-size:13px;color:var(--muted)' });
    panel.appendChild(summaryLine);

    function mapping() {
      var m = {};
      roles.forEach(function (r) { m[r.key] = parseInt(selects[r.key].value, 10); });
      ['date', 'description', 'amount', 'moneyIn', 'moneyOut', 'checkNo', 'balance', 'fileNo', 'name'].forEach(function (k) {
        if (!(k in m)) m[k] = -1;
      });
      return m;
    }
    function flip() { return flipWrap ? flipWrap.querySelector('input').checked : false; }

    function convert() {
      if (source === 'qualia') return csv.rowsToLedgers(dataRows(), mapping());
      return csv.rowsToTransactions(dataRows(), mapping(), { flipSigns: flip() });
    }

    function renderPreview() {
      var result = convert();
      previewWrap.innerHTML = '';
      var table = el('table', { 'class': 'data' });
      if (source === 'qualia') {
        table.appendChild(el('tr', {}, [el('th', { text: 'File #' }), el('th', { text: 'Client / property' }), el('th', { text: 'Balance', 'class': 'num' })]));
        result.ledgers.slice(0, 6).forEach(function (l) {
          table.appendChild(el('tr', {}, [
            el('td', { text: l.fileNo }), el('td', { text: l.name }),
            el('td', { text: money(l.balance), 'class': 'num' + (l.balance < 0 ? ' neg' : '') })
          ]));
        });
        var total = result.ledgers.reduce(function (s, l) { return s + l.balance; }, 0);
        summaryLine.textContent = result.ledgers.length + ' ledger(s), total ' + money(total) +
          (result.skipped ? ' — ' + result.skipped + ' row(s) skipped (no balance or a totals row)' : '');
      } else {
        table.appendChild(el('tr', {}, [el('th', { text: 'Date' }), el('th', { text: 'Description' }), el('th', { text: 'Check #' }), el('th', { text: 'Amount', 'class': 'num' })]));
        result.transactions.slice(0, 6).forEach(function (t) {
          table.appendChild(el('tr', {}, [
            el('td', { text: t.date }), el('td', { text: t.description }), el('td', { text: t.checkNo }),
            el('td', { text: money(t.amount), 'class': 'num' + (t.amount < 0 ? ' neg' : '') })
          ]));
        });
        var net = result.transactions.reduce(function (s, t) { return s + t.amount; }, 0);
        summaryLine.textContent = result.transactions.length + ' transaction(s), net ' + money(net) +
          (result.skipped ? ' — ' + result.skipped + ' row(s) skipped (unreadable date or amount)' : '');
      }
      previewWrap.appendChild(table);
    }
    renderPreview();

    var btnRow = el('div', { 'class': 'row', style: 'margin-top:6px' });
    btnRow.appendChild(el('button', {
      'class': 'btn', text: 'Import',
      onclick: function () {
        var result = convert();
        if (source === 'qualia') {
          if (result.ledgers.length === 0) { alert('No ledgers could be read — check the column mapping.'); return; }
          if (state.ledgers.length && !confirm('Replace the ' + state.ledgers.length + ' ledger(s) already entered?')) return;
          state.ledgers = result.ledgers;
        } else {
          if (result.transactions.length === 0) { alert('No transactions could be read — check the column mapping.'); return; }
          if (state[source].txns.length && !confirm('Replace the ' + state[source].txns.length + ' transaction(s) already entered?')) return;
          state[source].txns = result.transactions;
          if (source === 'book' && result.lastBalance !== null && state.book.ending === null) {
            state.book.ending = result.lastBalance;
          }
        }
        pendingImport = null;
        panel.hidden = true;
        changed();
      }
    }));
    btnRow.appendChild(el('button', {
      'class': 'btn secondary', text: 'Cancel',
      onclick: function () { pendingImport = null; panel.hidden = true; }
    }));
    panel.appendChild(btnRow);
  }

  /* ---------------- transaction tables ---------------- */

  function renderTxnTable(containerId, txns, onDelete) {
    var wrap = $(containerId);
    wrap.innerHTML = '';
    if (txns.length === 0) {
      wrap.appendChild(el('p', { text: 'No transactions yet.', style: 'color:var(--muted);font-size:13px' }));
      return;
    }
    var table = el('table', { 'class': 'data' });
    table.appendChild(el('tr', {}, [
      el('th', { text: 'Date' }), el('th', { text: 'Description' }), el('th', { text: 'Check #' }),
      el('th', { text: 'Amount', 'class': 'num' }), el('th', { text: '' })
    ]));
    var sorted = sortTxns(txns);
    sorted.forEach(function (t) {
      table.appendChild(el('tr', {}, [
        el('td', { text: t.date }), el('td', { text: t.description }), el('td', { text: t.checkNo || '' }),
        el('td', { text: money(t.amount), 'class': 'num' + (t.amount < 0 ? ' neg' : '') }),
        el('td', {}, [el('button', { 'class': 'del', title: 'Delete', text: '✕', onclick: function () { onDelete(t); } })])
      ]));
    });
    var net = txns.reduce(function (s, t) { return s + t.amount; }, 0);
    table.appendChild(el('tr', { 'class': 'total-row' }, [
      el('td', { text: 'Net activity' }), el('td', {}), el('td', {}),
      el('td', { text: money(net), 'class': 'num' }), el('td', {})
    ]));
    wrap.appendChild(table);
  }

  function addTxnDialog(list) {
    var date = prompt('Date (MM/DD/YYYY):', '');
    if (date === null) return;
    var dateISO = csv.parseDateISO(date);
    if (!dateISO) { alert('Could not read that date.'); return; }
    var desc = prompt('Description:', '') || '';
    var checkNo = csv.normalizeCheckNo(prompt('Check number (leave blank if none):', '') || '');
    var amtStr = prompt('Amount in dollars (negative for checks/withdrawals, e.g. -425.00):', '');
    if (amtStr === null) return;
    var amount = csv.parseAmountCents(amtStr);
    if (amount === null) { alert('Could not read that amount.'); return; }
    list.push({ date: dateISO, description: desc.trim(), amount: amount, checkNo: checkNo });
    changed();
  }

  $('#btn-add-bank').addEventListener('click', function () { addTxnDialog(state.bank.txns); });
  $('#btn-add-book').addEventListener('click', function () { addTxnDialog(state.book.txns); });
  $('#btn-add-ledger').addEventListener('click', function () {
    var fileNo = prompt('File / order number:', '');
    if (fileNo === null) return;
    var name = prompt('Client / property description:', '') || '';
    var balStr = prompt('Ledger balance in dollars:', '');
    if (balStr === null) return;
    var bal = csv.parseAmountCents(balStr);
    if (bal === null) { alert('Could not read that amount.'); return; }
    state.ledgers.push({ fileNo: fileNo.trim(), name: name.trim(), balance: bal });
    changed();
  });

  function renderLedgerTable() {
    var wrap = $('#qualia-table');
    wrap.innerHTML = '';
    if (state.ledgers.length === 0) {
      wrap.appendChild(el('p', { text: 'No client ledgers yet.', style: 'color:var(--muted);font-size:13px' }));
      return;
    }
    var table = el('table', { 'class': 'data' });
    table.appendChild(el('tr', {}, [
      el('th', { text: 'File #' }), el('th', { text: 'Client / property' }),
      el('th', { text: 'Balance', 'class': 'num' }), el('th', { text: '' })
    ]));
    state.ledgers.forEach(function (l) {
      table.appendChild(el('tr', {}, [
        el('td', { text: l.fileNo }), el('td', { text: l.name }),
        el('td', { text: money(l.balance), 'class': 'num' + (l.balance < 0 ? ' neg' : '') }),
        el('td', {}, [el('button', {
          'class': 'del', title: 'Delete', text: '✕',
          onclick: function () { state.ledgers.splice(state.ledgers.indexOf(l), 1); changed(); }
        })])
      ]));
    });
    var total = state.ledgers.reduce(function (s, l) { return s + l.balance; }, 0);
    table.appendChild(el('tr', { 'class': 'total-row' }, [
      el('td', { text: 'Total of all client ledgers' }), el('td', {}),
      el('td', { text: money(total), 'class': 'num' }), el('td', {})
    ]));
    wrap.appendChild(table);
  }

  /* ---------------- reconciliation ---------------- */

  function runReconciliation() {
    return engine.reconcile({
      statementDate: state.statementDate || null,
      bankEnding: state.bank.ending || 0,
      bankTxns: state.bank.txns,
      bookEnding: state.book.ending || 0,
      bookTxns: state.book.txns,
      ledgers: state.ledgers
    });
  }

  function threeWayTable(r, cls) {
    var table = el('table', { 'class': 'data report-3way ' + (cls || '') });
    function row(label, cents, bold) {
      var tr = el('tr', bold ? { 'class': 'total-row' } : {}, [
        el('td', { text: label }),
        el('td', { text: money(cents), 'class': 'num' + (cents < 0 ? ' neg' : '') })
      ]);
      table.appendChild(tr);
    }
    row('Bank statement ending balance', r.bank.ending);
    row('Add: deposits in transit (' + r.inTransit.length + ')', r.inTransitTotal);
    row('Less: outstanding disbursements (' + r.outstanding.length + ')', r.outstandingTotal);
    row('ADJUSTED BANK BALANCE', r.bank.adjusted, true);
    row('BOOK BALANCE (QuickBooks trust ledger)', r.book.ending, true);
    row('CLIENT LEDGER TOTAL (Qualia, ' + r.ledger.count + ' files)', r.ledger.total, true);
    return table;
  }

  function itemTable(txns, emptyText) {
    if (txns.length === 0) return el('p', { text: emptyText, style: 'color:var(--muted);font-size:13px' });
    var table = el('table', { 'class': 'data' });
    table.appendChild(el('tr', {}, [
      el('th', { text: 'Date' }), el('th', { text: 'Description' }), el('th', { text: 'Check #' }), el('th', { text: 'Amount', 'class': 'num' })
    ]));
    sortTxns(txns).forEach(function (t) {
      table.appendChild(el('tr', {}, [
        el('td', { text: t.date }), el('td', { text: t.description }), el('td', { text: t.checkNo || '' }),
        el('td', { text: money(t.amount), 'class': 'num' + (t.amount < 0 ? ' neg' : '') })
      ]));
    });
    var total = txns.reduce(function (s, t) { return s + t.amount; }, 0);
    table.appendChild(el('tr', { 'class': 'total-row' }, [
      el('td', { text: 'Total' }), el('td', {}), el('td', {}), el('td', { text: money(total), 'class': 'num' })
    ]));
    return table;
  }

  function warningsList(r) {
    var ul = el('ul', { 'class': 'warning-list' });
    r.warnings.forEach(function (w) {
      ul.appendChild(el('li', { 'class': w.level, text: w.message }));
    });
    return ul;
  }

  function renderReconcile() {
    var out = $('#reconcile-output');
    out.innerHTML = '';
    if (!hasData()) {
      out.appendChild(el('p', { text: 'Enter data on the first three tabs (or click “Load sample data” above) to see the reconciliation.', style: 'color:var(--muted)' }));
      return;
    }
    var r = runReconciliation();

    var banner = el('div', { 'class': 'status-banner ' + (r.balanced ? 'good' : 'bad') });
    banner.textContent = r.balanced
      ? '✔ RECONCILED — all three balances agree' + (r.warnings.length ? ' (see notes below)' : '')
      : '✘ OUT OF BALANCE — bank vs. book off by ' + money(r.diffs.bankVsBook) + ', book vs. client ledgers off by ' + money(-r.diffs.bookVsLedgers);
    out.appendChild(banner);

    var cards = el('div', { 'class': 'summary-cards' });
    [['Adjusted bank balance', r.bank.adjusted, 'ending ' + money(r.bank.ending) + ' + in transit − outstanding'],
     ['Book balance', r.book.ending, 'QuickBooks trust ledger'],
     ['Client ledger total', r.ledger.total, r.ledger.count + ' Qualia file ledger(s)']
    ].forEach(function (c) {
      cards.appendChild(el('div', { 'class': 'card' }, [
        el('div', { 'class': 'label', text: c[0] }),
        el('div', { 'class': 'value', text: '$' + money(c[1]) }),
        el('div', { 'class': 'sub', text: c[2] })
      ]));
    });
    out.appendChild(cards);

    if (r.warnings.length) out.appendChild(warningsList(r));

    out.appendChild(el('h3', { 'class': 'section', text: 'Reconciliation detail' }));
    out.appendChild(threeWayTable(r));

    out.appendChild(el('h3', { 'class': 'section', text: 'Outstanding disbursements (in QuickBooks, not yet cleared at the bank)' }));
    out.appendChild(itemTable(r.outstanding, 'None — every book disbursement has cleared.'));

    out.appendChild(el('h3', { 'class': 'section', text: 'Deposits in transit (in QuickBooks, not yet on the bank statement)' }));
    out.appendChild(itemTable(r.inTransit, 'None — every book deposit is on the statement.'));

    out.appendChild(el('h3', { 'class': 'section', text: 'Bank items with no book entry (post these in QuickBooks)' }));
    out.appendChild(itemTable(r.bankOnly, 'None — every bank transaction is in the books.'));

    if (r.ledger.negatives.length) {
      out.appendChild(el('h3', { 'class': 'section', text: 'Negative client ledgers (investigate immediately)' }));
      var t = el('table', { 'class': 'data' });
      t.appendChild(el('tr', {}, [el('th', { text: 'File #' }), el('th', { text: 'Client / property' }), el('th', { text: 'Balance', 'class': 'num' })]));
      r.ledger.negatives.forEach(function (l) {
        t.appendChild(el('tr', {}, [el('td', { text: l.fileNo }), el('td', { text: l.name }), el('td', { text: money(l.balance), 'class': 'num neg' })]));
      });
      out.appendChild(t);
    }

    out.appendChild(el('p', {
      style: 'color:var(--muted);font-size:13px;margin-top:16px',
      text: r.matches.length + ' bank/book transaction pair(s) matched automatically (' +
        r.matches.filter(function (m) { return m.method === 'check-number'; }).length + ' by check number).'
    }));
  }

  /* ---------------- report ---------------- */

  function renderReport() {
    var out = $('#report-content');
    out.innerHTML = '';
    if (!hasData()) {
      out.appendChild(el('p', { text: 'Enter data first — the printable report is generated from the reconciliation.', style: 'color:var(--muted)' }));
      return;
    }
    var r = runReconciliation();

    var header = el('div', { 'class': 'report-header' }, [
      el('div', { 'class': 'firm', text: state.accountName || 'Trust Account' }),
      el('h2', { text: 'Monthly Three-Way Trust Account Reconciliation' }),
      el('div', { 'class': 'meta', text: 'Reconciliation as of ' + (state.statementDate || '(no statement date set)') + ' — prepared ' + new Date().toLocaleDateString('en-US') })
    ]);
    out.appendChild(header);

    var banner = el('div', { 'class': 'status-banner ' + (r.balanced ? 'good' : 'bad') });
    banner.textContent = r.balanced ? 'RECONCILED — adjusted bank balance, book balance, and client ledger total all agree.'
      : 'OUT OF BALANCE — differences noted below must be resolved.';
    out.appendChild(banner);

    out.appendChild(threeWayTable(r));

    if (!r.balanced) {
      var difs = el('table', { 'class': 'data', style: 'margin-top:10px' });
      difs.appendChild(el('tr', {}, [el('th', { text: 'Difference' }), el('th', { text: 'Amount', 'class': 'num' })]));
      [['Adjusted bank vs. book', r.diffs.bankVsBook],
       ['Adjusted bank vs. client ledgers', r.diffs.bankVsLedgers],
       ['Book vs. client ledgers', r.diffs.bookVsLedgers]].forEach(function (d) {
        difs.appendChild(el('tr', {}, [el('td', { text: d[0] }), el('td', { text: money(d[1]), 'class': 'num' + (d[1] !== 0 ? ' neg' : '') })]));
      });
      out.appendChild(difs);
    }

    if (r.warnings.length) out.appendChild(warningsList(r));

    out.appendChild(el('h3', { 'class': 'section', text: 'Outstanding disbursements' }));
    out.appendChild(itemTable(r.outstanding, 'None.'));
    out.appendChild(el('h3', { 'class': 'section', text: 'Deposits in transit' }));
    out.appendChild(itemTable(r.inTransit, 'None.'));
    if (r.bankOnly.length) {
      out.appendChild(el('h3', { 'class': 'section', text: 'Bank items not yet recorded in the books' }));
      out.appendChild(itemTable(r.bankOnly, ''));
    }

    out.appendChild(el('h3', { 'class': 'section', text: 'Client ledger balances (Qualia)' }));
    var lt = el('table', { 'class': 'data' });
    lt.appendChild(el('tr', {}, [el('th', { text: 'File #' }), el('th', { text: 'Client / property' }), el('th', { text: 'Balance', 'class': 'num' })]));
    state.ledgers.forEach(function (l) {
      lt.appendChild(el('tr', {}, [el('td', { text: l.fileNo }), el('td', { text: l.name }), el('td', { text: money(l.balance), 'class': 'num' + (l.balance < 0 ? ' neg' : '') })]));
    });
    lt.appendChild(el('tr', { 'class': 'total-row' }, [
      el('td', { text: 'Total' }), el('td', {}), el('td', { text: money(r.ledger.total), 'class': 'num' })
    ]));
    out.appendChild(lt);

    out.appendChild(el('div', { 'class': 'sig-block' }, [
      el('div', { 'class': 'sig-line', text: 'Prepared by / date' }),
      el('div', { 'class': 'sig-line', text: 'Reviewed and approved by (attorney) / date' })
    ]));
  }

  $('#btn-print').addEventListener('click', function () { window.print(); });

  /* ---------------- render all ---------------- */

  function renderAll() {
    $('#account-name').value = state.accountName || '';
    $('#statement-date').value = state.statementDate || '';
    $('#bank-ending').value = state.bank.ending === null ? '' : money(state.bank.ending);
    $('#book-ending').value = state.book.ending === null ? '' : money(state.book.ending);
    $('#badge-bank').textContent = state.bank.txns.length;
    $('#badge-book').textContent = state.book.txns.length;
    $('#badge-qualia').textContent = state.ledgers.length;
    renderTxnTable('#bank-table', state.bank.txns, function (t) {
      state.bank.txns.splice(state.bank.txns.indexOf(t), 1); changed();
    });
    renderTxnTable('#book-table', state.book.txns, function (t) {
      state.book.txns.splice(state.book.txns.indexOf(t), 1); changed();
    });
    renderLedgerTable();
    renderReconcile();
    renderReport();
  }

  wireMoneyInput('#bank-ending', function () { return state.bank.ending; }, function (v) { state.bank.ending = v; });
  wireMoneyInput('#book-ending', function () { return state.book.ending; }, function (v) { state.book.ending = v; });

  renderAll();
})();
