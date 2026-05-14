"""
Generates PDF and CSV reconciliation reports.
"""

import os
import csv
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT


GREEN = colors.HexColor("#1a7a4a")
RED = colors.HexColor("#c0392b")
AMBER = colors.HexColor("#e67e22")
LIGHT_GRAY = colors.HexColor("#f5f5f5")
MID_GRAY = colors.HexColor("#cccccc")
DARK = colors.HexColor("#1a1a1a")
HEADER_BG = colors.HexColor("#1a3a5c")


def _fmt(amount: float) -> str:
    return f"${amount:,.2f}"


def _status_color(in_balance: bool):
    return GREEN if in_balance else RED


def generate_pdf_report(data: dict, upload_folder: str) -> str:
    path = os.path.join(upload_folder, "reconciliation_report.pdf")
    doc = SimpleDocTemplate(
        path,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title", parent=styles["Normal"], fontSize=16, textColor=HEADER_BG,
                                  spaceAfter=4, alignment=TA_CENTER, fontName="Helvetica-Bold")
    subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"], fontSize=10, textColor=colors.gray,
                                     spaceAfter=2, alignment=TA_CENTER)
    section_style = ParagraphStyle("Section", parent=styles["Normal"], fontSize=11, textColor=HEADER_BG,
                                    spaceBefore=12, spaceAfter=4, fontName="Helvetica-Bold")
    normal = ParagraphStyle("Normal2", parent=styles["Normal"], fontSize=9, spaceAfter=2)
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.gray)

    story = []

    # Header
    firm = data.get("firm_name") or "Real Estate Law Firm"
    period = data.get("as_of") or ""
    account = data.get("account_name") or "Trust Account"

    story.append(Paragraph(firm, title_style))
    story.append(Paragraph(f"Trust Account Three-Way Reconciliation", subtitle_style))
    story.append(Paragraph(f"{account} &nbsp;|&nbsp; Period: {period}", subtitle_style))
    story.append(Paragraph(f"Generated: {data.get('generated_at', '')}", small))
    story.append(HRFlowable(width="100%", thickness=2, color=HEADER_BG, spaceAfter=8))

    # Status banner
    in_balance = data.get("in_balance", False)
    status_text = "IN BALANCE" if in_balance else "DISCREPANCY DETECTED"
    status_color = GREEN if in_balance else RED
    status_table = Table(
        [[Paragraph(f"<b>STATUS: {status_text}</b>", ParagraphStyle("ST", fontSize=13, textColor=colors.white,
                                                                      alignment=TA_CENTER, fontName="Helvetica-Bold"))]],
        colWidths=["100%"]
    )
    status_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), status_color),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(status_table)
    story.append(Spacer(1, 12))

    col_w = [3.2 * inch, 2.2 * inch]

    def section_table(title, rows, highlight_last=True):
        story.append(Paragraph(title, section_style))
        tdata = []
        for label, value, bold in rows:
            label_p = Paragraph(f"{'<b>' if bold else ''}{label}{'</b>' if bold else ''}", normal)
            value_p = Paragraph(
                f"{'<b>' if bold else ''}<font color='#1a1a1a'>{value}</font>{'</b>' if bold else ''}",
                ParagraphStyle("V", parent=normal, alignment=TA_RIGHT)
            )
            tdata.append([label_p, value_p])

        tbl = Table(tdata, colWidths=col_w)
        style = [
            ("LINEBELOW", (0, 0), (-1, -2), 0.5, MID_GRAY),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
        ]
        if highlight_last:
            style += [
                ("BACKGROUND", (0, -1), (-1, -1), LIGHT_GRAY),
                ("LINEABOVE", (0, -1), (-1, -1), 1, HEADER_BG),
                ("LINEBELOW", (0, -1), (-1, -1), 1, HEADER_BG),
            ]
        tbl.setStyle(TableStyle(style))
        story.append(tbl)

    # Part 1 — Bank
    section_table("Part 1 — Bank Statement Balance", [
        ("Bank Statement Ending Balance", _fmt(data["bank_ending_balance"]), False),
        ("+ Deposits in Transit", _fmt(data["deposits_in_transit"]), False),
        ("− Outstanding Checks", f"({_fmt(data['outstanding_checks'])})", False),
        ("= Adjusted Bank Balance", _fmt(data["adjusted_bank_balance"]), True),
    ])

    # Part 2 — QuickBooks
    section_table("Part 2 — QuickBooks Book Balance", [
        ("Trust Account Balance per QuickBooks", _fmt(data["quickbooks_balance"]), True),
    ])

    # Part 3 — Qualia
    section_table("Part 3 — Qualia Client Ledger Total", [
        (f"Sum of {data.get('qualia_client_count', 0)} Client Ledger Balance(s)", _fmt(data["qualia_total"]), True),
    ])

    # Comparison table
    story.append(Paragraph("Reconciliation Summary", section_style))
    comp_data = [
        [Paragraph("<b>Source</b>", normal), Paragraph("<b>Balance</b>", ParagraphStyle("H", parent=normal, alignment=TA_RIGHT)), Paragraph("<b>Matches?</b>", ParagraphStyle("H", parent=normal, alignment=TA_CENTER))],
        [Paragraph("Adjusted Bank Balance", normal), Paragraph(_fmt(data["adjusted_bank_balance"]), ParagraphStyle("V", parent=normal, alignment=TA_RIGHT)), Paragraph("—", ParagraphStyle("V", parent=normal, alignment=TA_CENTER))],
        [Paragraph("QuickBooks Balance", normal), Paragraph(_fmt(data["quickbooks_balance"]), ParagraphStyle("V", parent=normal, alignment=TA_RIGHT)),
         Paragraph("<font color='#1a7a4a'>✓</font>" if abs(data["bank_vs_qb"]) <= 0.01 else f"<font color='#c0392b'>✗  ${abs(data['bank_vs_qb']):,.2f}</font>", ParagraphStyle("V", parent=normal, alignment=TA_CENTER))],
        [Paragraph("Qualia Client Ledger Total", normal), Paragraph(_fmt(data["qualia_total"]), ParagraphStyle("V", parent=normal, alignment=TA_RIGHT)),
         Paragraph("<font color='#1a7a4a'>✓</font>" if abs(data["bank_vs_qualia"]) <= 0.01 else f"<font color='#c0392b'>✗  ${abs(data['bank_vs_qualia']):,.2f}</font>", ParagraphStyle("V", parent=normal, alignment=TA_CENTER))],
    ]
    comp_tbl = Table(comp_data, colWidths=[3.2 * inch, 2.0 * inch, 1.5 * inch])
    comp_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, MID_GRAY),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (0, -1), 6),
        ("RIGHTPADDING", (-1, 0), (-1, -1), 6),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_GRAY),
    ]))
    story.append(comp_tbl)

    # Discrepancies
    discrepancies = data.get("discrepancies", [])
    if discrepancies:
        story.append(Paragraph("Discrepancies", section_style))
        for d in discrepancies:
            story.append(Paragraph(
                f"<b>{d['type']}:</b> {d['description']}",
                ParagraphStyle("Disc", parent=normal, textColor=RED, spaceBefore=4)
            ))

    # Client ledger detail
    client_ledgers = data.get("client_ledgers", [])
    if client_ledgers:
        story.append(Paragraph("Qualia Client Ledger Detail", section_style))
        cl_header = [
            Paragraph("<b>File #</b>", small),
            Paragraph("<b>Client / Party</b>", small),
            Paragraph("<b>Property</b>", small),
            Paragraph("<b>Balance</b>", ParagraphStyle("SH", parent=small, alignment=TA_RIGHT)),
        ]
        cl_data = [cl_header]
        for cl in client_ledgers:
            cl_data.append([
                Paragraph(cl.get("file_number", ""), small),
                Paragraph(cl.get("name", ""), small),
                Paragraph(cl.get("address", ""), small),
                Paragraph(_fmt(cl["balance"]), ParagraphStyle("SV", parent=small, alignment=TA_RIGHT)),
            ])
        cl_data.append([
            Paragraph("", small), Paragraph("", small),
            Paragraph("<b>Total</b>", ParagraphStyle("ST", parent=small, alignment=TA_RIGHT, fontName="Helvetica-Bold")),
            Paragraph(f"<b>{_fmt(data['qualia_total'])}</b>", ParagraphStyle("SV", parent=small, alignment=TA_RIGHT, fontName="Helvetica-Bold")),
        ])
        cl_tbl = Table(cl_data, colWidths=[1.0 * inch, 2.2 * inch, 2.5 * inch, 1.0 * inch])
        cl_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("LINEBELOW", (0, 0), (-1, -2), 0.5, MID_GRAY),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (0, -1), 4),
            ("RIGHTPADDING", (-1, 0), (-1, -1), 4),
            ("BACKGROUND", (0, -1), (-1, -1), LIGHT_GRAY),
            ("LINEABOVE", (0, -1), (-1, -1), 1, HEADER_BG),
        ]))
        story.append(cl_tbl)

    # Signature block
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", thickness=0.5, color=MID_GRAY))
    story.append(Spacer(1, 12))
    sig_data = [
        [Paragraph("Prepared by:", small), Paragraph("Date:", small)],
        [Paragraph("_" * 40, normal), Paragraph("_" * 20, normal)],
        [Paragraph("Signature", small), Paragraph("", small)],
        [Paragraph("", small), Paragraph("", small)],
        [Paragraph("Reviewed by:", small), Paragraph("Date:", small)],
        [Paragraph("_" * 40, normal), Paragraph("_" * 20, normal)],
        [Paragraph("Signature", small), Paragraph("", small)],
    ]
    sig_tbl = Table(sig_data, colWidths=[4.0 * inch, 2.5 * inch])
    sig_tbl.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(sig_tbl)

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "This reconciliation is prepared in accordance with Georgia Real Estate Commission Rule 520-1-.08.",
        ParagraphStyle("Footer", parent=small, alignment=TA_CENTER, textColor=colors.gray)
    ))

    doc.build(story)
    return path


def generate_csv_report(data: dict, upload_folder: str) -> str:
    path = os.path.join(upload_folder, "reconciliation_report.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Trust Account Three-Way Reconciliation"])
        w.writerow(["Firm", data.get("firm_name", "")])
        w.writerow(["Account", data.get("account_name", "")])
        w.writerow(["Period", data.get("as_of", "")])
        w.writerow(["Generated", data.get("generated_at", "")])
        w.writerow([])

        w.writerow(["PART 1 — BANK STATEMENT"])
        w.writerow(["Bank Statement Ending Balance", data["bank_ending_balance"]])
        w.writerow(["+ Deposits in Transit", data["deposits_in_transit"]])
        w.writerow(["- Outstanding Checks", data["outstanding_checks"]])
        w.writerow(["= Adjusted Bank Balance", data["adjusted_bank_balance"]])
        w.writerow([])

        w.writerow(["PART 2 — QUICKBOOKS"])
        w.writerow(["QuickBooks Trust Account Balance", data["quickbooks_balance"]])
        w.writerow([])

        w.writerow(["PART 3 — QUALIA CLIENT LEDGER"])
        w.writerow(["Qualia Total Client Ledger Balance", data["qualia_total"]])
        w.writerow([])

        w.writerow(["RECONCILIATION RESULT"])
        w.writerow(["In Balance?", "YES" if data.get("in_balance") else "NO"])
        w.writerow(["Bank vs QuickBooks Difference", data.get("bank_vs_qb", 0)])
        w.writerow(["Bank vs Qualia Difference", data.get("bank_vs_qualia", 0)])
        w.writerow(["QuickBooks vs Qualia Difference", data.get("qb_vs_qualia", 0)])
        w.writerow([])

        discrepancies = data.get("discrepancies", [])
        if discrepancies:
            w.writerow(["DISCREPANCIES"])
            for d in discrepancies:
                w.writerow([d["type"], d["description"]])
            w.writerow([])

        client_ledgers = data.get("client_ledgers", [])
        if client_ledgers:
            w.writerow(["QUALIA CLIENT LEDGER DETAIL"])
            w.writerow(["File Number", "Client Name", "Property Address", "Balance"])
            for cl in client_ledgers:
                w.writerow([cl.get("file_number", ""), cl.get("name", ""), cl.get("address", ""), cl["balance"]])
            w.writerow(["", "", "TOTAL", data["qualia_total"]])

    return path
