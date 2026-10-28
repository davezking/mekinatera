import type { Context } from "hono";
import { Hono } from "hono";
import type { AdminEnv } from "../../admin-env";
import {
  createModelWithVersion,
  getAdminModel,
  listAdminCatalog,
  type ModelFields,
  slugTaken,
  updateModel,
  updateVersion,
} from "../../lib/db/catalog";
import { etbToSantim } from "../../lib/money";
import { nowMs } from "../../lib/time";
import {
  CatalogEdit,
  type CatalogFormErrors,
  type CatalogFormValues,
} from "../../views/admin/catalog-edit";
import { CatalogList } from "../../views/admin/catalog-list";
import { adminPage } from "../../views/admin/layout";

// /admin/catalog: models, their English version and price (FR-24).
export const catalogRoutes = new Hono<AdminEnv>();

const SLUG = /^[a-z0-9-]{3,60}$/;
const MAX_PRICE_SANTIM = 100_000 * 100;

/** Same rule as public/js/admin-slug.js, so a form without JavaScript gets the same slug. */
export function slugify(...parts: string[]): string {
  return parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function readForm(c: Context<AdminEnv>): Promise<CatalogFormValues> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    form = new FormData(); // Not a form post: every required field is reported missing.
  }
  return {
    name: str(form, "name"),
    slug: str(form, "slug"),
    modelYear: str(form, "modelYear"),
    sortOrder: str(form, "sortOrder"),
    visible: form.get("visible") === "1",
    price: str(form, "price"),
    versionVisible: form.get("versionVisible") === "1",
  };
}

type Valid = { model: ModelFields; priceSantim: number };

async function validate(
  db: D1Database,
  values: CatalogFormValues,
  exceptId?: number,
): Promise<{ ok: true; data: Valid } | { ok: false; errors: CatalogFormErrors }> {
  const errors: CatalogFormErrors = {};
  if (!values.name) errors.name = "Enter a name.";
  else if (values.name.length > 100) errors.name = "Use 100 characters or fewer.";

  if (!values.modelYear) errors.modelYear = "Enter the model year.";
  else if (values.modelYear.length > 20) errors.modelYear = "Use 20 characters or fewer.";

  const slug = values.slug || slugify(values.name, values.modelYear);
  if (!SLUG.test(slug)) {
    errors.slug = "Use 3–60 lowercase letters, numbers and dashes.";
  } else if (await slugTaken(db, slug, exceptId)) {
    errors.slug = "Another model already uses this slug.";
  }

  const sortOrder = values.sortOrder === "" ? 0 : Number(values.sortOrder);
  if (!Number.isSafeInteger(sortOrder) || Math.abs(sortOrder) > 99_999) {
    errors.sortOrder = "Enter a whole number.";
  }

  let priceSantim = 0;
  try {
    priceSantim = etbToSantim(values.price);
  } catch {
    priceSantim = Number.NaN;
  }
  if (!values.price) errors.price = "Enter a price.";
  else if (!Number.isSafeInteger(priceSantim)) errors.price = "Enter a number, like 500 or 450.50.";
  else if (priceSantim <= 0) errors.price = "The price must be more than 0.";
  else if (priceSantim > MAX_PRICE_SANTIM) errors.price = "The price can be at most 100,000 ETB.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      model: {
        name: values.name,
        slug,
        modelYear: values.modelYear,
        sortOrder,
        visible: values.visible,
      },
      priceSantim,
    },
  };
}

function idParam(c: Context<AdminEnv>): number | null {
  const id = Number(c.req.param("id"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function formPage(
  c: Context<AdminEnv>,
  props: Parameters<typeof CatalogEdit>[0],
  status: 200 | 400 = 200,
) {
  c.status(status);
  return adminPage(
    c,
    props.modelId === null ? "Add model" : `Edit ${props.values.name}`,
    "/admin/catalog",
    <CatalogEdit {...props} />,
  );
}

catalogRoutes.get("/", async (c) => {
  const rows = await listAdminCatalog(c.env.DB);
  const flash = c.req.query("created") ? "created" : c.req.query("saved") ? "saved" : undefined;
  return adminPage(c, "Catalog", "/admin/catalog", <CatalogList rows={rows} flash={flash} />);
});

const EMPTY: CatalogFormValues = {
  name: "",
  slug: "",
  modelYear: "",
  sortOrder: "0",
  visible: true,
  price: "500",
  versionVisible: true,
};

catalogRoutes.get("/new", (c) => formPage(c, { modelId: null, values: EMPTY }));

catalogRoutes.post("/", async (c) => {
  const values = await readForm(c);
  const result = await validate(c.env.DB, values);
  if (!result.ok) return formPage(c, { modelId: null, values, errors: result.errors }, 400);
  try {
    await createModelWithVersion(c.env.DB, result.data.model, result.data.priceSantim, nowMs());
  } catch (err) {
    // A slug taken between the check and the insert hits the UNIQUE constraint.
    if (String(err).includes("UNIQUE")) {
      const errors = { slug: "Another model already uses this slug." };
      return formPage(c, { modelId: null, values, errors }, 400);
    }
    throw err;
  }
  return c.redirect("/admin/catalog?created=1", 303);
});

catalogRoutes.get("/:id", async (c) => {
  const id = idParam(c);
  const model = id === null ? null : await getAdminModel(c.env.DB, id);
  if (!model) return c.text("Not found", 404);
  return formPage(c, {
    modelId: model.id,
    hasPdf: model.hasPdf,
    values: {
      name: model.name,
      slug: model.slug,
      modelYear: model.modelYear,
      sortOrder: String(model.sortOrder),
      visible: model.visible,
      price: model.priceSantim === null ? "" : String(model.priceSantim / 100),
      versionVisible: model.versionId === null ? true : model.versionVisible,
    },
  });
});

catalogRoutes.post("/:id", async (c) => {
  const id = idParam(c);
  const model = id === null ? null : await getAdminModel(c.env.DB, id);
  if (!model) return c.text("Not found", 404);
  const values = await readForm(c);
  const result = await validate(c.env.DB, values, model.id);
  if (!result.ok) {
    return formPage(
      c,
      { modelId: model.id, hasPdf: model.hasPdf, values, errors: result.errors },
      400,
    );
  }
  const now = nowMs();
  try {
    await updateModel(c.env.DB, model.id, result.data.model, now);
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      const errors = { slug: "Another model already uses this slug." };
      return formPage(c, { modelId: model.id, hasPdf: model.hasPdf, values, errors }, 400);
    }
    throw err;
  }
  await updateVersion(
    c.env.DB,
    model.id,
    { priceSantim: result.data.priceSantim, visible: values.versionVisible },
    now,
  );
  return c.redirect("/admin/catalog?saved=1", 303);
});
