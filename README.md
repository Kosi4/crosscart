# CrossCart

Save products from any online store into one cart, with one running total in your currency, so comparing options across sites doesn't mean a dozen open tabs and a mental tally of what costs what.

- **Chrome extension:** a floating "+ Add to CrossCart" button on product pages. It reads the product's name, price, picture and the size/colour you picked, and a small picker saves it to one of your carts. The toolbar popup holds your carts: quantities, drag-to-reorder, renaming, totals.
- **Web app (`web/`):** the same carts on a bigger screen, grouped by store, with size/colour pickers and an estimate of what everything would cost. Paying every store at once ("pay once") is coming later; for now checkout is a waitlist.
- **Account sync:** sign in with Google or an email link and your carts follow you between devices (Supabase).

## Running it locally

1. Clone this repo
2. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → the repo folder
3. Serve the web app from the repo root: `python3 -m http.server 55983`, then open `http://localhost:55983/web/`

Checks (plain Node, no install): `node tests/sync.check.js`, `pricing`, `lists`, `release`. The popup and scraper checks (`popup.check.js`, `scrape.check.js`) need jsdom and saved store pages in `../crosscart-dev`.

Release: set `PROD_WEB_ORIGIN` in `shared/config.js`, then `node scripts/release.js` builds `dist/crosscart-<version>.zip` for the Chrome Web Store. The web app is hosted on Cloudflare Pages: build command `sh scripts/pages-build.sh`, output directory `site` (headers and redirects in `hosting/`).

## The scraping problem

There's no API for "get me this product's title, price, and image" that works across arbitrary stores, so the content script tries four sources in order and keeps the first usable value for each field:

```
JSON-LD Product data  →  Open Graph meta tags  →  microdata  →  DOM heuristics
(most structured)                                              (h1, largest image,
                                                                 a text-node price scan)
```

Most stores expose at least one of the first three. The DOM fallback exists for the ones that don't, and it's scoped to the actual product summary rather than the whole page — the first `.price`-ish element on a page is often a "related products" carousel or a prev/next navigation widget showing a *different* product's price, not the one being viewed. Getting this wrong silently produces a plausible-looking but wrong result, which is worse than an obvious failure, so the scanner requires a scope to actually contain a price before accepting it rather than taking the first matching element.

Two other things structured data gets wrong often enough to handle explicitly:

- **`image` isn't always a URL.** schema.org allows it to be an `ImageObject` or an array of either. Treating it as a plain string silently stores `"[object Object]"` as the image `src`.
- **Some sites HTML-encode their own JSON-LD.** A title arrives as `"Supply &amp; Demand Men&apos;s Jacket"`. Decoded once at scrape time via a small fixed entity table, since running this against untrusted scraped markup rules out an `innerHTML` round-trip.

Titles also get a site name stripped off (`"Hoodie | Some Store"` → `"Hoodie"`), matched against `og:site_name`, the page's own JSON-LD, or the domain — not just "drop whatever's after the last `|`", which would also mutilate a real product name like `"Denim Jacket - Black Wash"`.

## Pricing and sales

Number formats aren't universal (`$1,499.95` vs `R1 499,95` vs `1.234,56 €`), and a sale page usually has both the current price and a struck-through original on screen at once. The parser normalizes formats by locating the actual decimal separator rather than assuming one, and prefers `<ins>`/sale-marked elements over `del`/compare-at ones so a discounted item resolves to what you'd actually pay, not the original list price.

## Structure

Plain JavaScript, Manifest V3, no build step, no runtime dependencies. Content scripts don't reliably support `type="module"`, so each file attaches to a shared `window.Crosscart` namespace and pages load them in dependency order.

```
manifest.json
background/sync.js       service worker: the extension's own sign-in session, two-way sync with Supabase
content/                 injected into store pages
    detect.js              is this a product page?
    scrape.js              the four-tier scraper, variants, price/title cleanup
    agent-sites.js         site-name stripping
    nav-watch.js           single-page-app route changes
    picker.js              the in-page "save to cart" picker (follows light/dark)
    content.js             floating button
    web-bridge.js          connects the web app to the extension's storage
shared/                  used by the extension and the web app
    config.js              the web app's address and error-report endpoint (one place)
    constants.js, currency.js, currency-rates.js, lists.js, pricing.js, storage.js, theme.js, dnd.js, dom.js
    monitor.js             uncaught errors → Sentry (via supabase/functions/report-error)
    tokens.css             colours, radii, Instrument Sans
popup/                   the toolbar popup
web/                     web app (index.html, js/, css/, privacy.html, terms.html)
supabase/                database migrations and edge functions (extension-link, report-error)
scripts/release.js       builds the Chrome Web Store zip
tests/                   node checks
```

## Design

Grey, translucent "liquid glass" surfaces with pill controls and Instrument Sans for headings, from a Claude Design handoff. Light and dark mode are a setting shared by the popup, web app and the in-page button.
