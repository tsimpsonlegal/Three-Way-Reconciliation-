"""
Bank statement parser — supports CSV, Excel, and PDF formats.

Returns:
  {
    "ending_balance": float,
    "beginning_balance": float,
    "transactions": [{"date": str, "description": str, "amount": float, "type": "credit"|"debit"}, ...]
  }
"""

import re
import pandas as pd
import pypdfium2 as pdfium
from pathlib import Path


def _read_csv_variable_width(filepath: str) -> pd.DataFrame:
    """Read a CSV with rows that have different column counts (common in bank exports)."""
    import csv as csv_mod
    rows = []
    max_cols = 0
    for enc in ("utf-8", "latin-1"):
        try:
            with open(filepath, encoding=enc, newline="") as f:
                reader = csv_mod.reader(f)
                for row in reader:
                    rows.append(row)
                    if len(row) > max_cols:
                        max_cols = len(row)
            break
        except Exception:
            rows = []
            continue
    if not rows:
        raise ValueError("Could not read CSV file.")
    padded = [r + [""] * (max_cols - len(r)) for r in rows]
    return pd.DataFrame(padded, dtype=str)


def _clean_amount(val) -> float:
    if not val or str(val).strip() in ("", "nan"):
        return 0.0
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", "").replace("(", "-").replace(")", ""))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_bank_statement(filepath: str) -> dict:
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        return _parse_pdf(filepath)
    elif ext in (".xlsx", ".xls"):
        raw = pd.read_excel(filepath, header=None, dtype=str)
        return _parse_tabular(raw)
    else:
        raw = _read_csv_variable_width(filepath)
        return _parse_tabular(raw)


# ---------------------------------------------------------------------------
# PDF parsing
# ---------------------------------------------------------------------------

def _parse_pdf(filepath: str) -> dict:
    text_lines = []
    doc = pdfium.PdfDocument(filepath)
    try:
        for i in range(len(doc)):
            page = doc[i]
            textpage = page.get_textpage()
            text = textpage.get_text_bounded()
            textpage.close()
            page.close()
            if text:
                text_lines.extend(text.splitlines())
    finally:
        doc.close()

    ending_balance = _extract_balance_from_lines(text_lines, ["ending balance", "closing balance", "ending statement balance", "new balance"])
    beginning_balance = _extract_balance_from_lines(text_lines, ["beginning balance", "opening balance", "previous balance"])
    transactions = _transactions_from_lines(text_lines)

    if ending_balance is None:
        ending_balance = _last_balance_from_lines(text_lines)

    if ending_balance is None:
        raise ValueError(
            "Could not find ending balance in bank statement PDF. "
            "Please ensure the PDF is text-based (not a scanned image)."
        )

    return {
        "ending_balance": ending_balance,
        "beginning_balance": beginning_balance or 0.0,
        "transactions": transactions,
    }


def _extract_balance_from_lines(lines: list, keywords: list):
    for line in lines:
        ll = line.lower()
        for kw in keywords:
            if kw in ll:
                amounts = re.findall(r"[\$]?\s*[\d,]+\.\d{2}", line)
                if amounts:
                    return _clean_amount(amounts[-1])
    return None


def _last_balance_from_lines(lines: list):
    for line in reversed(lines):
        amounts = re.findall(r"\$?\s*[\d,]+\.\d{2}", line)
        if amounts:
            return _clean_amount(amounts[-1])
    return None


def _transactions_from_lines(lines: list) -> list:
    date_re = re.compile(r"^(\d{1,2}[/\-]\d{1,2}(?:[/\-]\d{2,4})?)")
    transactions = []
    for line in lines:
        m = date_re.match(line.strip())
        if m:
            amounts = re.findall(r"[\d,]+\.\d{2}", line)
            if amounts:
                amt = _clean_amount(amounts[0])
                desc = line[m.end():].strip()
                desc = re.sub(r"[\d,]+\.\d{2}.*", "", desc).strip()
                transactions.append({"date": m.group(1), "description": desc, "amount": amt, "type": "unknown"})
    return transactions


# ---------------------------------------------------------------------------
# Tabular (CSV/Excel) parsing
# ---------------------------------------------------------------------------

def _parse_tabular(raw: pd.DataFrame) -> dict:
    raw = raw.fillna("").astype(str)

    # Find header row
    header_row_idx = None
    for i, row in raw.iterrows():
        row_lower = " ".join(row.values).lower()
        if "date" in row_lower and any(k in row_lower for k in ("amount", "balance", "debit", "credit", "deposit", "withdrawal")):
            header_row_idx = i
            break

    ending_balance = None
    beginning_balance = None
    transactions = []

    # Scan all rows for beginning/ending balance keywords before attempting tabular parse
    for _, row in raw.iterrows():
        row_text = " ".join(row.values).lower()
        for kw in ("ending balance", "closing balance", "new balance"):
            if kw in row_text:
                for val in reversed(list(row.values)):
                    amt = _clean_amount(val)
                    if amt != 0.0:
                        ending_balance = amt
                        break
        for kw in ("beginning balance", "opening balance", "previous balance"):
            if kw in row_text:
                for val in reversed(list(row.values)):
                    amt = _clean_amount(val)
                    if amt != 0.0:
                        beginning_balance = amt
                        break

    if header_row_idx is not None:
        df = raw.iloc[header_row_idx:].copy()
        df.columns = df.iloc[0].str.strip().str.lower()
        df = df.iloc[1:].reset_index(drop=True)

        col_map = {}
        for col in df.columns:
            cl = str(col)
            if "date" in cl and "date" not in col_map:
                col_map["date"] = col
            elif any(k in cl for k in ("desc", "memo", "narrat", "particular")) and "description" not in col_map:
                col_map["description"] = col
            elif any(k in cl for k in ("withdrawal", "debit")) and "debit" not in col_map:
                col_map["debit"] = col
            elif any(k in cl for k in ("deposit", "credit")) and "credit" not in col_map:
                col_map["credit"] = col
            elif "amount" in cl and "amount" not in col_map:
                col_map["amount"] = col
            elif "balance" in cl and "balance" not in col_map:
                col_map["balance"] = col

        last_balance = 0.0
        for _, row in df.iterrows():
            date_val = str(row.get(col_map.get("date", ""), "")).strip()
            if not date_val or date_val.lower() in ("date", "nan", "total", "balance", ""):
                continue
            desc_val = str(row.get(col_map.get("description", ""), "")).strip()

            if "amount" in col_map:
                amt = _clean_amount(str(row[col_map["amount"]]))
                txn_type = "credit" if amt >= 0 else "debit"
            else:
                debit = _clean_amount(str(row.get(col_map.get("debit", ""), "")))
                credit = _clean_amount(str(row.get(col_map.get("credit", ""), "")))
                if credit > 0:
                    amt, txn_type = credit, "credit"
                elif debit > 0:
                    amt, txn_type = -debit, "debit"
                else:
                    amt, txn_type = 0.0, "unknown"

            bal = _clean_amount(str(row.get(col_map.get("balance", ""), "")))
            if bal != 0.0:
                last_balance = bal

            transactions.append({"date": date_val, "description": desc_val, "amount": amt, "type": txn_type})

        if ending_balance is None and last_balance != 0.0:
            ending_balance = last_balance

    if ending_balance is None:
        raise ValueError(
            "Could not find ending balance in bank statement. "
            "Please ensure the file contains a row labeled 'Ending Balance' or similar."
        )

    return {
        "ending_balance": ending_balance,
        "beginning_balance": beginning_balance or 0.0,
        "transactions": transactions,
    }
