"""
Three-way trust account reconciliation engine.

Georgia Real Estate Commission rules require that each month:
  (1) Adjusted Bank Balance
      = Bank Statement Ending Balance
        + Deposits in Transit
        - Outstanding Checks
  (2) QuickBooks/Checkbook Book Balance
  (3) Qualia Client Ledger Total (sum of all individual client trust balances)

All three must agree. Any difference is a discrepancy that must be investigated.
"""

from datetime import datetime


TOLERANCE = 0.01  # amounts within $0.01 are considered in balance


def perform_reconciliation(
    bank_data: dict,
    quickbooks_data: dict,
    qualia_data: dict,
    outstanding_checks: float,
    deposits_in_transit: float,
    month_year: str,
    firm_name: str,
    account_name: str,
) -> dict:

    bank_ending = bank_data["ending_balance"]
    bank_beginning = bank_data.get("beginning_balance", 0.0)
    adjusted_bank = bank_ending + deposits_in_transit - outstanding_checks

    qb_balance = quickbooks_data["ending_balance"]
    qualia_total = qualia_data["total_balance"]
    qualia_computed = qualia_data.get("computed_total", qualia_total)

    # Discrepancy checks
    bank_vs_qb = round(adjusted_bank - qb_balance, 2)
    bank_vs_qualia = round(adjusted_bank - qualia_total, 2)
    qb_vs_qualia = round(qb_balance - qualia_total, 2)

    in_balance = (
        abs(bank_vs_qb) <= TOLERANCE
        and abs(bank_vs_qualia) <= TOLERANCE
        and abs(qb_vs_qualia) <= TOLERANCE
    )

    discrepancies = []
    if abs(bank_vs_qb) > TOLERANCE:
        discrepancies.append({
            "type": "Bank vs QuickBooks",
            "amount": bank_vs_qb,
            "description": (
                f"Adjusted Bank Balance (${adjusted_bank:,.2f}) differs from "
                f"QuickBooks Balance (${qb_balance:,.2f}) by ${abs(bank_vs_qb):,.2f}."
            ),
        })
    if abs(bank_vs_qualia) > TOLERANCE:
        discrepancies.append({
            "type": "Bank vs Qualia",
            "amount": bank_vs_qualia,
            "description": (
                f"Adjusted Bank Balance (${adjusted_bank:,.2f}) differs from "
                f"Qualia Client Ledger Total (${qualia_total:,.2f}) by ${abs(bank_vs_qualia):,.2f}."
            ),
        })
    if abs(qb_vs_qualia) > TOLERANCE:
        discrepancies.append({
            "type": "QuickBooks vs Qualia",
            "amount": qb_vs_qualia,
            "description": (
                f"QuickBooks Balance (${qb_balance:,.2f}) differs from "
                f"Qualia Client Ledger Total (${qualia_total:,.2f}) by ${abs(qb_vs_qualia):,.2f}."
            ),
        })

    # Qualia internal consistency (reported total vs sum of individual ledgers)
    qualia_internal_diff = round(qualia_total - qualia_computed, 2)
    if abs(qualia_internal_diff) > TOLERANCE and qualia_data.get("client_ledgers"):
        discrepancies.append({
            "type": "Qualia Internal",
            "amount": qualia_internal_diff,
            "description": (
                f"Qualia reported total (${qualia_total:,.2f}) does not equal "
                f"the sum of individual client balances (${qualia_computed:,.2f})."
            ),
        })

    return {
        "as_of": month_year,
        "firm_name": firm_name,
        "account_name": account_name,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),

        # Part 1 — Bank
        "bank_ending_balance": bank_ending,
        "bank_beginning_balance": bank_beginning,
        "deposits_in_transit": deposits_in_transit,
        "outstanding_checks": outstanding_checks,
        "adjusted_bank_balance": adjusted_bank,

        # Part 2 — QuickBooks
        "quickbooks_balance": qb_balance,
        "quickbooks_transactions_count": len(quickbooks_data.get("transactions", [])),

        # Part 3 — Qualia
        "qualia_total": qualia_total,
        "qualia_computed_total": qualia_computed,
        "qualia_client_count": len(qualia_data.get("client_ledgers", [])),
        "client_ledgers": qualia_data.get("client_ledgers", []),

        # Result
        "in_balance": in_balance,
        "discrepancies": discrepancies,
        "bank_vs_qb": bank_vs_qb,
        "bank_vs_qualia": bank_vs_qualia,
        "qb_vs_qualia": qb_vs_qualia,

        # Raw data for export
        "bank_transactions": bank_data.get("transactions", []),
        "quickbooks_transactions": quickbooks_data.get("transactions", []),
    }
