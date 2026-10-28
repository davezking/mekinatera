// Pure claim logic shared by claim.js and the tests. No DOM access here.

export const TXN_FORMAT = /^[A-Z0-9]{10}$/;

/** Same rules as the server (src/lib/claim.ts): remove all whitespace, uppercase. */
export function normalizeTxn(s) {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** 10 letters and numbers. A leading D is shown as a hint but never required. */
export function isValidTxn(s) {
  return TXN_FORMAT.test(s);
}

/**
 * Title and text for a claim error code (docs/design.md, Claim states). Unknown codes and
 * `undefined` (no response at all) get the network message.
 */
export function messageFor(code, supportContact, price = "the price") {
  const support = supportContact;
  switch (code) {
    case "INVALID_FORMAT":
      return {
        title: "Check the number",
        text: "A transaction number has 10 letters and numbers and starts with D. Copy it from the telebirr app.",
      };
    case "INVALID_VERSION":
      return {
        title: "Manual not available",
        text: `This manual can't be bought right now. Reload the page, or email ${support}.`,
      };
    case "ALREADY_USED":
      return {
        title: "Already used",
        text: `This transaction number has already been used. If this is your payment, email ${support}.`,
      };
    case "AMOUNT_TOO_LOW":
      return {
        title: "Amount too low",
        text: `We received less than ${price} for this number. Email ${support} and we will help.`,
      };
    case "EXPIRED":
      return {
        title: "Payment too old",
        text: `This payment is older than 7 days. Email ${support} with the number.`,
      };
    case "NOT_FOUND":
      return {
        title: "Payment not found yet",
        text: `We haven't received this payment. Check the number, or email ${support}.`,
      };
    case "RATE_LIMITED":
      return { title: "Too many tries", text: "Please wait a few minutes and try again." };
    case "BOT_CHECK_FAILED":
      return { title: "Couldn't verify", text: "Please reload the page and try again." };
    case "INVALID_TICKET":
      return {
        title: "Please try again",
        text: `We lost track of this check. Enter the number again, or email ${support}.`,
      };
    case "INVALID_REQUEST":
      return {
        title: "Something went wrong",
        text: `Please reload the page and try again, or email ${support}.`,
      };
    default:
      return { title: "No connection", text: "Check your internet and try again." };
  }
}

/** Seconds → "m:ss". */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Polls `fetchStatus()` every `intervalMs` until it returns `ok` or `error`, or until
 * `timeoutMs` has passed (then reports NOT_FOUND). A failed fetch (network) is retried on
 * the next tick. `onResult` is called exactly once. Returns `stop()`, which cancels everything.
 */
export function createPoller({
  fetchStatus,
  onResult,
  intervalMs = 5000,
  timeoutMs = 600000,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  const startedAt = now();
  let stopped = false;
  let timer = null;

  function stop() {
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function finish(result) {
    if (stopped) return;
    stop();
    onResult(result);
  }

  async function tick() {
    timer = null;
    if (stopped) return;
    if (now() - startedAt >= timeoutMs) {
      finish({ status: "error", code: "NOT_FOUND" });
      return;
    }
    let result = null;
    try {
      result = await fetchStatus();
    } catch {
      result = null; // Network hiccup: try again next tick.
    }
    if (stopped) return;
    if (result && (result.status === "ok" || result.status === "error")) {
      finish(result);
      return;
    }
    schedule();
  }

  function schedule() {
    const remaining = timeoutMs - (now() - startedAt);
    timer = setTimer(tick, Math.max(0, Math.min(intervalMs, remaining)));
  }

  schedule();
  return stop;
}
