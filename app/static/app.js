/* Qualia Payoff Uploader — front-end logic */
"use strict";

const $ = (id) => document.getElementById(id);

let selectedPdf = null;
let extracted = null;

/* ------------------------------------------------------------ utilities */
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 5000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: opts.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

function goToStep(n) {
  document.querySelectorAll(".step").forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  document.querySelectorAll(".panel").forEach((el) => el.classList.remove("active"));
  $("panel" + n).classList.add("active");
  window.scrollTo({ top: 0 });
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) {
    if (on) { btn._orig = btn.textContent; btn.textContent = label; }
    else if (btn._orig) { btn.textContent = btn._orig; }
  }
}

function setShot(imgEl, b64) {
  if (b64) imgEl.src = "data:image/png;base64," + b64;
}

/* ------------------------------------------------------------- settings */
async function loadSettings() {
  const res = await fetch("/api/settings");
  const cfg = await res.json();
  $("setQualiaUrl").value = cfg.qualia_url;
  $("qualiaUrlLabel").textContent = cfg.qualia_url.replace(/^https?:\/\//, "");
  $("apiKeyHint").textContent = cfg.has_api_key
    ? `API key saved (${cfg.api_key_hint}). Leave blank to keep it.`
    : "No API key saved yet — AI extraction won't work until you add one.";
  if (!cfg.has_api_key) $("settingsModal").classList.remove("hidden");
}

$("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");
$("closeSettingsBtn").onclick = () => $("settingsModal").classList.add("hidden");
$("saveSettingsBtn").onclick = async () => {
  try {
    await api("/api/settings", {
      body: JSON.stringify({
        qualia_url: $("setQualiaUrl").value || null,
        anthropic_api_key: $("setApiKey").value || null,
      }),
    });
    $("setApiKey").value = "";
    await loadSettings();
    $("settingsModal").classList.add("hidden");
    toast("Settings saved.");
  } catch (e) { toast(e.message, true); }
};

/* -------------------------------------------------------- step 1: connect */
$("connectBtn").onclick = async () => {
  const username = $("qUser").value.trim();
  const password = $("qPass").value;
  if (!username || !password) return toast("Enter your Qualia username and password.", true);
  busy($("connectBtn"), true, "Opening Chrome & logging in…");
  try {
    const res = await api("/api/connect", { body: JSON.stringify({ username, password }) });
    $("qPass").value = "";
    if (res.logged_in) {
      onConnected();
    } else {
      $("mfaBox").classList.remove("hidden");
      toast("Finish logging in (2FA?) in the Chrome window, then click Continue.");
    }
  } catch (e) { toast(e.message, true); }
  finally { busy($("connectBtn"), false); }
};

$("mfaContinueBtn").onclick = async () => {
  busy($("mfaContinueBtn"), true, "Checking…");
  try {
    const res = await api("/api/login-status");
    if (res.logged_in) onConnected();
    else toast("Still on the login page — finish signing in first.", true);
  } catch (e) { toast(e.message, true); }
  finally { busy($("mfaContinueBtn"), false); }
};

function onConnected() {
  $("connBadge").textContent = "Connected to Qualia";
  $("connBadge").classList.replace("off", "on");
  $("mfaBox").classList.add("hidden");
  toast("Logged in to Qualia.");
  goToStep(2);
}

/* --------------------------------------------------- step 2 & 3: file */
$("lookupBtn").onclick = async () => {
  const fileNumber = $("fileNumber").value.trim();
  if (!fileNumber) return toast("Enter the Qualia file number.", true);
  busy($("lookupBtn"), true, "Searching Qualia…");
  try {
    const res = await api("/api/lookup-file", { body: JSON.stringify({ file_number: fileNumber }) });
    $("verifyFileNum").textContent = fileNumber;
    document.querySelectorAll(".fileNumEcho").forEach((el) => (el.textContent = fileNumber));

    let html = res.found
      ? `<p class="found">✓ File number "${fileNumber}" was found on the page shown below.</p>`
      : `<p class="not-found">✗ The file number "${fileNumber}" was NOT clearly found. ` +
        `Check the screenshot — you may need to search again or open the file manually in the Chrome window.</p>`;
    if (res.headings && res.headings.length) {
      html += "<p><strong>Page headings found:</strong><br>" +
        res.headings.map((h) => `&bull; ${escapeHtml(h)}`).join("<br>") + "</p>";
    }
    $("verifyDetails").innerHTML = html;
    setShot($("verifyScreenshot"), res.screenshot);
    goToStep(3);
  } catch (e) { toast(e.message, true); }
  finally { busy($("lookupBtn"), false); }
};

$("rejectFileBtn").onclick = () => { $("fileNumber").value = ""; goToStep(2); };

$("confirmFileBtn").onclick = async () => {
  try {
    await api("/api/confirm-file");
    goToStep(4);
  } catch (e) { toast(e.message, true); }
};

/* ------------------------------------------------- step 4: document input */
const dz = $("dropZone");
["dragenter", "dragover"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
dz.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) acceptPdf(file);
});
$("browseBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = () => { if ($("fileInput").files[0]) acceptPdf($("fileInput").files[0]); };

function acceptPdf(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return toast("Please choose a PDF file.", true);
  }
  selectedPdf = file;
  $("dzFileName").textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
}

$("extractBtn").onclick = async () => {
  const text = $("pasteText").value.trim();
  if (!selectedPdf && !text) return toast("Drop a PDF or paste the wiring text first.", true);
  busy($("extractBtn"), true, "Extracting…");
  $("extractStatus").classList.remove("hidden");
  try {
    const form = new FormData();
    if (selectedPdf) form.append("pdf", selectedPdf);
    form.append("text", text);
    extracted = await api("/api/extract", { body: form });
    renderReview(extracted);
    goToStep(5);
  } catch (e) { toast(e.message, true); }
  finally {
    busy($("extractBtn"), false);
    $("extractStatus").classList.add("hidden");
  }
};

/* ------------------------------------------------------- step 5: review */
const FIELD_DEFS = [
  ["lender_name", "Lender name"],
  ["borrower_names", "Borrower(s)"],
  ["loan_number", "Loan number", true],
  ["property_address", "Property address"],
  ["payoff_amount", "Payoff / wire amount ($)", true],
  ["good_through_date", "Good-through date"],
  ["per_diem", "Per diem ($/day)"],
  ["wire_bank_name", "Receiving bank"],
  ["wire_aba_routing", "ABA routing number", true],
  ["wire_account_number", "Account number", true],
  ["wire_beneficiary_name", "Beneficiary name"],
  ["wire_further_credit", "Further credit to"],
  ["wire_reference", "Wire reference / memo"],
];

function renderReview(data) {
  const grid = $("reviewGrid");
  grid.innerHTML = "";
  for (const [key, label, critical] of FIELD_DEFS) {
    const wrap = document.createElement("label");
    wrap.className = critical ? "critical" : "";
    wrap.innerHTML = `<span class="field-label">${label}</span>`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = "f_" + key;
    input.value = data[key] || "";
    wrap.appendChild(input);
    grid.appendChild(wrap);
  }

  const wb = $("warningsBox");
  if (data.warnings && data.warnings.length) {
    wb.innerHTML = `<ul><li class="warn-title">⚠ Review carefully:</li>` +
      data.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("") + "</ul>";
    wb.classList.remove("hidden");
  } else {
    wb.classList.add("hidden");
  }

  const dest = data.doc_type === "seller_proceeds" ? "disbursement" : "payoff";
  document.querySelectorAll("input[name=dest]").forEach((r) => (r.checked = r.value === dest));
}

$("backToDocBtn").onclick = () => goToStep(4);

$("fillBtn").onclick = async () => {
  const dest = document.querySelector("input[name=dest]:checked");
  if (!dest) return toast("Choose Payoffs or Disbursements.", true);
  const fields = {};
  for (const [key] of FIELD_DEFS) fields[key] = $("f_" + key).value.trim();
  if (!fields.wire_aba_routing && !fields.wire_account_number && !fields.payoff_amount) {
    return toast("There's no wire or amount data to upload.", true);
  }
  if (fields.wire_aba_routing && !/^\d{9}$/.test(fields.wire_aba_routing)) {
    if (!confirm(`The ABA routing number "${fields.wire_aba_routing}" is not 9 digits. Continue anyway?`)) return;
  }
  busy($("fillBtn"), true, "Filling Qualia form…");
  $("fillStatus").classList.remove("hidden");
  try {
    const res = await api("/api/fill", { body: JSON.stringify({ destination: dest.value, fields }) });
    renderFillResults(res, fields);
    setShot($("fillScreenshot"), res.screenshot);
    $("doneBox").classList.add("hidden");
    goToStep(6);
    if (!res.navigation.nav_clicked) {
      toast("Couldn't find the section automatically — navigate there in the Chrome window, then use the copy buttons.", true);
    }
  } catch (e) { toast(e.message, true); }
  finally {
    busy($("fillBtn"), false);
    $("fillStatus").classList.add("hidden");
  }
};

function renderFillResults(res, fields) {
  const labelByKey = Object.fromEntries(FIELD_DEFS.map(([k, l]) => [k, l]));
  const box = $("fillResults");
  box.innerHTML = "";
  for (const r of res.results) {
    const value = fields[r.key] || "";
    const row = document.createElement("div");
    row.className = "fill-row";
    const pill = r.skipped ? `<span class="pill skip">empty</span>`
      : r.filled ? `<span class="pill auto">entered</span>`
      : `<span class="pill manual">manual</span>`;
    row.innerHTML =
      `<span class="frl">${labelByKey[r.key] || r.key}</span>` +
      `<span class="frv">${escapeHtml(value)}</span>` + pill;
    if (!r.skipped) {
      const btn = document.createElement("button");
      btn.className = "ghost copy-btn";
      btn.textContent = "Copy";
      btn.onclick = async () => {
        await navigator.clipboard.writeText(value);
        btn.textContent = "Copied ✓";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      };
      row.appendChild(btn);
    }
    box.appendChild(row);
  }
}

/* ---------------------------------------------------- step 6: save/finish */
$("refreshShotBtn").onclick = async () => {
  try {
    const res = await api("/api/screenshot");
    setShot($("fillScreenshot"), res.screenshot);
  } catch (e) { toast(e.message, true); }
};

$("saveBtn").onclick = async () => {
  if (!confirm("Save this entry in Qualia now? Make sure you've reviewed the form in the Chrome window.")) return;
  busy($("saveBtn"), true, "Saving…");
  try {
    const res = await api("/api/save");
    setShot($("fillScreenshot"), res.screenshot);
    if (res.clicked) {
      toast(`Clicked "${res.clicked}" in Qualia.`);
    } else {
      toast("Couldn't find a Save button — please click Save in the Chrome window.", true);
    }
    $("doneBox").classList.remove("hidden");
  } catch (e) { toast(e.message, true); }
  finally { busy($("saveBtn"), false); }
};

$("cancelSaveBtn").onclick = () => { $("doneBox").classList.remove("hidden"); };

$("anotherDocBtn").onclick = resetForNewDoc;
$("anotherFileBtn").onclick = () => {
  resetForNewDoc();
  $("fileNumber").value = "";
  goToStep(2);
};

function resetForNewDoc() {
  selectedPdf = null;
  extracted = null;
  $("dzFileName").textContent = "";
  $("fileInput").value = "";
  $("pasteText").value = "";
  $("doneBox").classList.add("hidden");
  goToStep(4);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadSettings();
