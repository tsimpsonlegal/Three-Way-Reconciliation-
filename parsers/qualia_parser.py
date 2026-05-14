"""
Qualia client ledger export parser.

Qualia typically exports a "Trust Ledger" or "Escrow Balance" report as CSV or Excel.
Common columns: File Number, Buyer/Seller/Client Name, Property Address, Balance

Returns:
  {
    "total_balance": float,
    "client_ledgers": [{"file_number": str, "name": str, "address": str, "balance": float}, ...]
  }
"""

import re
import pandas as pd
from pathlib import Path


def _clean_amount(val) -> float:
    if not val or str(val).strip() in ("", "nan"):
        return 0.0
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", "").replace("(", "-").replace(")", ""))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


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
        raise ValueError("Could not read Qualia export file.")
    padded = [r + [""] * (max_cols - len(r)) for r in rows]
    return pd.DataFrame(padded, dtype=str)


def parse_qualia(filepath: str) -> dict:
    raw = _read_file(filepath).fillna("").astype(str)

    # Find header row — look for columns like 'balance', 'file', 'escrow'
    header_row_idx = None
    for i, row in raw.iterrows():
        row_lower = " ".join(row.values).lower()
        if "balance" in row_lower and any(k in row_lower for k in ("file", "order", "escrow", "matter", "client", "buyer", "seller")):
            header_row_idx = i
            break

    if header_row_idx is None:
        # Try to find a total row and extract a single figure
        return _parse_summary(raw)

    df = raw.iloc[header_row_idx:].copy()
    df.columns = df.iloc[0].str.strip().str.lower()
    df = df.iloc[1:].reset_index(drop=True)

    # Map columns
    col_map = {}
    for col in df.columns:
        cl = str(col).lower()
        if any(k in cl for k in ("file", "order", "matter")) and "file_number" not in col_map:
            col_map["file_number"] = col
        elif any(k in cl for k in ("name", "buyer", "seller", "client", "borrower")) and "name" not in col_map:
            col_map["name"] = col
        elif any(k in cl for k in ("address", "property")) and "address" not in col_map:
            col_map["address"] = col
        elif "balance" in cl and "balance" not in col_map:
            col_map["balance"] = col

    if "balance" not in col_map:
        # Last numeric column is probably balance
        for col in reversed(list(df.columns)):
            sample = df[col].apply(_clean_amount)
            if sample.abs().sum() > 0:
                col_map["balance"] = col
                break

    if "balance" not in col_map:
        raise ValueError(
            "Could not find a balance column in the Qualia export. "
            "Please export the Trust Ledger or Escrow Balance report."
        )

    client_ledgers = []
    total_balance = 0.0

    for _, row in df.iterrows():
        file_num = str(row.get(col_map.get("file_number", ""), "")).strip()
        name = str(row.get(col_map.get("name", ""), "")).strip()
        address = str(row.get(col_map.get("address", ""), "")).strip()
        balance_str = str(row.get(col_map["balance"], "")).strip()

        # Skip total/header rows
        if any(kw in (file_num + name + balance_str).lower() for kw in ("total", "grand", "balance", "nan")):
            # Capture grand total if present
            if any(kw in (file_num + name).lower() for kw in ("total", "grand")):
                t = _clean_amount(balance_str)
                if t != 0.0:
                    total_balance = t
            continue

        balance = _clean_amount(balance_str)
        if file_num or name:
            client_ledgers.append(
                {"file_number": file_num, "name": name, "address": address, "balance": balance}
            )

    computed_total = sum(l["balance"] for l in client_ledgers)
    if total_balance == 0.0:
        total_balance = computed_total

    if not client_ledgers and total_balance == 0.0:
        raise ValueError(
            "No client ledger entries found in Qualia file. "
            "Please export the Trust Ledger or Escrow Balance Summary report."
        )

    return {
        "total_balance": total_balance,
        "computed_total": computed_total,
        "client_ledgers": client_ledgers,
    }


def _parse_summary(raw: pd.DataFrame) -> dict:
    """Fallback: find any 'total' row and grab the associated amount."""
    for _, row in raw.iterrows():
        row_text = " ".join(row.values).lower()
        if "total" in row_text:
            for val in reversed(list(row.values)):
                amt = _clean_amount(val)
                if amt != 0.0:
                    return {"total_balance": amt, "computed_total": amt, "client_ledgers": []}
    raise ValueError(
        "Could not parse Qualia file. Please export the Trust Ledger report as CSV or Excel."
    )
