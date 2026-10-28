import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Secrets normally come from .dev.vars; tests use the same values as .dev.vars.example.
const DEV_SECRETS = {
  WEBHOOK_SECRET: "dev-webhook-secret",
  TICKET_SECRET: "dev-ticket-secret-change-me-32bytes",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  ADMIN_DEV_BYPASS: "1",
};

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { ...DEV_SECRETS, TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
