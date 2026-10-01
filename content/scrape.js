window.Crosscart = window.Crosscart || {};

(function () {
  // schema.org allows `image` to be a URL string, an ImageObject, or an array
  // of either. Anything not resolvable to a URL string must come back empty so
  // the merge falls through to og:image instead of storing an object.
  function imageUrl(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const url = imageUrl(entry);
        if (url) return url;
      }
      return '';
    }
    if (value && typeof value === 'object') {
      return typeof value.url === 'string' ? value.url : '';
    }
    return '';
  }

  // Some sites HTML-encode their structured data (jdsports ships
  // "Supply &amp; Demand Men&apos;s" as the JSON-LD name). Decoding once here
  // keeps the stored title as real text; the popup escapes it again at render.
  // Deliberately a fixed table rather than an innerHTML round-trip, since this
  // runs against untrusted scraped markup.
  const ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  function decodeEntities(text) {
    if (typeof text !== 'string' || text.indexOf('&') === -1) return text || '';
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref) => {
      const named = ENTITIES[ref.toLowerCase()];
      if (named) return named;
      if (ref[0] === '#') {
        const code =
          ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch (e) {
            return match;
          }
        }
      }
      return match;
    });
  }

  function normalizeName(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  // "Black Risen King Hoodie | We Are Righteous" -> "Risen King Hoodie - Black".
  // Only drops a trailing segment that actually looks like this site's name
  // (og:site_name, the JSON-LD site node, or the domain label), so a real
  // variant suffix like "Denim Jacket - Black Wash" survives.
  function siteNameCandidates() {
    const found = [];
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite && ogSite.content) found.push(ogSite.content);

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        for (const node of window.Crosscart.detect.collectJsonLdNodes(JSON.parse(script.textContent))) {
          const type = node['@type'];
          const types = Array.isArray(type) ? type : [type];
          if (types.some((t) => typeof t === 'string' && /^(WebSite|Organization)$/i.test(t)) && node.name) {
            found.push(node.name);
          }
        }
      } catch (e) {
        // malformed JSON-LD, skip
      }
    }

    const label = window.location.hostname.replace(/^www\./, '').split('.')[0];
    if (label) found.push(label);

    return found.map(normalizeName).filter(Boolean);
  }

  function stripSiteSuffix(title) {
    if (!title) return '';
    const candidates = siteNameCandidates();
    if (!candidates.length) return title;

    let parts = title.split(/\s*[|–—·]\s*|\s+-\s+/).filter((p) => p.trim());
    // Trailing segments only, and never strip down to nothing.
    while (parts.length > 1) {
      const last = normalizeName(parts[parts.length - 1]);
      const isSiteName =
        last && candidates.some((c) => last === c || last.startsWith(c) || c.startsWith(last));
      if (!isSiteName) break;
      parts = parts.slice(0, -1);
    }

    const stripped = parts.join(' - ').trim();
    return stripped.length >= 3 ? stripped : title;
  }

  // `offers` may be a single Offer, an array of them (one per variant), or an
  // AggregateOffer carrying lowPrice/highPrice instead of price. Prefer an
  // in-stock offer, then the cheapest — that's the sale price when a site
  // lists the discounted variant alongside the full-price one.
  // Farfetch (and some other sites) give priceSpecification as an array of
  // {price, priceCurrency} rather than a single object — same schema.org
  // property, just plural. Normalize to one entry either way.
  function priceSpecOf(offer) {
    const spec = offer && offer.priceSpecification;
    if (!spec) return null;
    return Array.isArray(spec) ? spec[0] || null : spec;
  }

  function offerPrice(offer) {
    if (!offer || typeof offer !== 'object') return '';
    const spec = priceSpecOf(offer);
    const direct =
      offer.price !== undefined && offer.price !== null && offer.price !== ''
        ? offer.price
        : offer.lowPrice !== undefined && offer.lowPrice !== null
          ? offer.lowPrice
          : spec && spec.price;
    return direct === undefined || direct === null || direct === '' ? '' : String(direct);
  }

  function offerCurrency(offer) {
    if (!offer || typeof offer !== 'object') return '';
    const spec = priceSpecOf(offer);
    return offer.priceCurrency || (spec && spec.priceCurrency) || '';
  }

  function pickOffer(offers) {
    const list = (Array.isArray(offers) ? offers : [offers]).filter(
      (o) => o && typeof o === 'object'
    );
    const priced = [];
    for (const offer of list) {
      // AggregateOffer can nest the real offers inside itself.
      const nested = Array.isArray(offer.offers) ? offer.offers : [];
      for (const candidate of [offer, ...nested]) {
        const price = offerPrice(candidate);
        if (!price || !Number.isFinite(Number(price))) continue;
        priced.push({
          price,
          currency: offerCurrency(candidate) || offerCurrency(offer),
          inStock: /InStock|LimitedAvailability/i.test(String(candidate.availability || '')),
        });
      }
    }
    if (!priced.length) return { price: '', currency: '' };

    const inStock = priced.filter((o) => o.inStock);
    const pool = inStock.length ? inStock : priced;
    return pool.reduce((best, o) => (Number(o.price) < Number(best.price) ? o : best));
  }

  function brandName(brand) {
    const b = Array.isArray(brand) ? brand[0] : brand;
    if (!b) return '';
    return String(typeof b === 'object' ? b.name || '' : b).trim();
  }

  function scrapeJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const nodes = window.Crosscart.detect.collectJsonLdNodes(data);
        for (const node of nodes) {
          const type = node['@type'];
          const types = Array.isArray(type) ? type : [type];
          if (!types.some((t) => typeof t === 'string' && /product/i.test(t))) continue;

          // A ProductGroup (Shopify, Farfetch, ...) rarely carries its own `offers` —
          // the price lives on each variant in `hasVariant[].offers` instead.
          const offersSource =
            node.offers ||
            (Array.isArray(node.hasVariant) ? node.hasVariant.map((v) => v.offers).filter(Boolean) : undefined);
          const offer = pickOffer(offersSource);
          return {
            title: node.name || '',
            brand: brandName(node.brand),
            image: imageUrl(node.image),
            price: offer.price,
            currency: offer.currency,
            url: node.url || window.location.href,
          };
        }
      } catch (e) {
        // malformed JSON-LD, skip
      }
    }
    return {};
  }

  function scrapeMetaTags() {
    const get = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.content : '';
    };
    return {
      title: get('meta[property="og:title"]') || document.title || '',
      image: get('meta[property="og:image"]') || '',
      price: get('meta[property="product:price:amount"]') || '',
      currency: get('meta[property="product:price:currency"]') || '',
      url: get('meta[property="og:url"]') || window.location.href,
    };
  }

  function scrapeMicrodata() {
    const scope = document.querySelector('[itemtype*="schema.org/Product"]') || document;
    const get = (prop) => {
      const el = scope.querySelector(`[itemprop="${prop}"]`);
      if (!el) return '';
      return el.getAttribute('content') || el.textContent.trim();
    };
    const image = scope.querySelector('[itemprop="image"]');
    return {
      title: get('name'),
      image: image ? image.getAttribute('src') || image.getAttribute('content') || '' : '',
      price: get('price'),
      currency: get('priceCurrency'),
      url: window.location.href,
    };
  }

  // Size as rendered, not the file's natural size: a hidden mega-menu banner can be
  // the biggest file on the page (cottonon.com) while showing at 0px. Among what's
  // actually on screen outside the header/nav/footer, the biggest wins; ties go to the
  // one shown first (top, then left), which is the gallery's lead photo.
  function findLargestImage() {
    let best = null;
    let bestArea = 0;
    let bestTop = Infinity;
    let bestLeft = Infinity;
    document.querySelectorAll('img').forEach((img) => {
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= 0 || r.left >= window.innerWidth) return;
      if (getComputedStyle(img).visibility === 'hidden') return;
      if (img.closest('header, nav, footer')) return;
      const area = r.width * r.height;
      const top = r.top + window.scrollY;
      if (area > bestArea || (area === bestArea && (top < bestTop || (top === bestTop && r.left < bestLeft)))) {
        best = img;
        bestArea = area;
        bestTop = top;
        bestLeft = r.left;
      }
    });
    if (best) return best.currentSrc || best.src;

    // Nothing rendered yet (e.g. lazy images): fall back to the biggest file.
    document.querySelectorAll('img').forEach((img) => {
      const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
      if (area > bestArea) {
        bestArea = area;
        best = img;
      }
    });
    return best ? best.src : '';
  }

  // Where the real price lives, narrowest first. Scoping matters: the first
  // ".price" on a WooCommerce page belongs to the prev/next product nav widget,
  // not the product being viewed.
  const PRICE_SCOPES = [
    '[itemtype*="schema.org/Product"]',
    '.entry-summary',
    '.summary',
    '.product-summary',
    '[class*="product-info"]',
    '[class*="product-detail"]',
    'main',
  ];

  // Other products on the page, and struck-through "was" prices.
  const PRICE_EXCLUDED = [
    'del',
    's',
    'strike',
    'nav',
    'footer',
    'aside',
    '[class*="related"]',
    '[class*="upsell"]',
    '[class*="cross-sell"]',
    '[class*="products-nav"]',
    '[class*="recommend"]',
    '[class*="also-"]',
    '[class*="carousel"]',
    '[class*="compare"]',
    '[class*="was-price"]',
    '[class*="old-price"]',
    '[class*="regular-price"]',
    '[class*="list-price"]',
    '[class*="strike"]',
  ].join(',');

  // "1 499,95" / "1,499.95" / "1499.95" -> "1499.95". When both separators are
  // present the last one is the decimal point; a lone comma is only a decimal
  // point when exactly two digits follow it.
  function normalizeAmount(raw) {
    let text = String(raw || '').replace(/[\s  ']/g, '');
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      const decimal = lastComma > lastDot ? ',' : '.';
      text = text.replace(decimal === ',' ? /\./g : /,/g, '').replace(',', '.');
    } else if (lastComma > -1) {
      text = /,\d{2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
    }
    const match = text.match(/\d+(?:\.\d+)?/);
    return match ? match[0] : '';
  }

  const PRICE_PATTERN = /(?:\$|€|£|¥|₹|R|USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR)\s*[\d.,\s ]*\d/i;

  function findPriceIn(scope) {
    // itemprop=price is authoritative when present, and often a clean number.
    const tagged = scope.querySelector('[itemprop="price"]:not(del [itemprop="price"])');
    if (tagged && !tagged.closest(PRICE_EXCLUDED)) {
      const value = tagged.getAttribute('content') || tagged.textContent;
      if (value && /\d/.test(value)) return value;
    }

    // Sale/current markers first (<ins> is WooCommerce's sale price) so a
    // discounted item resolves to what you would actually pay.
    const groups = [
      'ins, [class*="price"][class*="sale"], [class*="price"][class*="current"]',
      'ins, [class*="price"], [itemprop="price"]',
    ];
    for (const selector of groups) {
      for (const el of scope.querySelectorAll(selector)) {
        if (el.closest(PRICE_EXCLUDED)) continue;
        if (el.querySelector('[class*="price"], ins')) continue; // prefer the leaf node
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        const match = text.match(PRICE_PATTERN);
        if (match) return match[0];
      }
    }
    return '';
  }

  // Reads element text, so markup that splits the symbol from the amount
  // (WooCommerce wraps "$" in its own span) still resolves.
  function scanCurrencyPrice() {
    // A scope only counts if it actually holds a price. Taking the first
    // element matching a selector is not enough: thesupermade.com's first
    // [class*="product-info"] is a size-and-fit block containing no price,
    // which used to end the search and save the item as 0.
    for (const selector of PRICE_SCOPES) {
      for (const scope of document.querySelectorAll(selector)) {
        const price = findPriceIn(scope);
        if (price) return price;
      }
    }
    return document.body ? findPriceIn(document.body) : '';
  }

  // "Color: Photo Color" / "Size: S" — a near-leaf node whose whole text is
  // "Label: Value" is how most storefronts (Shopify apps, WooCommerce themes)
  // summarize the currently-selected option next to its picker, regardless of
  // the picker's own markup (swatches, buttons, selects all differ).
  const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z\s]{1,20}):\s*(.+)$/;
  const LABEL_STOPWORDS = new Set([
    'note', 'tip', 'ships', 'shipping', 'delivery', 'warning', 'return', 'returns',
    'warranty', 'material', 'care', 'fit', 'sku', 'price', 'free', 'estimated',
  ]);

  function parseLabelValuePairs() {
    const scopes = [];
    for (const selector of PRICE_SCOPES) {
      const found = document.querySelector(selector);
      if (found) scopes.push(found);
    }
    scopes.push(document.body);

    // A narrow scope (e.g. a "Size & Fit" box) can match Size but miss Color
    // entirely — take whichever scope found the most, not just the first hit.
    let best = [];
    for (const scope of scopes) {
      if (!scope) continue;
      const seen = new Set();
      const pairs = [];
      for (const el of scope.querySelectorAll('*')) {
        if (el.children.length > 1) continue;
        const text = el.textContent.trim();
        if (!text || text.length > 60) continue;
        const match = text.match(LABEL_VALUE_RE);
        if (!match) continue;
        const name = match[1].trim();
        const value = match[2].trim();
        const key = name.toLowerCase();
        if (!value || seen.has(key) || LABEL_STOPWORDS.has(key)) continue;
        seen.add(key);
        pairs.push({ name, value });
      }
      if (pairs.length > best.length) best = pairs;
    }
    return best;
  }

  // The last run of 6+ digits in a Shopify variant offer's url/@id is its
  // numeric variant id — the same id the page's own ?variant= query carries.
  function lastLongNumber(value) {
    const matches = String(value || '').match(/\d{6,}/g);
    return matches ? matches[matches.length - 1] : null;
  }

  // Highest-confidence source: JSON-LD ProductGroup lists every variant's
  // price/availability, but (at least on Shopify) never names the option
  // groups — only the DOM does ("Color: Photo Color"). Pair the two: DOM
  // supplies group names in picker order, JSON-LD's variant name suffix
  // ("Photo Color / S") supplies the same values in the same order, and the
  // page's own ?variant= id (embedded in each variant's offer url/@id)
  // says which combination is actually selected right now.
  function propValue(value) {
    if (value && typeof value === 'object') return String(value.name || value.value || '').trim();
    return String(value == null ? '' : value).trim();
  }

  // A closed size picker shows only the chosen value ("31/32 W/L (in)"); an open
  // list or a size guide shows every value, which is ambiguous — so only a single
  // distinct match counts as the selection.
  const PICKER_SCOPES = '[data-testid*="variant" i], [data-testid*="size" i], [class*="variant" i], [id*="variant" i]';

  function shownOption(values) {
    const found = new Set();
    document.querySelectorAll(PICKER_SCOPES).forEach((scope) => {
      scope.querySelectorAll('*').forEach((el) => {
        if (el.children.length) return;
        const text = el.textContent.trim();
        const match = values.find((v) => text === v || text.startsWith(`${v} `));
        if (match) found.add(match);
      });
    });
    return found.size === 1 ? [...found][0] : '';
  }

  // Farfetch (and any site following schema.org properly) declares what varies
  // ("variesBy": ["https://schema.org/size"]) and puts the value on each variant
  // (variant.size = "31/32"). That beats parsing names, whose formats differ per site.
  function scrapeExplicitVariants(node) {
    const props = (Array.isArray(node.variesBy) ? node.variesBy : [node.variesBy])
      .map((p) => String(p || '').split(/[/#]/).pop())
      .filter((p) => p && node.hasVariant.some((v) => propValue(v[p])));
    if (!props.length) return null;

    const label = (p) => p.charAt(0).toUpperCase() + p.slice(1);
    const options = {};
    props.forEach((p) => {
      options[label(p)] = [...new Set(node.hasVariant.map((v) => propValue(v[p])).filter(Boolean))];
    });

    const currentVariantId = new URLSearchParams(window.location.search).get('variant');
    const chosen =
      currentVariantId &&
      node.hasVariant.find((v) =>
        [lastLongNumber((v.offers || {}).url), lastLongNumber(v['@id']), String(v.sku || '')].includes(currentVariantId)
      );

    const selected = {};
    props.forEach((p) => {
      const value = chosen ? propValue(chosen[p]) : shownOption(options[label(p)]);
      if (value) selected[label(p)] = value;
    });
    const complete = props.every((p) => selected[label(p)]);

    return {
      variantSelected: complete ? selected : {},
      variantOptions: options,
      variantSource: 'jsonld',
      variantConfidence: complete ? 'high' : 'low',
    };
  }

  function scrapeVariantFromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (e) {
        continue;
      }
      const nodes = window.Crosscart.detect.collectJsonLdNodes(data);
      for (const node of nodes) {
        if (node['@type'] !== 'ProductGroup' || !Array.isArray(node.hasVariant) || !node.hasVariant.length) continue;

        const explicit = scrapeExplicitVariants(node);
        if (explicit) return explicit;

        const baseName = node.name || '';
        const currentVariantId = new URLSearchParams(window.location.search).get('variant');

        const parsed = node.hasVariant.map((variant) => {
          let suffix = String(variant.name || '');
          if (baseName && suffix.startsWith(baseName)) suffix = suffix.slice(baseName.length);
          suffix = suffix.replace(/^[\s\-–—|]+/, '');
          // Shopify joins options with " / "; a bare "/" belongs to the value ("30/32").
          const values = suffix
            .split(/\s+\/\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const offer = variant.offers || {};
          const variantId = lastLongNumber(offer.url) || lastLongNumber(variant['@id']);
          return { values, variantId };
        });

        if (!parsed[0].values.length) continue;

        const selectedEntry =
          (currentVariantId && parsed.find((v) => v.variantId === currentVariantId)) || parsed[0];

        // Name each position by the DOM label showing that exact value, so unrelated
        // "More Info: Shipping Policy" lines on the page can't shift the mapping.
        const domPairs = parseLabelValuePairs();
        const same = (a, b) => a.toLowerCase() === b.toLowerCase();
        const names = selectedEntry.values.map((value, i) => {
          const pair = domPairs.find((p) => same(p.value, value));
          return pair ? pair.name : `Option ${i + 1}`;
        });
        const namesMatch = names.every((name, i) => name !== `Option ${i + 1}`) && new Set(names).size === names.length;

        const options = {};
        names.forEach((name) => (options[name] = []));
        parsed.forEach(({ values }) => {
          values.forEach((value, i) => {
            const name = names[i];
            if (name && !options[name].includes(value)) options[name].push(value);
          });
        });

        const selected = {};
        names.forEach((name, i) => (selected[name] = selectedEntry.values[i] || ''));

        return {
          variantSelected: selected,
          variantOptions: options,
          variantSource: 'jsonld',
          variantConfidence: namesMatch ? 'high' : 'low',
        };
      }
    }
    return null;
  }

  // WooCommerce's variation form carries the full variant list as JSON on the
  // form element itself (`data-product_variations`), keyed by attribute slug
  // (e.g. `attribute_pa_size: 'l'`) — the pickers (select or swatch buttons)
  // supply the pretty group name (their <label>) and slug->label text for
  // each option. Fully structured, so this is always high confidence once a
  // selection has actually been made.
  function scrapeVariantFromWooForm() {
    const form = document.querySelector('form.variations_form[data-product_variations]');
    if (!form) return null;

    let variations;
    try {
      variations = JSON.parse(form.dataset.product_variations || 'null');
    } catch (e) {
      variations = null;
    }
    if (!Array.isArray(variations) || !variations.length) return null;

    const pickers = [...form.querySelectorAll('select[name^="attribute_"], [data-attribute_name]')];
    if (!pickers.length) return null;

    const groups = pickers.map((el) => {
      const attrName = (el.name || el.dataset.attribute_name || '').replace(/^attribute_/, '');
      // WooCommerce's <label for="pa_size"> lives in a sibling table cell, not
      // inside the same wrapper as the picker, so id-based lookup first.
      const labelEl = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('tr, td, .value')?.querySelector('label');
      const label = (labelEl?.textContent || attrName.replace(/^pa_/, '')).trim();
      const valueMap = {};
      let selectedSlug = '';
      if (el.tagName === 'SELECT') {
        [...el.options].forEach((o) => {
          if (o.value) valueMap[o.value] = o.textContent.trim();
        });
        selectedSlug = el.value;
      } else {
        el.querySelectorAll('[data-value]').forEach((s) => {
          valueMap[s.dataset.value] = s.textContent.trim() || s.dataset.value;
        });
        selectedSlug = el.querySelector('.selected, [aria-checked="true"]')?.dataset.value || '';
      }
      return { label, valueMap, selectedSlug };
    });

    const options = {};
    groups.forEach((g) => (options[g.label] = Object.values(g.valueMap)));

    // No selection made yet — report the choices available, but nothing is
    // "selected" so this can't be treated as confirmed.
    if (!groups.every((g) => g.selectedSlug)) {
      return { variantSelected: {}, variantOptions: options, variantSource: 'woo_form', variantConfidence: 'low' };
    }

    const selected = {};
    groups.forEach((g) => (selected[g.label] = g.valueMap[g.selectedSlug] || g.selectedSlug));

    return { variantSelected: selected, variantOptions: options, variantSource: 'woo_form', variantConfidence: 'high' };
  }

  // Nothing structured found (or it wasn't a ProductGroup) — whatever the DOM
  // summary shows is all there is, so it can only ever be low confidence.
  function scrapeVariantFromDom() {
    const pairs = parseLabelValuePairs();
    if (!pairs.length) return null;
    const selected = {};
    const options = {};
    pairs.forEach(({ name, value }) => {
      selected[name] = value;
      options[name] = [value];
    });
    return { variantSelected: selected, variantOptions: options, variantSource: 'dom_label', variantConfidence: 'low' };
  }

  function scrapeVariant() {
    return (
      scrapeVariantFromJsonLd() ||
      scrapeVariantFromWooForm() ||
      scrapeVariantFromDom() || {
        variantSelected: {},
        variantOptions: {},
        variantSource: 'none',
        variantConfidence: null,
      }
    );
  }

  function scrapeDomFallback() {
    const h1 = document.querySelector('h1');
    const priceText = scanCurrencyPrice();
    return {
      title: h1 ? h1.textContent.trim() : '',
      image: findLargestImage(),
      price: normalizeAmount(priceText),
      currency: priceText.replace(/[\d.,\s ]/g, ''),
      url: window.location.href,
    };
  }

  function mergeProductData(...tiers) {
    const merged = {};
    for (const field of ['title', 'image', 'price', 'currency', 'url']) {
      for (const tier of tiers) {
        if (tier && tier[field]) {
          merged[field] = tier[field];
          break;
        }
      }
      if (!(field in merged)) merged[field] = '';
    }
    return merged;
  }

  // Multi-brand stores (Farfetch) name products without the brand ("graphic-print
  // hoodie"). On a single-brand store the brand is the store itself, so prefixing
  // it there would only repeat the store name.
  function withBrand(title, brand, hostname) {
    if (!title || !brand) return title;
    const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = squash(brand);
    if (!b || squash(title).includes(b)) return title;
    const siteName = squash(document.querySelector('meta[property="og:site_name"]')?.content);
    if (squash(hostname).includes(b) || (siteName && (siteName.includes(b) || b.includes(siteName)))) return title;
    return `${brand} ${title}`;
  }

  function scrapeProduct() {
    const hostname = window.location.hostname;
    const agentSites = window.Crosscart.agentSites;

    const jsonLd = scrapeJsonLd();
    const tiers = [jsonLd, scrapeMetaTags(), scrapeMicrodata(), scrapeDomFallback()];
    const merged = mergeProductData(...tiers);

    merged.title = decodeEntities(merged.title);

    if (agentSites.matchesAgentSite(hostname)) {
      const agentTitle = agentSites.findAgentProductTitle();
      if (agentTitle) merged.title = agentTitle;
    } else {
      merged.title = withBrand(stripSiteSuffix(agentSites.cleanTitle(merged.title)), jsonLd.brand, hostname);
    }

    // Shopify og:image is often http:// or protocol-relative, and microdata src can be relative;
    // store an absolute https URL so the image loads on https pages.
    if (merged.image) {
      try {
        merged.image = new URL(merged.image, window.location.href).href.replace(/^http:\/\//i, 'https://');
      } catch (e) {
        merged.image = '';
      }
    }

    const normalized = window.Crosscart.normalizeCurrency(merged.currency);
    merged.originalCurrency = normalized || merged.currency || '';
    merged.currency = normalized || window.Crosscart.inferCurrencyFromHost(hostname);

    merged.id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    merged.domain = hostname;
    merged.source = hostname;
    merged.quantity = 1;
    merged.savedAt = Date.now();

    Object.assign(merged, scrapeVariant());

    return merged;
  }

  window.Crosscart.scrape = {
    scrapeJsonLd,
    scrapeMetaTags,
    scrapeMicrodata,
    scrapeDomFallback,
    scrapeVariant,
    mergeProductData,
    scrapeProduct,
    findLargestImage,
    scanCurrencyPrice,
  };
})();
