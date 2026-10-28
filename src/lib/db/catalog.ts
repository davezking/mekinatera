import type { ManualLanguage } from "./types";

/** Public catalog entry. Never carries R2 keys: only whether a PDF exists. */
export type CatalogVersion = {
  id: number;
  language: ManualLanguage;
  priceSantim: number;
  available: boolean;
};

export type CatalogModel = {
  slug: string;
  name: string;
  modelYear: string;
  imageUrl: string | null;
  /** The visible `en` version, if any. */
  version: CatalogVersion | null;
  /** A visible `en` version with an uploaded PDF exists (FR-3). */
  available: boolean;
};

export type CheckoutModel = {
  slug: string;
  name: string;
  modelYear: string;
  imageUrl: string | null;
  version: CatalogVersion & { fileSize: number | null };
};

type CatalogJoinRow = {
  slug: string;
  name: string;
  model_year: string;
  image_key: string | null;
  version_id: number | null;
  language: ManualLanguage | null;
  price_santim: number | null;
  file_size: number | null;
  has_pdf: 0 | 1 | null;
};

const CATALOG_SELECT = `
SELECT m.slug, m.name, m.model_year, m.image_key,
       v.id AS version_id, v.language, v.price_santim, v.file_size,
       CASE WHEN v.id IS NULL THEN NULL WHEN v.r2_key IS NOT NULL THEN 1 ELSE 0 END AS has_pdf
FROM car_models m
LEFT JOIN manual_versions v
  ON v.car_model_id = m.id AND v.language = 'en' AND v.is_visible = 1
WHERE m.is_visible = 1`;

/** Only `images/` keys are public; anything else falls back to the placeholder. */
export function imageUrlFor(imageKey: string | null): string | null {
  return imageKey?.startsWith("images/") ? `/media/${imageKey}` : null;
}

function toVersion(row: CatalogJoinRow): CatalogVersion | null {
  if (row.version_id === null || row.language === null || row.price_santim === null) return null;
  return {
    id: row.version_id,
    language: row.language,
    priceSantim: row.price_santim,
    available: row.has_pdf === 1,
  };
}

export async function listCatalog(db: D1Database): Promise<CatalogModel[]> {
  const { results } = await db
    .prepare(`${CATALOG_SELECT} ORDER BY m.sort_order, m.name`)
    .all<CatalogJoinRow>();
  return results.map((row) => {
    const version = toVersion(row);
    return {
      slug: row.slug,
      name: row.name,
      modelYear: row.model_year,
      imageUrl: imageUrlFor(row.image_key),
      version,
      available: version?.available ?? false,
    };
  });
}

/** The visible model and its visible `en` version, or null if either is missing or hidden. */
export async function getCheckout(db: D1Database, slug: string): Promise<CheckoutModel | null> {
  const row = await db
    .prepare(`${CATALOG_SELECT} AND m.slug = ?`)
    .bind(slug)
    .first<CatalogJoinRow>();
  if (!row) return null;
  const version = toVersion(row);
  if (!version) return null;
  return {
    slug: row.slug,
    name: row.name,
    modelYear: row.model_year,
    imageUrl: imageUrlFor(row.image_key),
    version: { ...version, fileSize: row.file_size },
  };
}

// ---------- Admin (admin Worker only) ----------

/** One row of the admin catalog list: every model, hidden ones too, with its `en` version. */
export type AdminCatalogRow = {
  id: number;
  name: string;
  slug: string;
  modelYear: string;
  visible: boolean;
  sortOrder: number;
  versionId: number | null;
  priceSantim: number | null;
  versionVisible: boolean;
  hasPdf: boolean;
  imageKey: string | null;
};

type AdminJoinRow = {
  id: number;
  name: string;
  slug: string;
  model_year: string;
  is_visible: 0 | 1;
  sort_order: number;
  image_key: string | null;
  version_id: number | null;
  price_santim: number | null;
  version_visible: 0 | 1 | null;
  has_pdf: 0 | 1;
};

const ADMIN_SELECT = `
SELECT m.id, m.name, m.slug, m.model_year, m.is_visible, m.sort_order, m.image_key,
       v.id AS version_id, v.price_santim, v.is_visible AS version_visible,
       (v.r2_key IS NOT NULL) AS has_pdf
FROM car_models m
LEFT JOIN manual_versions v ON v.car_model_id = m.id AND v.language = 'en'`;

function toAdminRow(row: AdminJoinRow): AdminCatalogRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    modelYear: row.model_year,
    visible: row.is_visible === 1,
    sortOrder: row.sort_order,
    imageKey: row.image_key,
    versionId: row.version_id,
    priceSantim: row.price_santim,
    versionVisible: row.version_visible === 1,
    hasPdf: row.has_pdf === 1,
  };
}

export async function listAdminCatalog(db: D1Database): Promise<AdminCatalogRow[]> {
  const { results } = await db
    .prepare(`${ADMIN_SELECT} ORDER BY m.sort_order, m.name`)
    .all<AdminJoinRow>();
  return results.map(toAdminRow);
}

export async function getAdminModel(db: D1Database, id: number): Promise<AdminCatalogRow | null> {
  const row = await db.prepare(`${ADMIN_SELECT} WHERE m.id = ?`).bind(id).first<AdminJoinRow>();
  return row ? toAdminRow(row) : null;
}

/** True if another model (not `exceptId`) already uses this slug. */
export async function slugTaken(db: D1Database, slug: string, exceptId?: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM car_models WHERE slug = ? AND id != ?")
    .bind(slug, exceptId ?? -1)
    .first<{ id: number }>();
  return row !== null;
}

export type ModelFields = {
  name: string;
  slug: string;
  modelYear: string;
  sortOrder: number;
  visible: boolean;
};

/** Creates a model and its `en` version in one batch. Returns the new model id. */
export async function createModelWithVersion(
  db: D1Database,
  model: ModelFields,
  priceSantim: number,
  now: number,
): Promise<number> {
  const [created] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        model.name,
        model.slug,
        model.modelYear,
        model.visible ? 1 : 0,
        model.sortOrder,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO manual_versions (car_model_id, language, price_santim, is_visible, created_at, updated_at)
         SELECT id, 'en', ?, 1, ?, ? FROM car_models WHERE slug = ?`,
      )
      .bind(priceSantim, now, now, model.slug),
  ]);
  const id = created?.results[0]?.id;
  if (id === undefined) throw new Error("car_models insert returned no id");
  return id;
}

export async function updateModel(
  db: D1Database,
  id: number,
  model: ModelFields,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE car_models SET name = ?, slug = ?, model_year = ?, is_visible = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(model.name, model.slug, model.modelYear, model.visible ? 1 : 0, model.sortOrder, now, id)
    .run();
}

/** Sets the price and visibility of a model's `en` version, creating it if it doesn't exist yet. */
export async function updateVersion(
  db: D1Database,
  modelId: number,
  version: { priceSantim: number; visible: boolean },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO manual_versions (car_model_id, language, price_santim, is_visible, created_at, updated_at)
       VALUES (?, 'en', ?, ?, ?, ?)
       ON CONFLICT (car_model_id, language)
       DO UPDATE SET price_santim = excluded.price_santim, is_visible = excluded.is_visible,
                     updated_at = excluded.updated_at`,
    )
    .bind(modelId, version.priceSantim, version.visible ? 1 : 0, now, now)
    .run();
}
