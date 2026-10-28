import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listCatalog } from "../lib/db/catalog";

// Public JSON API.
export const apiRoutes = new Hono<AppEnv>();

// architecture.md §5: [{slug, name, modelYear, imageUrl, versions:[{id, language, priceEtb, available}]}]
apiRoutes.get("/models", async (c) => {
  const models = await listCatalog(c.env.DB);
  return c.json(
    models.map((m) => ({
      slug: m.slug,
      name: m.name,
      modelYear: m.modelYear,
      imageUrl: m.imageUrl,
      versions: m.version
        ? [
            {
              id: m.version.id,
              language: m.version.language,
              // Integer santim → ETB number at the edge (exact for two decimals).
              priceEtb: m.version.priceSantim / 100,
              available: m.version.available,
            },
          ]
        : [],
    })),
  );
});
