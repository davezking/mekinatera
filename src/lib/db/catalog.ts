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
