"""
QuickBooks trust account export parser.

Supports:
  - QuickBooks Account Register export (CSV or Excel)
    Typical columns: Date, Transaction Type, Num, Name, Memo, Split, Amount, Balance
  - QuickBooks Balance Sheet / Trial Balance export
    Looks for a row where the account name contains 'trust' with an ending balance

Returns a dict:
  {
    "ending_balance": float,
    "transactions": [{"date": str, "description": str, "amount": float, "balance": float}, ...]
  }
"""

import pandas as pd
import re
from pathlib import Path


def _read_file(filepath: str) -> pd.DataFrame:
    ext = Path(filepath).suffix.lower()
    if ext in (".xlsx", ".xls"):
        return pd.read_excel(filepath, header=None, dtype=str)
    return _read_csv_variable_width(filepath)


def _read_csv_variable_width(filepath: str) -> pd.DataFrame:
    import csv as csv_mod
    rows = []
    max_cols = 0
    for enc in ("utf-8", "latin-1"):
        try:
            with open(filepath, encoding=enc, newline="") as f:
                for row in csv_mod.reader(f):
                    rows.append(row)
                    if len(row) > max_cols:
                        max_cols = len(row)
            break
        except Exception:
            rows = []
    if not rows:
        raise ValueError("Could not read file as CSV or Excel.")
    padded = [r + [""] * (max_cols - len(r)) for r in rows]
    return pd.DataFrame(padded, dtype=str)


def _clean_amount(val: str) -> float:
    if not val or str(val).strip() in ("", "nan"):
        return 0.0
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", "").replace("(", "-").replace(")", ""))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_quickbooks(filepath: str) -> dict:
    raw = _read_file(filepath)

    # Flatten to string for searching
    raw = raw.fillna("")
    flat = raw.astype(str)

    # Detect header row — look for common QuickBooks column headers
    header_row_idx = None
    for i, row in flat.iterrows():
        row_lower = " ".join(row.values).lower()
        if ("date" in row_lower and "amount" in row_lower) or (
            "date" in row_lower and "balance" in row_lower
        ):
            header_row_idx = i
            break

    if header_row_idx is not None:
        return _parse_register(raw, header_row_idx)

    # Fallback: look for a single balance figure associated with 'trust'
    return _parse_balance_sheet(raw)


def _parse_register(raw: pd.DataFrame, header_row: int) -> dict:
    df = raw.iloc[header_row:].copy()
    df.columns = df.iloc[0].str.strip().str.lower()
    df = df.iloc[1:].reset_index(drop=True)
    df = df[df.apply(lambda r: r.str.strip().ne("").any(), axis=1)]

    # Map flexible column names
    col_map = {}
    for col in df.columns:
        cl = str(col).lower()
        if "date" in cl and "date" not in col_map:
            col_map["date"] = col
        elif any(k in cl for k in ("name", "payee", "memo", "description")) and "description" not in col_map:
            col_map["description"] = col
        elif cl in ("amount", "debit", "credit", "deposit", "withdrawal") and "amount" not in col_map:
            col_map["amount"] = col
        elif "balance" in cl and "balance" not in col_map:
            col_map["balance"] = col

    transactions = []
    last_balance = 0.0

    for _, row in df.iterrows():
        date_val = str(row.get(col_map.get("date", ""), "")).strip()
        desc_val = str(row.get(col_map.get("description", ""), "")).strip()
        amt_val = _clean_amount(str(row.get(col_map.get("amount", ""), "")))
        bal_val = _clean_amount(str(row.get(col_map.get("balance", ""), "")))

        if date_val and date_val.lower() not in ("date", "nan", "total", ""):
            transactions.append(
                {"date": date_val, "description": desc_val, "amount": amt_val, "balance": bal_val}
            )
            if bal_val != 0.0:
                last_balance = bal_val

    if not transactions:
        raise ValueError(
            "No transactions found in QuickBooks file. "
            "Please export the trust account register as CSV or Excel."
        )

    # Use the last non-zero balance row as ending balance
    for t in reversed(transactions):
        if t["balance"] != 0.0:
            last_balance = t["balance"]
            break

    return {"ending_balance": last_balance, "transactions": transactions}


def _parse_balance_sheet(raw: pd.DataFrame) -> dict:
    """Extract a trust account balance from a QuickBooks Balance Sheet or Trial Balance."""
    best_balance = None
    for _, row in raw.iterrows():
        row_vals = list(row.values)
        row_text = " ".join(str(v) for v in row_vals).lower()
        if "trust" in row_text:
            # Scan right-to-left for a numeric value
            for val in reversed(row_vals):
                cleaned = _clean_amount(str(val))
                if cleaned != 0.0:
                    best_balance = cleaned
                    break
        if best_balance is not None:
            break

    if best_balance is None:
        raise ValueError(
            "Could not locate a trust account balance in the QuickBooks file. "
            "Please export the trust account register (not a summary report)."
        )

    return {"ending_balance": best_balance, "transactions": []}
