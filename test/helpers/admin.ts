import { env } from "cloudflare:test";
import type { AdminBindings } from "../../src/admin-env";
import { adminApp } from "../../src/admin-worker";

export const TEST_ACCESS = {
  ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
  ACCESS_AUD: "test-aud",
  ADMIN_EMAIL: "owner@example.com",
  PUBLIC_SITE_URL: "http://localhost:8787",
};

/**
 * Calls the admin Worker in-process with the test D1/R2 bindings. By default the dev bypass
 * applies (development + flag + localhost); pass `{ ENVIRONMENT: "production" }` to test the JWT.
 */
export function adminFetch(
  path: string,
  init?: RequestInit,
  envOverrides: Partial<AdminBindings> = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `http://localhost${path}`;
  const bindings = { ...env, ...TEST_ACCESS, ADMIN_DEV_BYPASS: "1", ...envOverrides };
  return Promise.resolve(adminApp.request(url, init, bindings));
}
