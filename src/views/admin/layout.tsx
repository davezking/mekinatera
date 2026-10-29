import type { Context } from "hono";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";
import type { AdminEnv } from "../../admin-env";
import { LogoIcon } from "../layout";
import { StatusBanner } from "./status-banner";

const NAV = [
  ["Dashboard", "/admin"],
  ["Catalog", "/admin/catalog"],
  ["Payments", "/admin/payments"],
  ["SMS", "/admin/payments/sms"],
  ["Orders", "/admin/payments/orders"],
] as const;

type AdminLayoutProps = {
  title: string;
  /** Path of the current page, to mark its nav link. */
  current: string;
  adminEmail: string;
  publicSiteUrl: string;
  env: string;
  /** Phone status banner (FR-27); rendered into #status-banner. */
  banner?: Child;
  children?: Child;
};

export function AdminLayout({
  title,
  current,
  adminEmail,
  publicSiteUrl,
  env,
  banner,
  children,
}: AdminLayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{`${title} · Admin · BYD Manuals`}</title>
        <link rel="stylesheet" href="/css/app.css" />
      </head>
      <body class="admin">
        {env !== "production" && (
          <div class="test-banner" role="note">
            Admin ({env}). Test data only.
          </div>
        )}
        <header class="site-header">
          <div class="site-header__inner">
            <a href="/admin" class="brand">
              <span class="brand__tile">
                <LogoIcon />
              </span>
              <span class="brand__name">Admin</span>
            </a>
            <nav class="site-nav admin-nav" aria-label="Admin">
              {NAV.map(([label, href]) => (
                <a href={href} aria-current={href === current ? "page" : undefined}>
                  {label}
                </a>
              ))}
            </nav>
            <span class="pill" title="Signed in">
              {adminEmail}
            </span>
          </div>
        </header>
        <main class="site-main">
          <div class="container stack">
            <div id="status-banner">{banner}</div>
            {children}
            <p class="muted">
              <a href={publicSiteUrl}>View public site</a>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}

/** Renders a full admin page. Later admin routes use this too. */
export function adminPage(c: Context<AdminEnv>, title: string, current: string, body: JSX.Element) {
  const phone = c.get("phone");
  return c.html(
    <>
      {raw("<!doctype html>")}
      <AdminLayout
        title={title}
        current={current}
        adminEmail={c.get("adminEmail")}
        publicSiteUrl={c.env.PUBLIC_SITE_URL}
        env={c.env.ENVIRONMENT}
        banner={phone && <StatusBanner status={phone.status} now={phone.now} />}
      >
        {body}
      </AdminLayout>
    </>,
  );
}
