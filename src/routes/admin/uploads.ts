import type { Context } from "hono";
import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";
import { nowMs } from "../../lib/time";

// /admin/uploads: raw-body PUTs streamed straight into R2 (architecture.md, risk 6). The body is
// never buffered or parsed: no arrayBuffer(), formData(), blob() or text() on the request.
export const uploadsRoutes = new Hono<AdminEnv>();

const MB = 1024 * 1024;
const MAX_PDF_BYTES = 100 * MB;
const MAX_IMAGE_BYTES = 5 * MB;

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": {
    ext: "png",
    magic: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  },
  "image/webp": {
    ext: "webp",
    magic: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
};

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

function fail(c: Context<AdminEnv>, status: 400 | 404 | 411 | 413 | 415, error: string) {
  return c.json({ ok: false, error }, status);
}

function idParam(c: Context<AdminEnv>, name: string): number | null {
  const id = Number(c.req.param(name));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The declared body size, or an error response (411 if missing, 413 if too big). */
function contentLength(c: Context<AdminEnv>, max: number): number | Response {
  const header = c.req.header("Content-Length");
  if (header === undefined || header === "") return fail(c, 411, "Content-Length is required.");
  const size = Number(header);
  if (!/^\d+$/.test(header) || !Number.isSafeInteger(size)) {
    return fail(c, 400, "Invalid Content-Length.");
  }
  if (size === 0) return fail(c, 400, "The file is empty.");
  if (size > max) return fail(c, 413, `The file is larger than ${max / MB} MB.`);
  return size;
}

/** The first `length` bytes of a stored object, read with a ranged get (never the whole file). */
async function head(bucket: R2Bucket, key: string, length: number): Promise<Uint8Array> {
  const part = await bucket.get(key, { range: { offset: 0, length } });
  if (!part) return new Uint8Array();
  return new Uint8Array(await part.arrayBuffer()); // at most `length` bytes
}

/** Streams the request body into R2 under `key`. */
async function streamToR2(c: Context<AdminEnv>, key: string, contentType: string) {
  const body = c.req.raw.body;
  if (!body) return null;
  return c.env.MANUALS.put(key, body, { httpMetadata: { contentType } });
}

uploadsRoutes.put("/manual/:versionId", async (c) => {
  const versionId = idParam(c, "versionId");
  const version =
    versionId === null
      ? null
      : await c.env.DB.prepare(
          `SELECT v.id, v.r2_key, m.slug FROM manual_versions v JOIN car_models m ON m.id = v.car_model_id
           WHERE v.id = ?`,
        )
          .bind(versionId)
          .first<{ id: number; r2_key: string | null; slug: string }>();
  if (!version) return fail(c, 404, "Manual not found.");

  const type = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/pdf") return fail(c, 415, "Upload a PDF file.");
  const size = contentLength(c, MAX_PDF_BYTES);
  if (size instanceof Response) return size;

  const key = `manuals/${version.slug}-en-${nowMs()}.pdf`;
  const stored = await streamToR2(c, key, "application/pdf");
  if (!stored) return fail(c, 400, "The file is empty.");

  if (ascii(await head(c.env.MANUALS, key, 5), 0, 5) !== "%PDF-") {
    await c.env.MANUALS.delete(key);
    return fail(c, 400, "This file is not a PDF.");
  }
  try {
    await c.env.DB.prepare(
      "UPDATE manual_versions SET r2_key = ?, file_size = ?, updated_at = ? WHERE id = ?",
    )
      .bind(key, stored.size, nowMs(), version.id)
      .run();
  } catch (err) {
    await c.env.MANUALS.delete(key);
    throw err;
  }
  // Download links look up r2_key on every request, so they serve the new file from now on.
  if (version.r2_key && version.r2_key !== key) await c.env.MANUALS.delete(version.r2_key);
  console.log(
    JSON.stringify({ event: "manual_uploaded", versionId: version.id, size: stored.size }),
  );
  return c.json({ ok: true, size: stored.size });
});

uploadsRoutes.put("/image/:modelId", async (c) => {
  const modelId = idParam(c, "modelId");
  const model =
    modelId === null
      ? null
      : await c.env.DB.prepare("SELECT id, slug, image_key FROM car_models WHERE id = ?")
          .bind(modelId)
          .first<{ id: number; slug: string; image_key: string | null }>();
  if (!model) return fail(c, 404, "Model not found.");

  const type = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const image = IMAGE_TYPES[type];
  if (!image) return fail(c, 415, "Upload a JPEG, PNG or WebP image.");
  const size = contentLength(c, MAX_IMAGE_BYTES);
  if (size instanceof Response) return size;

  const key = `images/${model.slug}-${nowMs()}.${image.ext}`;
  const stored = await streamToR2(c, key, type);
  if (!stored) return fail(c, 400, "The file is empty.");

  if (!image.magic(await head(c.env.MANUALS, key, 12))) {
    await c.env.MANUALS.delete(key);
    return fail(c, 400, "This file is not the image type it claims to be.");
  }
  try {
    await c.env.DB.prepare("UPDATE car_models SET image_key = ?, updated_at = ? WHERE id = ?")
      .bind(key, nowMs(), model.id)
      .run();
  } catch (err) {
    await c.env.MANUALS.delete(key);
    throw err;
  }
  if (model.image_key && model.image_key !== key) await c.env.MANUALS.delete(model.image_key);
  console.log(JSON.stringify({ event: "image_uploaded", modelId: model.id, size: stored.size }));
  return c.json({ ok: true, size: stored.size });
});
