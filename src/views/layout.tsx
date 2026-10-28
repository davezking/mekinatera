import type { Child } from "hono/jsx";
import { TestBanner } from "./test-banner";

type LayoutProps = {
  title: string;
  env: string;
  supportContact: string;
  children?: Child;
};

export function LogoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" />
      <path d="M11 7l-2 4h4l-2 4" />
    </svg>
  );
}

export function Layout({ title, env, supportContact, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{title}</title>
        <link
          rel="preload"
          href="/fonts/inter-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/sora-latin-700-normal.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />
        <link rel="stylesheet" href="/css/app.css" />
      </head>
      <body>
        {env !== "production" && <TestBanner />}
        <header class="site-header">
          <div class="site-header__inner">
            <a href="/" class="brand">
              <span class="brand__tile">
                <LogoIcon />
              </span>
              <span class="brand__name">BYD Manuals</span>
            </a>
            <nav class="site-nav" aria-label="Main">
              <a href="/#manuals">Manuals</a>
              <a href="/#how">How it works</a>
              <a href="/#help">Help</a>
            </nav>
            <span class="pill site-header__lang">English</span>
          </div>
        </header>
        <main class="site-main">{children}</main>
        <footer class="site-footer">
          <div class="site-footer__inner">
            <span>
              Independent English translations of BYD owner's manuals for China-market cars. Not
              affiliated with BYD.
            </span>
            <span>
              Help: <a href={`mailto:${supportContact}`}>{supportContact}</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
