"use strict";

// ── File upload zones ──────────────────────────────────────────────────────
document.querySelectorAll(".upload-zone").forEach((zone) => {
  const input = zone.querySelector("input[type=file]");
  const nameEl = zone.querySelector(".upload-filename");

  input.addEventListener("change", () => {
    if (input.files.length) {
      nameEl.textContent = input.files[0].name;
      zone.classList.add("has-file");
    }
  });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      nameEl.textContent = e.dataTransfer.files[0].name;
      zone.classList.add("has-file");
    }
  });
});

// ── Form submit ────────────────────────────────────────────────────────────
const form = document.getElementById("reconcile-form");
const submitBtn = document.getElementById("submit-btn");
const spinner = document.getElementById("spinner");
const resultsSection = document.getElementById("results");
const errorBox = document.getElementById("error-box");

let lastReconciliation = null;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  spinner.style.display = "block";
  errorBox.classList.add("hidden");
  resultsSection.classList.add("hidden");

  const fd = new FormData(form);

  try {
    const res = await fetch("/api/parse", { method: "POST", body: fd });
    const json = await res.json();

    if (!json.success || !json.reconciliation) {
      showErrors(json.errors || ["An unexpected error occurred."]);
    } else {
      if (json.errors && json.errors.length) showErrors(json.errors);
      lastReconciliation = json.reconciliation;
      renderResults(json.reconciliation);
      resultsSection.classList.remove("hidden");
      resultsSection.scrollIntoView({ behavior: "smooth" });
    }
  } catch (err) {
    showErrors([String(err)]);
  } finally {
    submitBtn.disabled = false;
    spinner.style.display = "none";
  }
});

function showErrors(msgs) {
  errorBox.innerHTML = "<strong>Errors:</strong><ul>" +
    msgs.map((m) => `<li>${escHtml(m)}</li>`).join("") + "</ul>";
  errorBox.classList.remove("hidden");
}

// ── Render results ─────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function renderResults(r) {
  // Status banner
  const banner = document.getElementById("status-banner");
  if (r.in_balance) {
    banner.className = "status-banner balanced";
    banner.innerHTML = "✓ &nbsp; All three balances are IN BALANCE";
  } else {
    banner.className = "status-banner discrepancy";
    banner.innerHTML = "⚠ &nbsp; DISCREPANCY DETECTED — see details below";
  }

  // Part 1 — Bank
  setText("bank-ending", fmt(r.bank_ending_balance));
  setText("bank-dit", fmt(r.deposits_in_transit));
  setText("bank-oc", "(" + fmt(r.outstanding_checks) + ")");
  setText("bank-adjusted", fmt(r.adjusted_bank_balance));

  // Part 2 — QuickBooks
  setText("qb-balance", fmt(r.quickbooks_balance));

  // Part 3 — Qualia
  setText("qualia-count", r.qualia_client_count);
  setText("qualia-total", fmt(r.qualia_total));

  // Comparison cards
  renderCompareCard("card-bank", "Adjusted Bank Balance", r.adjusted_bank_balance, true);
  renderCompareCard("card-qb", "QuickBooks Balance", r.quickbooks_balance, Math.abs(r.bank_vs_qb) <= 0.01);
  renderCompareCard("card-qualia", "Qualia Ledger Total", r.qualia_total, Math.abs(r.bank_vs_qualia) <= 0.01);

  // Discrepancies
  const discSection = document.getElementById("discrepancy-section");
  const discList = document.getElementById("discrepancy-list");
  if (r.discrepancies && r.discrepancies.length) {
    discList.innerHTML = r.discrepancies.map((d) =>
      `<li><div class="disc-type">${escHtml(d.type)}</div>${escHtml(d.description)}</li>`
    ).join("");
    discSection.classList.remove("hidden");
  } else {
    discSection.classList.add("hidden");
  }

  // Client ledger
  const ledgerSection = document.getElementById("ledger-section");
  const tbody = document.getElementById("ledger-tbody");
  if (r.client_ledgers && r.client_ledgers.length) {
    tbody.innerHTML = r.client_ledgers.map((cl) =>
      `<tr>
        <td>${escHtml(cl.file_number)}</td>
        <td>${escHtml(cl.name)}</td>
        <td>${escHtml(cl.address)}</td>
        <td>${fmt(cl.balance)}</td>
      </tr>`
    ).join("") +
    `<tr>
      <td></td><td></td>
      <td><strong>Total</strong></td>
      <td><strong>${fmt(r.qualia_total)}</strong></td>
    </tr>`;
    ledgerSection.classList.remove("hidden");
  } else {
    ledgerSection.classList.add("hidden");
  }
}

function renderCompareCard(id, label, amount, matches) {
  const card = document.getElementById(id);
  card.className = "compare-card " + (matches ? "match" : "mismatch");
  card.innerHTML = `
    <div class="source">${escHtml(label)}</div>
    <div class="amount">${fmt(amount)}</div>
    <div class="match-label">${matches ? "✓ Matches" : "✗ Mismatch"}</div>
  `;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Export buttons ─────────────────────────────────────────────────────────
document.getElementById("btn-pdf").addEventListener("click", () => exportReport("pdf"));
document.getElementById("btn-csv").addEventListener("click", () => exportReport("csv"));

async function exportReport(type) {
  if (!lastReconciliation) return;
  const res = await fetch(`/api/report/${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lastReconciliation),
  });
  if (!res.ok) { alert("Export failed. See server logs."); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trust_account_reconciliation.${type}`;
  a.click();
  URL.revokeObjectURL(url);
}
