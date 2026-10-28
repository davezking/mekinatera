import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createOrderWithToken } from "../src/lib/claim";
import { adminFetch } from "./helpers/admin";

const ORIGIN = "http://localhost";
const PDF = new TextEncoder().encode(`%PDF-1.4\n${"x".repeat(2000)}\n%%EOF\n`);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

let dolphinVersionId: number;
let dolphinModelId: number;
let sealionVersionId: number;

function put(
  path: string,
  body: Uint8Array | ReadableStream | null,
  headers: Record<string, string>,
) {
  return adminFetch(path, {
    method: "PUT",
    headers: { Origin: ORIGIN, ...headers },
    body,
    // @ts-expect-error: workerd needs this for a stream body; the DOM type doesn't know it.
    duplex: "half",
  });
}

function putPdf(versionId: number, bytes: Uint8Array = PDF, type = "application/pdf") {
  return put(`/admin/uploads/manual/${versionId}`, bytes, {
    "Content-Type": type,
    "Content-Length": String(bytes.byteLength),
  });
}

async function objectKeys(prefix: string) {
  return (await env.MANUALS.list({ prefix })).objects.map((o) => o.key);
}

async function version(id: number) {
  return env.DB.prepare("SELECT r2_key, file_size, updated_at FROM manual_versions WHERE id = ?")
    .bind(id)
    .first<{ r2_key: string | null; file_size: number | null; updated_at: number }>();
}

beforeEach(async () => {
  const db = env.DB;
  await db.batch(
    [
      "download_tokens",
      "orders",
      "claim_attempts",
      "payments",
      "raw_sms",
      "manual_versions",
      "car_models",
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  for (const o of (await env.MANUALS.list()).objects) await env.MANUALS.delete(o.key);
  await db.batch([
    db.prepare(
      `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
       VALUES ('BYD Dolphin', 'byd-dolphin-2025', '2025', 1, 1, 0, 0),
              ('BYD Sealion', 'byd-sealion-2026', '2026', 1, 2, 0, 0)`,
    ),
    db.prepare(
      `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
       SELECT id, 'en', 50000, NULL, NULL, 1, 0, 0 FROM car_models WHERE slug = 'byd-dolphin-2025'`,
    ),
    db.prepare(
      `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
       SELECT id, 'en', 50000, 'manuals/byd-sealion-2026-en-old.pdf', 9, 1, 0, 0 FROM car_models WHERE slug = 'byd-sealion-2026'`,
    ),
  ]);
  await env.MANUALS.put("manuals/byd-sealion-2026-en-old.pdf", "%PDF-old");
  const ids = await db
    .prepare(
      "SELECT m.slug, m.id AS model_id, v.id AS version_id FROM car_models m JOIN manual_versions v ON v.car_model_id = m.id",
    )
    .all<{ slug: string; model_id: number; version_id: number }>();
  for (const r of ids.results) {
    if (r.slug === "byd-dolphin-2025") {
      dolphinVersionId = r.version_id;
      dolphinModelId = r.model_id;
    } else sealionVersionId = r.version_id;
  }
});

describe("PUT /admin/uploads/manual/:versionId", () => {
  it("stores a PDF and makes the manual buyable (FR-24, FR-3)", async () => {
    expect(await (await SELF.fetch("https://example.com/")).text()).not.toContain(
      'href="/m/byd-dolphin-2025"',
    );

    const res = await putPdf(dolphinVersionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, size: PDF.byteLength });

    const row = await version(dolphinVersionId);
    expect(row?.r2_key).toMatch(/^manuals\/byd-dolphin-2025-en-\d+\.pdf$/);
    expect(row?.file_size).toBe(PDF.byteLength);
    expect(row?.updated_at).toBeGreaterThan(0);
    const object = await env.MANUALS.get(row?.r2_key as string);
    expect(object?.httpMetadata?.contentType).toBe("application/pdf");
    expect(new Uint8Array(await (object as R2ObjectBody).arrayBuffer())).toEqual(PDF);

    const catalog = await (await SELF.fetch("https://example.com/")).text();
    expect(catalog).toContain('href="/m/byd-dolphin-2025"');
    expect((await SELF.fetch("https://example.com/m/byd-dolphin-2025")).status).toBe(200);

    // A download link now serves the uploaded file.
    const token = await createOrderWithToken(env, {
      paymentId: null,
      versionId: dolphinVersionId,
      createdBy: "admin",
      adminNote: null,
      now: Date.now(),
    });
    const download = await SELF.fetch(`https://example.com/d/${token}`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF);
  });

  it("replaces a PDF, deletes the old object, and existing links serve the new file", async () => {
    const token = await createOrderWithToken(env, {
      paymentId: null,
      versionId: sealionVersionId,
      createdBy: "admin",
      adminNote: null,
      now: Date.now(),
    });
    expect(await (await SELF.fetch(`https://example.com/d/${token}`)).text()).toBe("%PDF-old");

    expect((await putPdf(sealionVersionId)).status).toBe(200);
    const keys = await objectKeys("manuals/");
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe("manuals/byd-sealion-2026-en-old.pdf");
    expect(
      new Uint8Array(await (await SELF.fetch(`https://example.com/d/${token}`)).arrayBuffer()),
    ).toEqual(PDF);
  });

  it("rejects a non-PDF renamed .pdf and leaves no object or DB change", async () => {
    const fake = new TextEncoder().encode("just some text, not a pdf");
    const res = await putPdf(dolphinVersionId, fake);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "This file is not a PDF." });
    expect(await objectKeys("manuals/")).toEqual(["manuals/byd-sealion-2026-en-old.pdf"]);
    expect(await version(dolphinVersionId)).toEqual({
      r2_key: null,
      file_size: null,
      updated_at: 0,
    });
  });

  it("keeps the old PDF when a replacement is rejected", async () => {
    await putPdf(sealionVersionId, new TextEncoder().encode("nope"));
    expect((await version(sealionVersionId))?.r2_key).toBe("manuals/byd-sealion-2026-en-old.pdf");
    expect(await objectKeys("manuals/")).toEqual(["manuals/byd-sealion-2026-en-old.pdf"]);
  });

  it("requires Content-Length (411)", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(PDF);
        controller.close();
      },
    });
    const res = await put(`/admin/uploads/manual/${dolphinVersionId}`, stream, {
      "Content-Type": "application/pdf",
    });
    expect(res.status).toBe(411);
    expect(await objectKeys("manuals/byd-dolphin")).toEqual([]);
  });

  it("rejects an oversized Content-Length (413) before reading the body", async () => {
    const res = await put(`/admin/uploads/manual/${dolphinVersionId}`, PDF, {
      "Content-Type": "application/pdf",
      "Content-Length": String(100 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(await objectKeys("manuals/byd-dolphin")).toEqual([]);
  });

  it("rejects the wrong Content-Type (415)", async () => {
    const res = await putPdf(dolphinVersionId, PDF, "text/plain");
    expect(res.status).toBe(415);
  });

  it("returns 404 for an unknown version", async () => {
    expect((await putPdf(999999)).status).toBe(404);
  });

  it("rejects a cross-origin upload", async () => {
    const res = await adminFetch(`/admin/uploads/manual/${dolphinVersionId}`, {
      method: "PUT",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/pdf",
        "Content-Length": String(PDF.byteLength),
      },
      body: PDF,
    });
    expect(res.status).toBe(403);
    expect(await version(dolphinVersionId)).toMatchObject({ r2_key: null });
  });
});

describe("PUT /admin/uploads/image/:modelId", () => {
  function putImage(bytes: Uint8Array, type: string, modelId = dolphinModelId) {
    return put(`/admin/uploads/image/${modelId}`, bytes, {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
    });
  }

  it("stores an image that then shows on the public catalog card", async () => {
    const res = await putImage(PNG, "image/png");
    expect(res.status).toBe(200);
    const key = await env.DB.prepare("SELECT image_key FROM car_models WHERE id = ?")
      .bind(dolphinModelId)
      .first<string>("image_key");
    expect(key).toMatch(/^images\/byd-dolphin-2025-\d+\.png$/);
    expect(await (await SELF.fetch("https://example.com/")).text()).toContain(
      `src="/media/${key}"`,
    );
    const served = await SELF.fetch(`https://example.com/media/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    await served.body?.cancel();
  });

  it("deletes the old image when replaced", async () => {
    await putImage(PNG, "image/png");
    const first = await objectKeys("images/");
    await new Promise((r) => setTimeout(r, 2));
    await putImage(PNG, "image/png");
    const second = await objectKeys("images/");
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
  });

  it("rejects bytes that don't match the declared type", async () => {
    const res = await putImage(PNG, "image/jpeg");
    expect(res.status).toBe(400);
    expect(await objectKeys("images/")).toEqual([]);
  });

  it.each([
    ["an SVG", "image/svg+xml", 415],
    ["a GIF", "image/gif", 415],
  ])("rejects %s", async (_label, type, status) => {
    expect((await putImage(PNG, type)).status).toBe(status);
  });

  it("rejects an image over 5 MB", async () => {
    const res = await put(`/admin/uploads/image/${dolphinModelId}`, PNG, {
      "Content-Type": "image/png",
      "Content-Length": String(5 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });
});

describe("edit page upload controls", () => {
  it("shows Upload for a model without files and Replace with the current file otherwise", async () => {
    const dolphin = await (await adminFetch(`/admin/catalog/${dolphinModelId}`)).text();
    expect(dolphin).toContain("Upload PDF");
    expect(dolphin).toContain(`data-upload-url="/admin/uploads/manual/${dolphinVersionId}"`);
    expect(dolphin).toContain(`data-upload-url="/admin/uploads/image/${dolphinModelId}"`);
    expect(dolphin).toContain('src="/js/admin-upload.js"');

    await putPdf(dolphinVersionId);
    const after = await (await adminFetch(`/admin/catalog/${dolphinModelId}`)).text();
    expect(after).toContain("Replace PDF");
    expect(after).toMatch(/Current: byd-dolphin-2025-en-\d+\.pdf \(2 KB\)/);
  });
});
