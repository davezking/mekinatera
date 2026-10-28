import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowMs } from "../lib/time";
import { hashToken } from "../lib/token";
import { downloadErrorDocument } from "../views/download-error";

// Download endpoint (/d/:token): the only way a manual PDF leaves R2.
export const downloadRoutes = new Hono<AppEnv>();

/** generateToken(): 32 bytes as unpadded base64url. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const RANGE_FORMAT = /^bytes=(\d+)-(\d*)$/;

type DownloadRow = {
  id: number;
  order_id: number;
  expires_at: number;
  max_downloads: number;
  download_count: number;
  revoked_at: number | null;
  version_id: number;
  r2_key: string | null;
  name: string;
  model_year: string;
};

const NO_INDEX = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
};

function errorPage(c: Context<AppEnv>, kind: "expired" | "failed") {
  for (const [k, v] of Object.entries(NO_INDEX)) c.header(k, v);
  return c.html(downloadErrorDocument(kind, c.env), kind === "expired" ? 410 : 500);
}

/** "BYD Sealion", "2026" → "BYD-Sealion-2026-EN.pdf" (ASCII letters, digits, "-" only). */
export function pdfFilename(name: string, year: string): string {
  const safe = `${name} ${year}`
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
  return `${safe.startsWith("BYD") ? "" : "BYD-"}${safe || "manual"}-EN.pdf`;
}

/** `bytes=start-` or `bytes=start-end`; null for anything else (treated as a full download). */
export function parseRange(header: string | undefined): { start: number; end?: number } | null {
  const m = header ? RANGE_FORMAT.exec(header.trim()) : null;
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  if (
    !Number.isSafeInteger(start) ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < start))
  ) {
    return null;
  }
  return { start, end };
}

downloadRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!TOKEN_FORMAT.test(token)) return errorPage(c, "expired");

  const now = nowMs();
  const row = await c.env.DB.prepare(
    `SELECT t.id, t.order_id, t.expires_at, t.max_downloads, t.download_count, t.revoked_at,
            v.id AS version_id, v.r2_key, m.name, m.model_year
     FROM download_tokens t
     JOIN orders o ON o.id = t.order_id
     JOIN manual_versions v ON v.id = o.manual_version_id
     JOIN car_models m ON m.id = v.car_model_id
     WHERE t.token_hash = ?`,
  )
    .bind(await hashToken(token))
    .first<DownloadRow>();
  if (
    !row ||
    row.revoked_at !== null ||
    row.expires_at <= now ||
    row.download_count >= row.max_downloads
  ) {
    return errorPage(c, "expired");
  }

  if (!row.r2_key) {
    console.log(JSON.stringify({ event: "r2_missing", versionId: row.version_id }));
    return errorPage(c, "failed");
  }

  // A resumed download (range starting after byte 0) doesn't use up one of the downloads.
  const range = parseRange(c.req.header("Range"));
  let count = row.download_count;
  if (!range || range.start === 0) {
    const result = await c.env.DB.prepare(
      `UPDATE download_tokens SET download_count = download_count + 1
       WHERE id = ? AND download_count < max_downloads AND expires_at > ? AND revoked_at IS NULL`,
    )
      .bind(row.id, now)
      .run();
    if (result.meta.changes !== 1) return errorPage(c, "expired");
    count += 1;
  }

  // For a range, read the size first: R2 rejects a range that starts past the end.
  let served: { offset: number; end: number } | null = null;
  let object: R2ObjectBody | null = null;
  if (range) {
    const head = await c.env.MANUALS.head(row.r2_key);
    if (head && range.start >= head.size) {
      return c.body(null, 416, { ...NO_INDEX, "Content-Range": `bytes */${head.size}` });
    }
    if (head) {
      const end = Math.min(range.end ?? head.size - 1, head.size - 1);
      served = { offset: range.start, end };
      object = await c.env.MANUALS.get(row.r2_key, {
        range: { offset: range.start, length: end - range.start + 1 },
      });
    }
  } else {
    object = await c.env.MANUALS.get(row.r2_key);
  }
  if (!object) {
    console.log(JSON.stringify({ event: "r2_missing", versionId: row.version_id }));
    return errorPage(c, "failed");
  }

  console.log(JSON.stringify({ event: "download", orderId: row.order_id, count }));
  const headers: Record<string, string> = {
    ...NO_INDEX,
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${pdfFilename(row.name, row.model_year)}"`,
    "Accept-Ranges": "bytes",
  };
  if (served) {
    headers["Content-Range"] = `bytes ${served.offset}-${served.end}/${object.size}`;
    headers["Content-Length"] = String(served.end - served.offset + 1);
    return new Response(object.body, { status: 206, headers });
  }
  headers["Content-Length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
});
