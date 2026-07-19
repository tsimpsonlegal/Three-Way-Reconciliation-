# Wire Intake Assistant for Qualia

A single-file internal tool for accurately entering **loan payoff** and **seller
proceeds** wiring information into Qualia (dds.qualia.io).

## How to use it

1. Open `qualia-wire-intake.html` in any modern browser (double-click it, or
   host it on a shared drive / intranet — no install, no server needed).
2. **Step 1 — File verification.** Enter the Qualia file number twice (the
   second entry must be typed, not pasted), plus the property street address
   and a borrower/seller last name from the file. Choose whether the document
   is a loan payoff or a seller proceeds wire.
3. **Step 2 — Document.** Drag & drop the PDF (scanned/faxed PDFs are OCR'd
   automatically), or paste the wiring text from an email.
4. **Step 3 — Review.** Extracted fields are shown for line-by-line review.
   The ABA routing number is checksum-validated, and the address/name you
   entered in Step 1 are cross-checked against the document — a mismatch
   raises a red warning so data can't silently go to the wrong file. A
   confirmation checkbox gates the final step.
5. **Step 4 — Enter into Qualia.** One-click Copy buttons for each field,
   ordered to match Qualia's payoff / disbursement screens, plus an
   "Open Qualia" button and a printable audit summary for the file.

## Security notes

- Everything runs locally in the browser. **No document, wire detail, or
  credential is ever transmitted anywhere by this tool.**
- The tool never asks for or stores Qualia usernames/passwords — staff log in
  to dds.qualia.io in their own browser session as usual.
- The PDF reader (Mozilla pdf.js) and OCR engine (Tesseract) are loaded from
  public CDNs on first use and then run entirely on the user's machine. If
  your network blocks CDNs, the **Paste text** path still works fully offline.
- The footer of every printed audit summary reminds staff to verify wire
  instructions by phone at an independently confirmed number before release.

## Possible phase 2: direct upload into Qualia

Browsers do not allow an outside web page to log into another site
(dds.qualia.io) with a username/password and type data into it — that is a
core browser security rule, not a limitation of this tool. True automatic
upload requires **Qualia's official API**, which needs an API token issued by
Qualia (ask your Qualia account representative about API / integration
access). With a token, a small server component can be added so the final
step pushes the verified payoff/disbursement data directly into the order
instead of using copy buttons. The verification workflow in this tool was
designed so that step can be swapped in without changing anything else.
