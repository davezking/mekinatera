import { Hono } from "hono";
import type { AdminEnv } from "./admin-env";
import { securityHeaders } from "./middleware/security";
import { adminRoutes } from "./routes/admin";

// ADMIN Worker (wrangler.admin.jsonc). Never import this from src/index.ts.
export const adminApp = new Hono<AdminEnv>();

// Same CSP and headers as the public Worker; every admin response is noindex.
adminApp.use(securityHeaders("admin"));

adminApp.get("/", (c) => c.redirect("/admin"));
adminApp.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));
adminApp.route("/admin", adminRoutes);
adminApp.notFound((c) => c.text("Not found", 404));

export default adminApp;
