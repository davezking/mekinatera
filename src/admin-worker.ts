import { Hono } from "hono";
import type { AdminEnv } from "./admin-env";
import { adminRoutes } from "./routes/admin";

// ADMIN Worker (wrangler.admin.jsonc). Never import this from src/index.ts.
export const adminApp = new Hono<AdminEnv>();

adminApp.get("/", (c) => c.redirect("/admin"));
adminApp.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));
adminApp.route("/admin", adminRoutes);
adminApp.notFound((c) => c.text("Not found", 404));

export default adminApp;
