import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { securityHeaders } from "./middleware/security";
import { apiRoutes } from "./routes/api";
import { claimRoutes } from "./routes/claim";
import { downloadRoutes } from "./routes/download";
import { heartbeatRoutes } from "./routes/heartbeat";
import { publicRoutes } from "./routes/public";
import { webhookRoutes } from "./routes/webhook";
import { errorDocument } from "./views/error";

// PUBLIC Worker. Never mount admin routes here: admin is a separate Worker (wrangler.admin.jsonc).
const app = new Hono<AppEnv>();

// CSP, nosniff, referrer and permissions policies; noindex outside production and on /d/*.
app.use(securityHeaders("public"));

app.get("/healthz", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// More specific /api mounts first so they win over apiRoutes.
app.route("/api/claim", claimRoutes);
app.route("/api/sms-webhook", webhookRoutes);
app.route("/api/heartbeat", heartbeatRoutes);
app.route("/api", apiRoutes);
app.route("/d", downloadRoutes);
app.route("/", publicRoutes);

/** JSON for /api/*, a friendly HTML page for everything else. */
function errorResponse(c: Context<AppEnv>, status: 404 | 500) {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({ error: status === 404 ? "not_found" : "internal_error" }, status);
  }
  return c.html(errorDocument(status, c.env), status);
}

app.notFound((c) => errorResponse(c, 404));

// Logs only the path and the error message: never the request body, headers or stack.
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  console.log(
    JSON.stringify({
      event: "unhandled_error",
      path: new URL(c.req.url).pathname,
      message: message.slice(0, 200),
    }),
  );
  return errorResponse(c, 500);
});

export default app;
