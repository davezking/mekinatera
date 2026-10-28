import { describe, expect, it, vi } from "vitest";
// @ts-expect-error: plain browser ES module (public/js) without type declarations.
import * as core from "../public/js/claim-core.js";

type Result = { status: string; code?: string; downloadUrl?: string; ticket?: string };
type Message = { title: string; text: string };

const { createPoller, formatElapsed, isValidTxn, messageFor, normalizeTxn } = core as {
  createPoller: (opts: Record<string, unknown>) => () => void;
  formatElapsed: (ms: number) => string;
  isValidTxn: (s: string) => boolean;
  messageFor: (code: string | undefined, support: string, price?: string) => Message;
  normalizeTxn: (s: string) => string;
};

const SUPPORT = "info@mekinatera.com";

describe("normalizeTxn / isValidTxn", () => {
  it("uppercases and removes all whitespace, like the server", () => {
    expect(normalizeTxn(" diq55js1ed ")).toBe("DIQ55JS1ED");
    expect(normalizeTxn("waitme 0001")).toBe("WAITME0001");
    expect(normalizeTxn("d i q\t55js1ed\n")).toBe("DIQ55JS1ED");
  });

  it("accepts 10 letters and numbers without requiring a leading D", () => {
    expect(isValidTxn("DIQ55JS1ED")).toBe(true);
    expect(isValidTxn("WAITME0001")).toBe(true);
    expect(isValidTxn("ABC")).toBe(false);
    expect(isValidTxn("DIQ55JS1ED1")).toBe(false);
    expect(isValidTxn("diq55js1ed")).toBe(false);
    expect(isValidTxn("DIQ55JS1E-")).toBe(false);
  });
});

describe("messageFor", () => {
  const needsSupport = [
    "INVALID_VERSION",
    "ALREADY_USED",
    "AMOUNT_TOO_LOW",
    "EXPIRED",
    "NOT_FOUND",
    "INVALID_TICKET",
  ];
  const all = [...needsSupport, "INVALID_FORMAT", "RATE_LIMITED", "BOT_CHECK_FAILED"];

  it.each(all)("has a title and text for %s", (code) => {
    const { title, text } = messageFor(code, SUPPORT, "500 ETB");
    expect(title.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(title).not.toBe("No connection");
  });

  it.each(needsSupport)("includes the support contact for %s", (code) => {
    expect(messageFor(code, SUPPORT, "500 ETB").text).toContain(SUPPORT);
  });

  it("uses the design copy", () => {
    expect(messageFor("INVALID_FORMAT", SUPPORT)).toEqual({
      title: "Check the number",
      text: "A transaction number has 10 letters and numbers and starts with D. Copy it from the telebirr app.",
    });
    expect(messageFor("ALREADY_USED", SUPPORT).text).toBe(
      "This transaction number has already been used. If this is your payment, email info@mekinatera.com.",
    );
    expect(messageFor("AMOUNT_TOO_LOW", SUPPORT, "500 ETB").text).toBe(
      "We received less than 500 ETB for this number. Email info@mekinatera.com and we will help.",
    );
    expect(messageFor("RATE_LIMITED", SUPPORT)).toEqual({
      title: "Too many tries",
      text: "Please wait a few minutes and try again.",
    });
  });

  it.each([undefined, "SOMETHING_NEW"])("falls back to the network message for %j", (code) => {
    expect(messageFor(code, SUPPORT)).toEqual({
      title: "No connection",
      text: "Check your internet and try again.",
    });
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [5_000, "0:05"],
    [65_000, "1:05"],
    [600_000, "10:00"],
    [-1, "0:00"],
  ])("%d ms → %s", (ms, label) => {
    expect(formatElapsed(ms)).toBe(label);
  });
});

/** A fake clock + timer queue, so the poller runs deterministically. */
function fakeTimers() {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id: number) => {
      timers.delete(id);
    },
    pending: () => timers.size,
    /** Runs the next timer and lets its async work settle. */
    async step() {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) return false;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return true;
    },
  };
}

describe("createPoller", () => {
  function setup(responses: Array<Result | Error>, opts: Record<string, unknown> = {}) {
    const timers = fakeTimers();
    const fetchStatus = vi.fn(async () => {
      const next = responses.shift() ?? { status: "pending", ticket: "t" };
      if (next instanceof Error) throw next;
      return next;
    });
    const onResult = vi.fn();
    const stop = createPoller({ fetchStatus, onResult, ...timers, ...opts });
    return { timers, fetchStatus, onResult, stop };
  }

  it("polls every 5 s and stops on ok", async () => {
    const { timers, fetchStatus, onResult } = setup([
      { status: "pending", ticket: "t" },
      { status: "ok", downloadUrl: "/d/x" },
    ]);
    expect(fetchStatus).not.toHaveBeenCalled();
    await timers.step();
    expect(timers.now()).toBe(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await timers.step();
    expect(timers.now()).toBe(10000);
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ status: "ok", downloadUrl: "/d/x" });
    expect(timers.pending()).toBe(0);
    expect(await timers.step()).toBe(false);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("stops on error", async () => {
    const { timers, fetchStatus, onResult } = setup([{ status: "error", code: "ALREADY_USED" }]);
    await timers.step();
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ status: "error", code: "ALREADY_USED" });
    expect(timers.pending()).toBe(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("retries after a network error", async () => {
    const { timers, onResult } = setup([
      new Error("offline"),
      { status: "ok", downloadUrl: "/d/x" },
    ]);
    await timers.step();
    expect(onResult).not.toHaveBeenCalled();
    expect(timers.pending()).toBe(1);
    await timers.step();
    expect(onResult).toHaveBeenCalledWith({ status: "ok", downloadUrl: "/d/x" });
  });

  it("reports NOT_FOUND after 10 minutes and stops", async () => {
    const { timers, fetchStatus, onResult } = setup([]);
    while (await timers.step()) {
      // keep polling pending
    }
    expect(timers.now()).toBe(600_000);
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ status: "error", code: "NOT_FOUND" });
    expect(fetchStatus).toHaveBeenCalledTimes(119);
    expect(timers.pending()).toBe(0);
  });

  it("honours a shorter timeout", async () => {
    const { timers, onResult } = setup([], { timeoutMs: 12_000 });
    while (await timers.step()) {
      // keep polling pending
    }
    expect(timers.now()).toBe(12_000);
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ status: "error", code: "NOT_FOUND" });
  });

  it("stop() cancels the next poll and ignores an in-flight result", async () => {
    const timers = fakeTimers();
    let resolve: (r: Result) => void = () => {};
    const fetchStatus = vi.fn(() => new Promise<Result>((r) => (resolve = r)));
    const onResult = vi.fn();
    const stop = createPoller({ fetchStatus, onResult, ...timers });
    await timers.step();
    stop();
    resolve({ status: "ok", downloadUrl: "/d/x" });
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
    expect(timers.pending()).toBe(0);
  });
});
