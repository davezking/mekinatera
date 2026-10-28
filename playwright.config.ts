import { defineConfig, devices } from "@playwright/test";

/** The admin Worker (wrangler.admin.jsonc); it shares local D1/R2 with the public one. */
export const ADMIN_URL = "http://localhost:8788";

export default defineConfig({
  testDir: "e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8787",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "pnpm e2e:server",
      url: "http://localhost:8787/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Waits for the public server, which resets and seeds the shared local database first.
      command: "pnpm e2e:admin-server",
      url: `${ADMIN_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
