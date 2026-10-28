import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8787",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm e2e:server",
    url: "http://localhost:8787/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
