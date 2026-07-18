# Trust Account Three-Way Reconciliation

A self-contained web app for the monthly **three-way reconciliation** of a real estate
trust (escrow/IOLTA) account, built for a Georgia real estate closing practice that uses
**QuickBooks**, **bank statements**, and **Qualia**.

Georgia Bar **Rule 1.15** (and standard escrow practice, including title underwriter
requirements) calls for three balances to agree, to the penny, every month:

| Leg | Source | What it is |
|---|---|---|
| 1. Adjusted bank balance | Bank statement | Statement ending balance **+** deposits in transit **−** outstanding checks/wires |
| 2. Book balance | QuickBooks | The trust bank account ledger balance as of the statement date |
| 3. Client ledger total | Qualia | The sum of every open file's individual escrow ledger balance (trial balance) |

## Running the app

No installation, no server, no account. **All data stays on your computer** — nothing is
uploaded anywhere, which matters for client trust data.

1. Download or clone this repository.
2. Double-click `index.html` (opens in any modern browser — Chrome, Edge, Firefox, Safari).

Click **Load sample data** in the toolbar to see a complete, balanced example month.

## Monthly workflow

1. **Toolbar** — enter the account name and the statement end date.
2. **Tab 1 – Bank Statement** — type the statement ending balance, then import the
   statement transactions as CSV (most bank websites export CSV; Excel exports can be
   saved as CSV). You'll be shown a column-mapping preview before anything imports.
3. **Tab 2 – QuickBooks** — in QuickBooks, run a transaction report on the trust bank
   account for the statement month (e.g. *Reports → Transaction Detail by Account*, or
   export the account register) and export to CSV. Import it. If the export has a
   running-balance column the book ending balance auto-fills; otherwise type it.
4. **Tab 3 – Qualia Ledgers** — in Qualia, run the escrow **Trial Balance** report for
   this trust account *as of the statement date* and export to CSV. Import it. Totals
   rows are skipped automatically.
5. **Tab 4 – Reconciliation** — the app matches bank ↔ book transactions:
   - first by **check number + amount**,
   - then by **amount + date** (within 12 days, closest dates paired first),
   - then by unique amount within 45 days.

   Unmatched book disbursements become **outstanding checks**; unmatched book deposits
   become **deposits in transit**; unmatched bank items are flagged for posting to
   QuickBooks. The three-way comparison and any exceptions display automatically.
6. **Tab 5 – Report** — a printable reconciliation report with the three-way summary,
   outstanding item lists, the full client ledger listing, and preparer/reviewer
   signature lines. Click **Print / save as PDF** and keep it with your records
   (Rule 1.15 requires six years of trust records).

### Warnings the app raises

- **Negative client ledger** — a file's ledger below zero means one client's funds
  covered another matter. Flagged in red; investigate immediately.
- **Out of balance** — any of the three legs disagreeing, with the exact differences.
- **Bank items with no book entry** — wires, adjustments, or fees that need posting.
- **Stale outstanding checks** — outstanding more than 90 days (follow up / consider
  stop-pay and reissue; unclaimed funds may implicate Georgia escheatment rules).

### Saving your work

Work is auto-saved in the browser (localStorage) as you go. Use **Save session file**
to download the reconciliation as a JSON file for your records or to move it to another
computer, and **Open session file** to load it back.

## Sample data

`sample-data/` contains a fictional but internally consistent June 2026 month —
a bank statement, a QuickBooks trust ledger export, and a Qualia trial balance — that
reconciles to the penny, with two outstanding checks and one deposit in transit. Use the
files to practice the CSV import flow, or the **Load sample data** button for one click.

## Development

Plain HTML/CSS/JavaScript, no build step and no dependencies.

```
index.html          — the app shell
css/styles.css      — styles, including the print stylesheet for the report
js/csv.js           — CSV parsing, amount/date parsing, column auto-detection
js/reconcile.js     — matching engine + three-way reconciliation math
js/app.js           — UI, state, localStorage persistence, report rendering
js/sample-data.js   — built-in sample month
sample-data/        — the same sample month as importable CSV files
tests/run-tests.mjs — test suite (node tests/run-tests.mjs)
```

All money is handled as **integer cents** — no floating-point rounding errors.

Run the tests with Node 18+:

```
node tests/run-tests.mjs
```

## Disclaimer

This tool assists with, but does not replace, the attorney's own review. Verify the
results against source records before signing the reconciliation report. It is not
legal or accounting advice.
