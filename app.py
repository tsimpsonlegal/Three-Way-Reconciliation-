import os
import json
import traceback
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
from werkzeug.utils import secure_filename

from parsers.quickbooks_parser import parse_quickbooks
from parsers.bank_parser import parse_bank_statement
from parsers.qualia_parser import parse_qualia
from reconciliation.reconciler import perform_reconciliation
from reconciliation.report_generator import generate_pdf_report, generate_csv_report

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(__file__), "uploads")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls", "pdf"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/parse", methods=["POST"])
def parse_files():
    errors = []
    results = {}

    month_year = request.form.get("month_year", "")
    firm_name = request.form.get("firm_name", "")
    account_name = request.form.get("account_name", "Trust Account")

    # Parse QuickBooks file
    qb_file = request.files.get("quickbooks_file")
    if qb_file and allowed_file(qb_file.filename):
        path = os.path.join(app.config["UPLOAD_FOLDER"], secure_filename(qb_file.filename))
        qb_file.save(path)
        try:
            results["quickbooks"] = parse_quickbooks(path)
        except Exception as e:
            errors.append(f"QuickBooks parse error: {str(e)}")
            results["quickbooks"] = None
    else:
        errors.append("QuickBooks file missing or invalid format.")
        results["quickbooks"] = None

    # Parse bank statement file
    bank_file = request.files.get("bank_file")
    if bank_file and allowed_file(bank_file.filename):
        path = os.path.join(app.config["UPLOAD_FOLDER"], secure_filename(bank_file.filename))
        bank_file.save(path)
        try:
            results["bank"] = parse_bank_statement(path)
        except Exception as e:
            errors.append(f"Bank statement parse error: {str(e)}")
            results["bank"] = None
    else:
        errors.append("Bank statement file missing or invalid format.")
        results["bank"] = None

    # Parse Qualia file
    qualia_file = request.files.get("qualia_file")
    if qualia_file and allowed_file(qualia_file.filename):
        path = os.path.join(app.config["UPLOAD_FOLDER"], secure_filename(qualia_file.filename))
        qualia_file.save(path)
        try:
            results["qualia"] = parse_qualia(path)
        except Exception as e:
            errors.append(f"Qualia parse error: {str(e)}")
            results["qualia"] = None
    else:
        errors.append("Qualia file missing or invalid format.")
        results["qualia"] = None

    # Manual adjustments from form
    try:
        outstanding_checks = float(request.form.get("outstanding_checks", 0) or 0)
        deposits_in_transit = float(request.form.get("deposits_in_transit", 0) or 0)
    except ValueError:
        outstanding_checks = 0.0
        deposits_in_transit = 0.0

    if results["quickbooks"] is None or results["bank"] is None or results["qualia"] is None:
        return jsonify({"success": False, "errors": errors, "results": results})

    try:
        reconciliation = perform_reconciliation(
            bank_data=results["bank"],
            quickbooks_data=results["quickbooks"],
            qualia_data=results["qualia"],
            outstanding_checks=outstanding_checks,
            deposits_in_transit=deposits_in_transit,
            month_year=month_year,
            firm_name=firm_name,
            account_name=account_name,
        )
        return jsonify({"success": True, "errors": errors, "reconciliation": reconciliation})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "errors": errors + [f"Reconciliation error: {str(e)}"]})


@app.route("/api/report/pdf", methods=["POST"])
def download_pdf():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    try:
        path = generate_pdf_report(data, app.config["UPLOAD_FOLDER"])
        return send_file(path, as_attachment=True, download_name="trust_account_reconciliation.pdf")
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/report/csv", methods=["POST"])
def download_csv():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    try:
        path = generate_csv_report(data, app.config["UPLOAD_FOLDER"])
        return send_file(path, as_attachment=True, download_name="trust_account_reconciliation.csv")
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    app.run(debug=True, port=5000)
