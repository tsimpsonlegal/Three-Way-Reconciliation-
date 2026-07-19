# Qualia Payoff Uploader

An internal-use app that reads a **loan payoff statement** or **seller-proceeds
wire instructions** (PDF or pasted text), extracts the key data with AI, and
enters it into your **Qualia** file at `dds.qualia.io` — with mandatory human
verification at every step where money data is involved.

## How it works

1. **Connect** — you enter your Qualia username and password. The app opens a
   real Chrome window and logs in. Credentials are used once, held only in
   memory, and never written to disk. If Qualia asks for a 2FA code, you
   complete it in the Chrome window and click *Continue*.
2. **File number** — you type the Qualia file number.
3. **Verify** — the app finds the order in Qualia and shows you a screenshot
   and the page headings it found. You must click **"Yes, this is the correct
   file"** before anything else can happen.
4. **Document** — drag-and-drop the payoff PDF, or paste the wiring text.
5. **Review** — the AI-extracted fields (lender, loan number, payoff amount,
   good-through date, per diem, bank, ABA routing, account number, etc.) are
   shown in an editable form, with warnings for anything the AI was unsure
   about. Fields where a wrong digit means a wrong wire are flagged
   **"verify digits"**. You choose whether it goes to the **Payoffs** section
   or **Disbursements / wire out**.
6. **Upload** — the app fills the Qualia form in the visible Chrome window and
   **pauses without saving**. You review the form on screen; any field the app
   couldn't fill automatically is marked *manual* with a one-click **Copy**
   button so you can paste it yourself. Only when you click the final save
   button does anything get saved in Qualia.

## Setup (Windows, one time)

1. Install **Python 3.11+** from https://www.python.org/downloads/ —
   during install, check **"Add python.exe to PATH"**.
2. Double-click **`setup.bat`** and wait for it to finish (a few minutes).
3. Get an **Anthropic API key** for the AI extraction:
   sign up at https://platform.claude.com/ , add a small amount of credit,
   and create an API key (starts with `sk-ant-`). Each document costs a few
   cents to process.

## Daily use

1. Double-click **`Start Qualia Uploader.bat`**. The app opens at
   http://127.0.0.1:8977 in your browser. Keep the black window open.
2. The first time, the Settings dialog opens — paste your Anthropic API key
   (it is stored only in `app_data/config.json` on this computer).
3. Follow the six steps on screen.
4. When finished, close the black window (or press Ctrl+C in it) to quit.
   Closing the app also closes the automated Chrome window.

## Important notes on accuracy and safety

- **You are the final check.** The AI transcribes exactly and flags anything
  uncertain, but wire fraud prevention depends on you comparing the routing
  and account numbers against the original document at step 5, and reviewing
  the filled Qualia form at step 6. The app is deliberately unable to save
  into Qualia without your explicit confirmation.
- The app never stores your Qualia password. The Anthropic API key and the
  Qualia URL are the only saved settings.
- PDFs are sent to Anthropic's API for extraction (over HTTPS). Everything
  else stays on your computer and in your Qualia session.
- The app binds to `127.0.0.1` only — nothing on your network can reach it.

## First-run tuning

Qualia's web app changes over time, and this tool locates buttons and fields
by their on-screen labels. On first use (or after a Qualia redesign), some
fields may come back marked *manual* — that's the designed fallback, not a
failure: the value is one Copy-button click away. If a whole section
consistently isn't found, the label lists at the top of `app/qualia_bot.py`
(`PAYOFFS_NAV_TEXTS`, `ADD_BUTTON_TEXTS`, `SAVE_BUTTON_TEXTS`) and the field
maps in `app/main.py` (`PAYOFF_FIELD_MAP`, `DISBURSEMENT_FIELD_MAP`) are plain
lists of label texts that can be extended to match what Qualia shows.

## Project layout

```
setup.bat                    one-time Windows setup
Start Qualia Uploader.bat    daily launcher
requirements.txt             Python dependencies
app/
  main.py                    local web server + API
  qualia_bot.py              Chrome automation for dds.qualia.io
  extraction.py              AI extraction (Claude API, strict JSON schema)
  config.py                  local settings (API key, Qualia URL)
  static/                    the user interface
app_data/                    created at runtime; holds config.json (gitignored)
```
