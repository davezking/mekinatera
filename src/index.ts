import { Hono } from "hono";
import type { AppEnv } from "./env";
import { apiRoutes } from "./routes/api";
import { claimRoutes } from "./routes/claim";
import { downloadRoutes } from "./routes/download";
import { heartbeatRoutes } from "./routes/heartbeat";
import { publicRoutes } from "./routes/public";
import { webhookRoutes } from "./routes/webhook";

// PUBLIC Worker. Never mount admin routes here: admin is a separate Worker (wrangler.admin.jsonc).
const app = new Hono<AppEnv>();

app.use(async (c, next) => {
  await next();
  if (c.env.ENVIRONMENT !== "production") {
    c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
});

app.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// More specific /api mounts first so they win over apiRoutes.
app.route("/api/claim", claimRoutes);
app.route("/api/sms-webhook", webhookRoutes);
app.route("/api/heartbeat", heartbeatRoutes);
app.route("/api", apiRoutes);
app.route("/d", downloadRoutes);
app.route("/", publicRoutes);

export default app;
