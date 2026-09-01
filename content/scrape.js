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

  // "Black Risen King Hoodie | We Are Righteous" -> "Black Risen King Hoodie".
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
  function offerPrice(offer) {
    if (!offer || typeof offer !== 'object') return '';
    const direct =
      offer.price !== undefined && offer.price !== null && offer.price !== ''
        ? offer.price
        : offer.lowPrice !== undefined && offer.lowPrice !== null
          ? offer.lowPrice
          : offer.priceSpecification && offer.priceSpecification.price;
    return direct === undefined || direct === null || direct === '' ? '' : String(direct);
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
          currency: candidate.priceCurrency || offer.priceCurrency || '',
          inStock: /InStock|LimitedAvailability/i.test(String(candidate.availability || '')),
        });
      }
    }
    if (!priced.length) return { price: '', currency: '' };

    const inStock = priced.filter((o) => o.inStock);
    const pool = inStock.length ? inStock : priced;
    return pool.reduce((best, o) => (Number(o.price) < Number(best.price) ? o : best));
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

          const offer = pickOffer(node.offers);
          return {
            title: node.name || '',
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

  function findLargestImage() {
    let best = null;
    let bestArea = 0;
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
    '[class*="compare-at"]',
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

  // Reads the element's full text, so markup that splits the symbol from the
  // amount (WooCommerce wraps "$" in its own span) still resolves.
  function scanCurrencyPrice() {
    const pricePattern = /(?:\$|€|£|¥|₹|R|USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR)\s*[\d.,\s ]*\d/i;

    let scope = null;
    for (const selector of PRICE_SCOPES) {
      scope = document.querySelector(selector);
      if (scope) break;
    }
    if (!scope) scope = document.body;
    if (!scope) return '';

    // itemprop=price is authoritative when present, and often a clean number.
    const tagged = scope.querySelector('[itemprop="price"]:not(del [itemprop="price"])');
    if (tagged && !tagged.closest(PRICE_EXCLUDED)) {
      const value = tagged.getAttribute('content') || tagged.textContent;
      if (value && /\d/.test(value)) return value;
    }

    // <ins> is the sale price in WooCommerce/WordPress markup, so it wins.
    const candidates = [...scope.querySelectorAll('ins, [class*="price"], [itemprop="price"]')];
    for (const el of candidates) {
      if (el.closest(PRICE_EXCLUDED)) continue;
      if (el.querySelector('[class*="price"], ins')) continue; // prefer the leaf node
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      const match = text.match(pricePattern);
      if (match) return match[0];
    }
    return '';
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

  function scrapeProduct() {
    const hostname = window.location.hostname;
    const agentSites = window.Crosscart.agentSites;

    const tiers = [scrapeJsonLd(), scrapeMetaTags(), scrapeMicrodata(), scrapeDomFallback()];
    const merged = mergeProductData(...tiers);

    merged.title = decodeEntities(merged.title);

    if (agentSites.matchesAgentSite(hostname)) {
      const agentTitle = agentSites.findAgentProductTitle();
      if (agentTitle) merged.title = agentTitle;
    } else {
      merged.title = stripSiteSuffix(agentSites.cleanTitle(merged.title));
    }


    const normalized = window.Crosscart.normalizeCurrency(merged.currency);
    merged.originalCurrency = normalized || merged.currency || '';
    merged.currency = normalized || window.Crosscart.inferCurrencyFromHost(hostname);

    merged.id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    merged.domain = hostname;
    merged.source = hostname;
    merged.quantity = 1;
    merged.savedAt = Date.now();

    return merged;
  }

  window.Crosscart.scrape = {
    scrapeJsonLd,
    scrapeMetaTags,
    scrapeMicrodata,
    scrapeDomFallback,
    mergeProductData,
    scrapeProduct,
    findLargestImage,
    scanCurrencyPrice,
  };
})();
