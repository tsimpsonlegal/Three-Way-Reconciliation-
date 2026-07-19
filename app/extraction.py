"""AI extraction of payoff / wiring data from PDFs or pasted text.

Uses the Claude API with a JSON-schema-constrained output so the response is
always valid, parseable JSON. The prompt instructs the model to transcribe
exactly and to flag anything uncertain rather than guess — every extracted
value is still shown to the user for review before upload.
"""

import base64

import anthropic

MODEL = "claude-opus-4-8"

EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "doc_type": {
            "type": "string",
            "enum": ["loan_payoff", "seller_proceeds", "other"],
            "description": "loan_payoff for a lender payoff statement; "
                           "seller_proceeds for seller wire/disbursement "
                           "instructions; other if neither.",
        },
        "lender_name": {"type": "string"},
        "borrower_names": {"type": "string"},
        "loan_number": {"type": "string"},
        "property_address": {"type": "string"},
        "payoff_amount": {"type": "string"},
        "good_through_date": {"type": "string"},
        "per_diem": {"type": "string"},
        "wire_bank_name": {"type": "string"},
        "wire_aba_routing": {"type": "string"},
        "wire_account_number": {"type": "string"},
        "wire_beneficiary_name": {"type": "string"},
        "wire_further_credit": {"type": "string"},
        "wire_reference": {"type": "string"},
        "warnings": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Anything the reviewer must double-check: unclear "
                           "digits, conflicting figures, expiration language, "
                           "fields that could not be found, etc.",
        },
    },
    "required": [
        "doc_type", "lender_name", "borrower_names", "loan_number",
        "property_address", "payoff_amount", "good_through_date", "per_diem",
        "wire_bank_name", "wire_aba_routing", "wire_account_number",
        "wire_beneficiary_name", "wire_further_credit", "wire_reference",
        "warnings",
    ],
    "additionalProperties": False,
}

PROMPT = """You are extracting data from a real-estate closing document for \
entry into settlement software. The document is either a LOAN PAYOFF \
STATEMENT from a lender or WIRE INSTRUCTIONS for remitting seller proceeds.

Accuracy is critical — this data controls where money is wired. Rules:
1. TRANSCRIBE EXACTLY. Copy account numbers, routing numbers, loan numbers, \
and dollar amounts character-for-character. Never infer, round, or complete \
digits.
2. If a digit or value is unclear or ambiguous, still give your best \
transcription but add a warning describing exactly which characters are \
uncertain.
3. If a field is not present in the document, use an empty string "" — do \
not guess.
4. ABA routing numbers are exactly 9 digits. If what you read is not 9 \
digits, add a warning.
5. If the document shows multiple amounts (e.g., payoff good through \
different dates), use the primary payoff amount and note the others in a \
warning.
6. Format dollar amounts as digits with two decimals and no symbols (e.g. \
253411.87). Format dates as MM/DD/YYYY.
7. In warnings, also note anything a closer should verify (statement \
expiration, per-diem accrual after the good-through date, fees that apply \
only in certain scenarios)."""


def extract(api_key: str, pdf_bytes: bytes | None = None,
            text: str | None = None) -> dict:
    if not pdf_bytes and not (text and text.strip()):
        raise ValueError("Provide a PDF or pasted text to extract from.")

    content = []
    if pdf_bytes:
        content.append({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(pdf_bytes).decode("ascii"),
            },
        })
        content.append({"type": "text", "text": PROMPT})
    else:
        content.append({
            "type": "text",
            "text": PROMPT + "\n\n--- DOCUMENT TEXT ---\n" + text,
        })

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        output_config={
            "format": {"type": "json_schema", "schema": EXTRACTION_SCHEMA}
        },
        messages=[{"role": "user", "content": content}],
    )

    import json
    result_text = next(b.text for b in response.content if b.type == "text")
    return json.loads(result_text)
