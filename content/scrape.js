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

          const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          return {
            title: node.name || '',
            image: imageUrl(node.image),
            price: offer && offer.price ? String(offer.price) : '',
            currency: offer && offer.priceCurrency ? offer.priceCurrency : '',
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

  function scanCurrencyPrice() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const pricePattern = /(\$|€|£|¥|₹|R\s|USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR)\s?[\d,]+\.?\d*/;
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      const match = text.match(pricePattern);
      if (match) {
        return match[0];
      }
    }
    return '';
  }

  function scrapeDomFallback() {
    const h1 = document.querySelector('h1');
    const priceText = scanCurrencyPrice();
    const priceMatch = priceText.match(/[\d,]+\.?\d*/);
    return {
      title: h1 ? h1.textContent.trim() : '',
      image: findLargestImage(),
      price: priceMatch ? priceMatch[0].replace(/,/g, '') : '',
      currency: priceText.replace(/[\d,.\s]/g, ''),
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
      merged.title = agentSites.cleanTitle(merged.title);
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
