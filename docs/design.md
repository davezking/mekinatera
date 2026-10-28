# Design — buyer website (approved 2026-10-28)

The approved screens are in `docs/design/*.dc.html` (exported from the design canvas). They are **reference only**: inline styles in a canvas format, never copied into `src/` as-is. Build the real pages in hono/jsx + `public/css/app.css` so they look like these files. When this doc and a `.dc.html` disagree, this doc wins.

| Screen | Reference | Route | Built in |
|---|---|---|---|
| Catalog (mobile + desktop) | `catalog-mobile.dc.html`, `catalog-desktop.dc.html` | `/` | P1-S2-T1 |
| Checkout + claim states | `checkout-mobile.dc.html` | `/m/:slug` | P1-S2-T1 (page), P1-S3-T3 (states) |
| Download link expired | `link-expired-mobile.dc.html` | `/d/:token` (410) | P1-S3-T2 |

## Tokens (`public/css/app.css` `:root`)

```css
--bg: #F5F6F8;        /* page background */
--surface: #FFFFFF;   /* cards, header */
--surface-2: #EEF1F5; /* image tiles, step bullets, pills */
--surface-3: #F2F4F7; /* disabled/"in progress" blocks */
--ink: #0E1116;       /* text, dark price card, dark buttons */
--ink-2: #344054;     /* secondary text on light */
--muted: #475467;     /* captions (passes 4.5:1 on --bg) */
--faint: #98A2B3;     /* drawings, placeholders only, never text */
--line: #E4E7EC;      /* card borders */
--line-2: #D0D5DD;    /* input + secondary button borders */
--accent: #1D4ED8;    /* primary buttons, links, logo tile */
--accent-ink: #1E3A8A;/* link hover */
--accent-soft: #EEF4FF;
--ok: #067647;  --ok-soft: #DCFAE6;
--warn-ink: #78350F; --warn-soft: #FEF3C7;
--err-ink: #912018; --err-soft: #FEF3F2; --err-line: #FECDCA; --err-strong: #D92D20;
--radius-s: 12px; --radius-m: 14px; --radius-l: 20px; --radius-pill: 999px;
```

Radii: buttons/inputs 12–14px, cards 20px (22px desktop), pills fully round. Spacing on a 4px grid; mobile page padding 16–20px; card padding 16–20px.

## Type

- **Sora** 600/700: headings, prices, brand name. Letter-spacing −0.01 to −0.03em on large sizes.
- **Inter** 400/500/600: everything else. Base 16px, line-height 1.5–1.55.
- **JetBrains Mono** 500/600: transaction numbers, the telebirr phone number, step numerals ("01"). Tabular, easy to read 0/O and 1/I.
- Self-host all three as woff2 in `public/fonts/` (latin subset; from the `@fontsource` packages, OFL licence) with `font-display: swap`. No Google Fonts requests, so the CSP stays `'self'`.
- Sizes (mobile → desktop): h1 32 → 56px, section h2 22 → 34px, card title 18 → 20px, price 18px in cards, 34px in the checkout price card.

## Components

- **Header**: white bar with a bottom border; logo tile (34px, accent background, white book-with-bolt stroke icon) + "BYD Manuals" in Sora 700; "English" pill on the right (mobile). Desktop: nav links Manuals · How it works · Help.
- **Primary button**: accent background, white 600 text, min-height 52–54px, radius 14px. **Dark button** ("Get manual", "Back to manuals"): `--ink` background. **Secondary**: white, `--line-2` border. All tap targets ≥ 44px.
- **Model card**: white, 1px `--line` border, radius 20px; a 150px (`190px` desktop) `--surface-2` tile with the outline car drawing (from the reference SVG; never BYD photos or logos); name + "YEAR · English owner's manual"; price "500 ETB" with a smaller muted "ETB"; "Get manual" dark button. Unavailable: "Coming soon" pill on the tile, and a `--surface-3` "Translation in progress" block instead of the button.
- **Price card (checkout)**: `--ink` background, white Sora 34px price, "Translated from the Chinese original" on the right.
- **Pay card**: numbered steps with 26px round `--surface-2` numerals. The phone box shows the number in mono, formatted `0977 328 406`, with "telebirr shows: **{TELEBIRR_NAME}**" below and a **Copy** button that copies the digits without spaces and shows "Copied" for 1.6 s.
- **Notices**: warn = `--warn-soft` / `--warn-ink` with a triangle or clock icon; error = `--err-soft` / `--err-ink` / `--err-line` border, `role="alert"`; success icon = 48px `--ok-soft` circle with a `--ok` check.
- **Transaction input**: 58px tall, mono 22px 600, letter-spacing 0.12em, placeholder `D•••••••••`, border `--line-2` (1.5px) or `--err-strong` on error, followed by the hint "Copy it from the telebirr app. It starts with **D** and has 10 letters and numbers."
- **Icons**: inline stroke SVG (2px, round caps) copied from the references. No emoji, no icon fonts.
- **No** gradients, shadows-as-decoration, or coloured left-border cards.

## Claim states (checkout claim card)

| State | Shows |
|---|---|
| idle | label "Transaction number", input, hint, accent button "Get my PDF" |
| checking | same, button "Checking…" with a spinner, disabled |
| error | error notice (title + text) above the form; input border red; form stays usable |
| waiting | form replaced by: 64px `--accent-soft` circle with spinner, "Waiting for telebirr confirmation", "Keep this page open. It usually takes under a minute.", a pill "`TXN` · m:ss", "We check every 5 seconds for up to 10 minutes.", and a secondary "Use a different number" |
| success | check icon + "Payment confirmed" + txn in mono, green (`--ok`) "Download PDF" button with a download icon, the warn notice "**Save the PDF to your phone now.** This link works for 24 hours and up to 3 downloads. There are no accounts, so we can't show it again.", and "Use a different number" |

Error copy (title / text; `{SUPPORT}` = `SUPPORT_CONTACT`):
- INVALID_FORMAT: "Check the number" / "A transaction number has 10 letters and numbers and starts with D. Copy it from the telebirr app."
- ALREADY_USED: "Already used" / "This transaction number has already been used. If this is your payment, email {SUPPORT}."
- AMOUNT_TOO_LOW: "Amount too low" / "We received less than {PRICE} for this number. Email {SUPPORT} and we will help."
- EXPIRED: "Payment too old" / "This payment is older than 7 days. Email {SUPPORT} with the number."
- NOT_FOUND (after 10 min): "Payment not found yet" / "We haven't received this payment. Check the number, or email {SUPPORT}."
- RATE_LIMITED: "Too many tries" / "Please wait a few minutes and try again."
- BOT_CHECK_FAILED: "Couldn't verify" / "Please reload the page and try again."
- network error: "No connection" / "Check your internet and try again."

## Responsive

One fluid layout, mobile first. At ≥ 900px: hero becomes two columns (text + the dark "How it works" card), model cards go into `repeat(auto-fill, minmax(280px, 1fr))`, and the FAQ sits beside its heading. Content max-width 1120px. The checkout stays a single centred column (max-width 34rem) on all widths.

## Copy that is fixed

- Hero: eyebrow "For China-import BYD owners in Ethiopia"; h1 "Your BYD owner's manual, in English."; sub "Translated from the Chinese original. Pay with telebirr and download the PDF in about a minute. No account needed."
- Footer: "Independent English translations of BYD owner's manuals for China-market cars. Not affiliated with BYD." + "Help: {SUPPORT}".
- FAQ (catalog, all widths): the four questions in `catalog-desktop.dc.html`.

## Non-production banner

On every public page when `ENVIRONMENT !== "production"`: a full-width `--warn-soft` strip above the header: "Test site. Do not send real payments here." (Staging shows real-looking pay instructions with test values.)
