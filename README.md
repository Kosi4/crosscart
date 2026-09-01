# CrossCart

A Chrome extension that saves products from any online store into one local cart, so comparing options across sites doesn't mean a dozen open tabs and a mental tally of what costs what.

A floating "+ Add to CrossCart" button appears on pages it recognizes as product pages. Clicking it opens a small picker right there on the page to choose a list — no need to open the extension itself. The toolbar popup holds everything saved: multiple named lists, quantities, drag-to-reorder, and a running total converted to whichever currency you actually think in.

## Installing

Not on the Chrome Web Store — load it directly:

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select the repo folder

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

Plain JavaScript, Manifest V3, no build step, no dependencies. Content scripts don't reliably support `type="module"`, so instead of a bundler, each file attaches to a shared `window.Crosscart` namespace and the manifest loads them in dependency order.

```
manifest.json
icons/                 extension icon set
shared/                 used by both the content script and the popup
    constants.js          storage keys, supported currencies
    currency.js           currency normalization + formatting
    storage.js            chrome.storage wrapper
    lists.js              list CRUD, dedupe-on-save
content/                 injected into every page
    detect.js               product-page heuristics
    scrape.js               the four-tier scraper, price/title cleanup
    agent-sites.js          site-name stripping
    nav-watch.js             SPA route-change detection (event-driven, no polling)
    picker.js                the in-page "save to list" popup
    content.js                floating button + orchestration
popup/                  the toolbar popup
    popup.js                 state + event wiring
    render.js                DOM rendering
    dnd.js                   drag-and-drop reordering
    currency-rates.js         exchange rate fetch/cache, with a static fallback
```

## Design

Gray, translucent "liquid glass" popup UI — layered backdrop blur, pill-shaped controls — with light/dark mode via `prefers-color-scheme`.
