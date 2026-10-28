// Claim card on the checkout page: idle → checking → error | waiting → success.
// The server enforces every rule; this only drives the UI (docs/design.md, Claim states).
import { createPoller, formatElapsed, isValidTxn, messageFor, normalizeTxn } from "./claim-core.js";

const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const form = document.getElementById("claim-form");
const input = document.getElementById("txn");
const status = document.getElementById("claim-status");

const ICONS = {
  error:
    '<svg class="notice__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.5"/></svg>',
  clock:
    '<svg class="notice__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check:
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  download:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>',
  hourglass:
    '<svg class="spinner-static" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

/** Small element builder. Text children are set with textContent, never parsed as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** Only ever parses the static ICONS markup above. */
function icon(name) {
  const wrap = document.createElement("template");
  wrap.innerHTML = ICONS[name];
  return wrap.content.firstElementChild;
}

if (form && input && status) {
  const button = form.querySelector('button[type="submit"]');
  const buttonLabel = button.textContent;
  const versionId = Number(form.elements.namedItem("versionId").value);
  const support = form.dataset.support ?? "";
  const price = form.dataset.price;
  const panel = el("div", { id: "claim-panel", "aria-live": "polite" });
  form.after(panel);

  let stopPolling = null;
  let elapsedTimer = null;
  let waiting = null; // { txn, ticket, startedAt } while polling

  function stopAll() {
    stopPolling?.();
    stopPolling = null;
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function setChecking(on) {
    button.disabled = on;
    button.replaceChildren(
      ...(on
        ? [el("span", { class: "spinner", "aria-hidden": "true" }), "Checking…"]
        : [buttonLabel]),
    );
  }

  function showIdle({ keepValue = true } = {}) {
    stopAll();
    waiting = null;
    panel.replaceChildren();
    status.replaceChildren();
    form.hidden = false;
    input.removeAttribute("aria-invalid");
    if (!keepValue) input.value = "";
    setChecking(false);
    input.focus();
  }

  function showError(code) {
    stopAll();
    waiting = null;
    const { title, text } = messageFor(code, support, price);
    panel.replaceChildren();
    form.hidden = false;
    setChecking(false);
    if (code === "INVALID_FORMAT" || code === "ALREADY_USED") {
      input.setAttribute("aria-invalid", "true");
    }
    status.replaceChildren(
      el(
        "div",
        { class: "notice-error", role: "alert" },
        icon("error"),
        el(
          "div",
          { class: "notice__body" },
          el("strong", { class: "notice__title" }, title),
          el("span", {}, text),
        ),
      ),
    );
  }

  function resetButton() {
    const reset = el(
      "button",
      { type: "button", class: "btn btn-secondary btn-block" },
      "Use a different number",
    );
    reset.addEventListener("click", () => showIdle({ keepValue: false }));
    return reset;
  }

  function showSuccess(txn, downloadUrl) {
    stopAll();
    waiting = null;
    status.replaceChildren();
    form.hidden = true;
    panel.replaceChildren(
      el(
        "div",
        { class: "claim-success" },
        el(
          "div",
          { class: "claim-success__head" },
          el("span", { class: "icon-ok" }, icon("check")),
          el(
            "div",
            { class: "notice__body" },
            el("strong", { class: "claim-success__title" }, "Payment confirmed"),
            el("span", { class: "mono claim-success__txn" }, txn),
          ),
        ),
        el(
          "a",
          { class: "btn btn-ok btn-block btn-lg", href: downloadUrl },
          icon("download"),
          "Download PDF",
        ),
        el(
          "div",
          { class: "notice-warn" },
          icon("clock"),
          el(
            "span",
            {},
            el("strong", {}, "Save the PDF to your phone now."),
            " This link works for 24 hours and up to 3 downloads. There are no accounts, so we can't show it again.",
          ),
        ),
      ),
      resetButton(),
    );
  }

  function showWaiting(txn, ticket, startedAt = Date.now()) {
    stopAll();
    waiting = { txn, ticket, startedAt };
    status.replaceChildren();
    form.hidden = true;
    const elapsed = el("span", { class: "mono" }, formatElapsed(Date.now() - startedAt));
    panel.replaceChildren(
      el(
        "div",
        { class: "claim-waiting" },
        el(
          "div",
          { class: "icon-wait" },
          el("span", { class: "spinner spinner-lg", "aria-hidden": "true" }),
          icon("hourglass"),
        ),
        el(
          "div",
          { class: "notice__body claim-waiting__body" },
          el("strong", { class: "claim-waiting__title" }, "Waiting for telebirr confirmation"),
          el("span", { class: "muted" }, "Keep this page open. It usually takes under a minute."),
        ),
        el(
          "div",
          { class: "txn-pill" },
          el("span", { class: "mono txn-pill__txn" }, txn),
          el("span", { "aria-hidden": "true" }, "·"),
          elapsed,
        ),
        el(
          "span",
          { class: "claim-waiting__note" },
          "We check every 5 seconds for up to 10 minutes.",
        ),
      ),
      resetButton(),
    );
    elapsedTimer = setInterval(() => {
      elapsed.textContent = formatElapsed(Date.now() - startedAt);
    }, 1000);
    startPolling();
  }

  function startPolling() {
    const { txn, ticket, startedAt } = waiting;
    const remaining = POLL_TIMEOUT_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      showError("NOT_FOUND");
      return;
    }
    stopPolling = createPoller({
      timeoutMs: remaining,
      fetchStatus: async () => {
        const res = await fetch(`/api/claim/status?ticket=${encodeURIComponent(ticket)}`, {
          headers: { accept: "application/json" },
        });
        return res.json();
      },
      onResult: (result) => handle(result, txn),
    });
  }

  function handle(result, txn) {
    if (result?.status === "ok" && typeof result.downloadUrl === "string") {
      showSuccess(txn, result.downloadUrl);
    } else if (result?.status === "pending" && typeof result.ticket === "string") {
      showWaiting(txn, result.ticket);
    } else {
      showError(result?.code);
    }
  }

  input.addEventListener("input", () => {
    const normalized = normalizeTxn(input.value);
    if (normalized !== input.value) input.value = normalized;
    input.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const txn = normalizeTxn(input.value);
    input.value = txn;
    if (!isValidTxn(txn)) {
      showError("INVALID_FORMAT");
      input.focus();
      return;
    }
    status.replaceChildren();
    setChecking(true);
    let result = null;
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ transactionNumber: txn, versionId }),
      });
      result = await res.json();
    } catch {
      result = null;
    }
    handle(result, txn);
  });

  // Stop polling when the page goes away; resume if it comes back from the back/forward cache.
  window.addEventListener("pagehide", stopAll);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && waiting) showWaiting(waiting.txn, waiting.ticket, waiting.startedAt);
  });
}
