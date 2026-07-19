"""Qualia Payoff Uploader — local web server.

Run with:  uvicorn app.main:app --host 127.0.0.1 --port 8977
Single-user by design: one Qualia browser session at a time, held in memory.
"""

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, extraction
from .qualia_bot import BotError, QualiaBot

app = FastAPI(title="Qualia Payoff Uploader")

STATIC_DIR = Path(__file__).resolve().parent / "static"

# In-memory session state. Qualia credentials are used once for login and
# never stored anywhere.
STATE = {
    "bot": None,          # QualiaBot instance
    "file_number": None,
    "file_confirmed": False,
}


def get_bot() -> QualiaBot:
    bot = STATE["bot"]
    if bot is None or not bot.alive:
        raise HTTPException(409, "Not connected to Qualia. Connect first.")
    return bot


def handle_bot_error(exc: Exception):
    if isinstance(exc, BotError):
        raise HTTPException(502, str(exc))
    raise HTTPException(502, f"Automation error: {exc}")


# ------------------------------------------------------------------ settings
class SettingsIn(BaseModel):
    anthropic_api_key: str | None = None
    qualia_url: str | None = None


@app.get("/api/settings")
def get_settings():
    cfg = config.load()
    key = cfg.get("anthropic_api_key", "")
    return {
        "qualia_url": cfg["qualia_url"],
        "has_api_key": bool(key),
        "api_key_hint": (key[:10] + "…") if key else "",
    }


@app.post("/api/settings")
def set_settings(body: SettingsIn):
    config.save(body.model_dump())
    return get_settings()


# ------------------------------------------------------------------- connect
class ConnectIn(BaseModel):
    username: str
    password: str


@app.post("/api/connect")
def connect(body: ConnectIn):
    if STATE["bot"] is not None:
        try:
            STATE["bot"].close()
        except Exception:
            pass
    STATE.update({"bot": None, "file_number": None, "file_confirmed": False})

    cfg = config.load()
    try:
        bot = QualiaBot(cfg["qualia_url"])
        STATE["bot"] = bot
        result = bot.login(body.username, body.password)
    except Exception as exc:
        handle_bot_error(exc)
    return result


@app.post("/api/login-status")
def login_status():
    try:
        return get_bot().login_status()
    except HTTPException:
        raise
    except Exception as exc:
        handle_bot_error(exc)


@app.post("/api/disconnect")
def disconnect():
    if STATE["bot"] is not None:
        STATE["bot"].close()
    STATE.update({"bot": None, "file_number": None, "file_confirmed": False})
    return {"ok": True}


# --------------------------------------------------------------- file lookup
class FileNumberIn(BaseModel):
    file_number: str


@app.post("/api/lookup-file")
def lookup_file(body: FileNumberIn):
    file_number = body.file_number.strip()
    if not file_number:
        raise HTTPException(400, "Enter a file number.")
    STATE["file_number"] = file_number
    STATE["file_confirmed"] = False
    try:
        return get_bot().lookup_order(file_number)
    except HTTPException:
        raise
    except Exception as exc:
        handle_bot_error(exc)


@app.post("/api/confirm-file")
def confirm_file():
    if not STATE["file_number"]:
        raise HTTPException(400, "Look up a file number first.")
    STATE["file_confirmed"] = True
    return {"ok": True, "file_number": STATE["file_number"]}


# ---------------------------------------------------------------- extraction
@app.post("/api/extract")
def extract(pdf: UploadFile | None = File(None), text: str = Form("")):
    if not STATE["file_confirmed"]:
        raise HTTPException(409, "Confirm the Qualia file before extracting.")
    cfg = config.load()
    if not cfg.get("anthropic_api_key"):
        raise HTTPException(400, "No Anthropic API key saved. Add it in Settings.")

    pdf_bytes = None
    if pdf is not None:
        pdf_bytes = pdf.file.read()
        if len(pdf_bytes) > 30 * 1024 * 1024:
            raise HTTPException(400, "PDF is too large (max 30 MB).")
    try:
        data = extraction.extract(
            api_key=cfg["anthropic_api_key"],
            pdf_bytes=pdf_bytes,
            text=text or None,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"AI extraction failed: {exc}")
    return data


# ------------------------------------------------------------------- filling
class FillIn(BaseModel):
    destination: str  # "payoff" | "disbursement"
    fields: dict


# Maps each extracted field to the labels we try in Qualia's form. If a label
# can't be found, the app falls back to showing the value with a copy button
# so the user can paste it manually.
PAYOFF_FIELD_MAP = [
    {"key": "lender_name", "labels": ["Lender", "Payee", "Lender Name", "Payoff Lender"]},
    {"key": "loan_number", "labels": ["Loan Number", "Loan #", "Account Number", "Loan No"]},
    {"key": "payoff_amount", "labels": ["Payoff Amount", "Amount", "Total Payoff", "Principal Balance"]},
    {"key": "good_through_date", "labels": ["Good Through", "Good Through Date", "Valid Through", "Expiration Date"]},
    {"key": "per_diem", "labels": ["Per Diem", "Daily Interest", "Per Diem Interest"]},
    {"key": "wire_bank_name", "labels": ["Bank Name", "Bank", "Receiving Bank", "Beneficiary Bank"]},
    {"key": "wire_aba_routing", "labels": ["ABA", "Routing Number", "ABA Routing", "ABA/Routing", "Routing"]},
    {"key": "wire_account_number", "labels": ["Account Number", "Account #", "Credit Account", "Beneficiary Account"]},
    {"key": "wire_beneficiary_name", "labels": ["Beneficiary", "Account Name", "Beneficiary Name", "Credit To"]},
    {"key": "wire_further_credit", "labels": ["Further Credit", "For Further Credit", "FFC", "Further Credit To"]},
    {"key": "wire_reference", "labels": ["Reference", "Wire Reference", "Notes", "Memo"]},
]

DISBURSEMENT_FIELD_MAP = [
    {"key": "wire_beneficiary_name", "labels": ["Payee", "Beneficiary", "Account Name", "Beneficiary Name", "Name"]},
    {"key": "payoff_amount", "labels": ["Amount", "Disbursement Amount"]},
    {"key": "wire_bank_name", "labels": ["Bank Name", "Bank", "Receiving Bank", "Beneficiary Bank"]},
    {"key": "wire_aba_routing", "labels": ["ABA", "Routing Number", "ABA Routing", "ABA/Routing", "Routing"]},
    {"key": "wire_account_number", "labels": ["Account Number", "Account #", "Beneficiary Account"]},
    {"key": "wire_further_credit", "labels": ["Further Credit", "For Further Credit", "FFC", "Further Credit To"]},
    {"key": "wire_reference", "labels": ["Reference", "Wire Reference", "Notes", "Memo"]},
]


@app.post("/api/fill")
def fill(body: FillIn):
    if not STATE["file_confirmed"]:
        raise HTTPException(409, "Confirm the Qualia file before uploading.")
    if body.destination not in ("payoff", "disbursement"):
        raise HTTPException(400, "destination must be payoff or disbursement")

    field_map = (PAYOFF_FIELD_MAP if body.destination == "payoff"
                 else DISBURSEMENT_FIELD_MAP)
    fields = [
        {**entry, "value": str(body.fields.get(entry["key"], "") or "")}
        for entry in field_map
    ]
    try:
        bot = get_bot()
        nav = bot.open_section(body.destination)
        result = bot.fill_fields(fields)
    except HTTPException:
        raise
    except Exception as exc:
        handle_bot_error(exc)
    return {"navigation": nav, **result}


@app.post("/api/save")
def save():
    try:
        return get_bot().click_save()
    except HTTPException:
        raise
    except Exception as exc:
        handle_bot_error(exc)


@app.post("/api/screenshot")
def screenshot():
    try:
        return get_bot().screenshot()
    except HTTPException:
        raise
    except Exception as exc:
        handle_bot_error(exc)


# -------------------------------------------------------------------- static
@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
