(() => {
  const BUTTON_ID = "crosscart-btn";
  const STORAGE_KEY = "cartItems";
  const LISTS_KEY = "cartLists";
  const ACTIVE_LIST_KEY = "activeList";
  const DEFAULT_LABEL = "+ Add to CrossCart";
  const SAVED_LABEL = "Saved!";
  const SUPPORTED_CURRENCIES = [
    "USD",
    "EUR",
    "GBP",
    "ZAR",
    "JPY",
    "CAD",
    "AUD",
    "INR",
  ];
  const TITLE_BOILERPLATE_PHRASES = [
    "Oopbuy",
    "Pandabuy",
    "Superbuy",
    "Mulebuy",
    "Trusted China",
    "Shopping Solution",
    "Online Shopping",
    "Shopping Agent",
  ];
  const AGENT_SITE_NAMES = ["Oopbuy", "Pandabuy", "Superbuy", "Mulebuy"];
  const AGENT_TITLE_SELECTORS = [
    ".goods-name",
    ".goods-title",
    ".product-name",
    ".item-title",
    ".product-detail-title",
  ];
  const AGENT_CONTENT_WRAPPERS = [
    "#app",
    "main",
    ".goods-detail",
    ".product-info",
  ];

  let lastUrl = location.href;
  let saveResetTimer = null;

  function ensureButton() {
    let button = document.getElementById(BUTTON_ID);
    if (button) {
      button.classList.remove("crosscart-hidden");
      button.style.display = "";
      return button;
    }

    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = DEFAULT_LABEL;
    button.addEventListener("click", onAddClick, true);
    (document.body || document.documentElement).appendChild(button);
    return button;
  }

  function removeButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    if (saveResetTimer) {
      clearTimeout(saveResetTimer);
      saveResetTimer = null;
    }
    button.remove();
  }

  function hideButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.classList.add("crosscart-hidden");
    button.style.display = "none";
  }

  function flashSaved(button) {
    button.textContent = SAVED_LABEL;
    button.classList.add("crosscart-saved");
    if (saveResetTimer) clearTimeout(saveResetTimer);
    saveResetTimer = setTimeout(() => {
      button.textContent = DEFAULT_LABEL;
      button.classList.remove("crosscart-saved");
      saveResetTimer = null;
    }, 1800);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function typeIncludes(typeValue, target) {
    return asArray(typeValue).some(
      (t) =>
        typeof t === "string" &&
        t.toLowerCase().includes(target.toLowerCase())
    );
  }

  function collectJsonLdNodes(node, results = []) {
    if (!node || typeof node !== "object") return results;

    if (Array.isArray(node)) {
      node.forEach((item) => collectJsonLdNodes(item, results));
      return results;
    }

    if (node["@graph"]) collectJsonLdNodes(node["@graph"], results);
    results.push(node);

    Object.keys(node).forEach((key) => {
      if (key === "@graph") return;
      const value = node[key];
      if (value && typeof value === "object") collectJsonLdNodes(value, results);
    });

    return results;
  }

  function hasJsonLdProduct() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      const parsed = safeJsonParse(script.textContent || "");
      if (!parsed) continue;
      const nodes = collectJsonLdNodes(parsed);
      if (nodes.some((node) => typeIncludes(node["@type"], "Product"))) {
        return true;
      }
    }
    return false;
  }

  function hasProductMeta() {
    const ogType = getMetaContent([
      'meta[property="og:type"]',
      'meta[name="og:type"]',
    ]).toLowerCase();
    if (ogType.includes("product")) return true;

    const priceAmount = getMetaContent([
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
    ]);
    return Boolean(priceAmount);
  }

  function hasProductMicrodata() {
    if (
      document.querySelector(
        '[itemtype*="schema.org/Product" i], [itemtype*="Product" i]'
      )
    ) {
      return true;
    }

    const hasName = Boolean(document.querySelector('[itemprop="name"]'));
    const hasPrice = Boolean(
      document.querySelector('[itemprop="price"], [itemprop="offers"]')
    );
    return hasName && hasPrice;
  }

  function hasProductUrlPath() {
    const path = (location.pathname || "").toLowerCase();
    if (
      /\/(product|products|product-detail|p|dp|item|ip|detail|goods|buy)(\/|$)/i.test(
        path
      )
    ) {
      return true;
    }

    const search = (location.search || "").toLowerCase();
    if (!search) return false;

    return /(?:^|[?&])id=|item|goods|detail|url=|product/.test(search);
  }

  function hasProductDomSignals() {
    const root = document.body || document.documentElement;
    if (!root) return false;

    const ctaPattern =
      /\b(add to cart|add to bag|buy now|submit order|buy|cart)\b/i;
    const clickable = root.querySelectorAll(
      "button, a, [role='button'], input[type='button'], input[type='submit']"
    );

    for (const el of clickable) {
      const text = `${el.textContent || ""} ${el.value || ""} ${
        el.getAttribute("aria-label") || ""
      }`.trim();
      if (text && ctaPattern.test(text)) return true;
    }

    const priceEl = root.querySelector(
      [
        '[itemprop="price"]',
        '[class*="price" i]',
        '[id*="price" i]',
        '[data-price]',
        ".price",
        "#price",
      ].join(", ")
    );

    if (!priceEl) return false;

    const quantityInput = root.querySelector(
      [
        'input[type="number"]',
        'input[name*="qty" i]',
        'input[name*="quantity" i]',
        'input[id*="qty" i]',
        'input[id*="quantity" i]',
        'select[name*="qty" i]',
        'select[name*="quantity" i]',
        '[class*="quantity" i]',
        '[class*="qty" i]',
      ].join(", ")
    );

    const optionSelectors = root.querySelectorAll(
      [
        'select[name*="option" i]',
        'select[id*="option" i]',
        'select[name*="variant" i]',
        'select[id*="variant" i]',
        'select[name*="size" i]',
        'select[name*="color" i]',
        '[class*="option" i] select',
        '[class*="variant" i]',
        '[class*="sku" i]',
        'input[type="radio"][name*="option" i]',
        'input[type="radio"][name*="size" i]',
        'input[type="radio"][name*="color" i]',
      ].join(", ")
    );

    return Boolean(quantityInput || optionSelectors.length > 0);
  }

  function isProductPage() {
    return (
      hasJsonLdProduct() ||
      hasProductMeta() ||
      hasProductMicrodata() ||
      hasProductUrlPath() ||
      hasProductDomSignals()
    );
  }

  function syncButtonForPage() {
    if (isProductPage()) {
      ensureButton();
    } else {
      removeButton();
    }
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function containsBoilerplatePhrase(title) {
    if (!title) return false;
    const lower = String(title).toLowerCase();
    return TITLE_BOILERPLATE_PHRASES.some((phrase) =>
      lower.includes(phrase.toLowerCase())
    );
  }

  function cleanTitle(raw) {
    if (!raw) return "";
    let title = String(raw).replace(/\s+/g, " ").trim();

    // Strip trailing site names or pipe/dash dividers (e.g. " | Oopbuy")
    for (const site of AGENT_SITE_NAMES) {
      const siteRe = escapeRegExp(site);
      title = title.replace(
        new RegExp(`[\\s]*[|\\u2013\\u2014\\-·:][\\s]*${siteRe}.*$`, "i"),
        ""
      );
      title = title.replace(
        new RegExp(`^${siteRe}[\\s]*[|\\u2013\\u2014\\-·:][\\s]*`, "i"),
        ""
      );
    }

    for (const phrase of TITLE_BOILERPLATE_PHRASES) {
      const phraseRe = escapeRegExp(phrase);
      title = title.replace(
        new RegExp(`[\\s]*[|\\u2013\\u2014\\-·:][\\s]*${phraseRe}.*$`, "i"),
        ""
      );
    }

    return title.replace(/\s+/g, " ").trim();
  }

  function sanitizeTitle(raw) {
    const cleaned = cleanTitle(raw);
    if (!cleaned || cleaned.length < 3) return "";
    // Reject titles that still contain generic agent/site boilerplate
    if (containsBoilerplatePhrase(cleaned)) return "";
    return cleaned;
  }

  function textFromElement(el) {
    if (!el) return "";
    return (el.getAttribute("content") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findAgentProductTitle() {
    for (const selector of AGENT_TITLE_SELECTORS) {
      const el = document.querySelector(selector);
      const title = sanitizeTitle(textFromElement(el));
      if (title) return title;
    }

    for (const wrapperSelector of AGENT_CONTENT_WRAPPERS) {
      const wrapper = document.querySelector(wrapperSelector);
      if (!wrapper) continue;

      const headings = wrapper.querySelectorAll("h1, h2, h3");
      for (const heading of headings) {
        const title = sanitizeTitle(textFromElement(heading));
        if (title) return title;
      }
    }

    return "";
  }

  function resolveProductTitle(...candidates) {
    for (const candidate of candidates) {
      const title = sanitizeTitle(candidate);
      if (title) return title;
    }
    return findAgentProductTitle();
  }

  function pickImage(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return pickImage(value[0]);
    if (typeof value === "object") {
      return value.url || value.contentUrl || value["@id"] || "";
    }
    return "";
  }

  function normalizeCurrency(raw) {
    if (!raw) return null;
    const value = String(raw).trim().toUpperCase();

    const aliases = {
      $: "USD",
      US$: "USD",
      USD: "USD",
      "€": "EUR",
      EUR: "EUR",
      "£": "GBP",
      GBP: "GBP",
      R: "ZAR",
      ZAR: "ZAR",
      "¥": "JPY",
      "JP¥": "JPY",
      JPY: "JPY",
      "￥": "JPY",
      CA$: "CAD",
      CAD: "CAD",
      A$: "AUD",
      AU$: "AUD",
      AUD: "AUD",
      "₹": "INR",
      RS: "INR",
      INR: "INR",
    };

    if (aliases[value]) return aliases[value];

    const codeMatch = value.match(/\b(USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR)\b/);
    if (codeMatch) return codeMatch[1];

    if (SUPPORTED_CURRENCIES.includes(value)) return value;
    return null;
  }

  function pickPriceCurrency(offerLike) {
    if (!offerLike || typeof offerLike !== "object") {
      return { price: null, currency: null };
    }

    const offers = asArray(offerLike.offers || offerLike);
    for (const offer of offers) {
      if (!offer || typeof offer !== "object") continue;
      const price =
        offer.price ??
        offer.lowPrice ??
        offer.highPrice ??
        (offer.priceSpecification && offer.priceSpecification.price);
      const currency =
        offer.priceCurrency ||
        (offer.priceSpecification && offer.priceSpecification.priceCurrency);
      if (price != null && price !== "") {
        return {
          price: String(price),
          currency: normalizeCurrency(currency),
        };
      }
    }

    if (offerLike.price != null) {
      return {
        price: String(offerLike.price),
        currency: normalizeCurrency(offerLike.priceCurrency),
      };
    }

    return { price: null, currency: null };
  }

  function scrapeJsonLd() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    let best = null;

    scripts.forEach((script) => {
      const parsed = safeJsonParse(script.textContent || "");
      if (!parsed) return;

      const nodes = collectJsonLdNodes(parsed);
      nodes.forEach((node) => {
        const isProduct = typeIncludes(node["@type"], "Product");
        const isOffer = typeIncludes(node["@type"], "Offer");
        if (!isProduct && !isOffer) return;

        const title = resolveProductTitle(
          node.name ||
            node.title ||
            (node.itemOffered && node.itemOffered.name) ||
            ""
        );
        const image =
          pickImage(node.image) ||
          pickImage(node.thumbnailUrl) ||
          pickImage(node.itemOffered && node.itemOffered.image);
        const { price, currency } = pickPriceCurrency(node);

        const candidate = {
          title,
          image: image ? String(image).trim() : "",
          price: price,
          currency: currency,
        };

        const score =
          (candidate.title ? 4 : 0) +
          (candidate.image ? 2 : 0) +
          (candidate.price ? 3 : 0) +
          (candidate.currency ? 1 : 0);

        if (!best || score > best.score) {
          best = { ...candidate, score };
        }
      });
    });

    if (!best || (!best.title && !best.price && !best.image)) return null;
    return {
      title: best.title || "",
      image: best.image || "",
      price: best.price,
      currency: best.currency,
      source: "json-ld",
    };
  }

  function getMetaContent(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const content =
        el.getAttribute("content") ||
        el.getAttribute("value") ||
        el.textContent;
      if (content && content.trim()) return content.trim();
    }
    return "";
  }

  function scrapeMetaTags() {
    const title = resolveProductTitle(
      getMetaContent([
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'meta[name="title"]',
      ])
    );
    const image = getMetaContent([
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="og:image:url"]',
    ]);
    const price = getMetaContent([
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[itemprop="price"]',
      'meta[name="price"]',
    ]);
    const currency = normalizeCurrency(
      getMetaContent([
        'meta[property="product:price:currency"]',
        'meta[property="og:price:currency"]',
        'meta[itemprop="priceCurrency"]',
        'meta[property="product:price:currency"]',
      ])
    );

    if (!title && !image && !price) return null;
    return {
      title,
      image,
      price: price || null,
      currency,
      source: "meta",
    };
  }

  function getItempropValue(prop) {
    const el = document.querySelector(`[itemprop="${prop}"]`);
    if (!el) return "";

    if (el.getAttribute("content")) return el.getAttribute("content").trim();
    if (el.getAttribute("src")) return el.getAttribute("src").trim();
    if (el.getAttribute("href")) return el.getAttribute("href").trim();
    return (el.textContent || "").trim();
  }

  function scrapeMicrodata() {
    const title = resolveProductTitle(getItempropValue("name"));
    const image = getItempropValue("image");
    const price = getItempropValue("price");
    const currency = normalizeCurrency(getItempropValue("priceCurrency"));

    if (!title && !image && !price) return null;
    return {
      title,
      image,
      price: price || null,
      currency,
      source: "microdata",
    };
  }

  function absoluteUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  }

  function findLargestImage() {
    const images = Array.from(document.images || []);
    let best = null;
    let bestArea = 0;

    images.forEach((img) => {
      if (!img.src) return;
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      const area = width * height;
      if (area < 10000) return;
      if (area > bestArea) {
        bestArea = area;
        best = img;
      }
    });

    return best ? best.src : "";
  }

  function inferCurrencyFromHost() {
    const host = location.hostname.replace(/^www\./, "").toLowerCase();
    if (/\.co\.za$|\.za$/.test(host) || host.endsWith("takealot.com")) {
      return "ZAR";
    }
    if (/\.co\.uk$|\.uk$/.test(host)) return "GBP";
    if (/\.co\.jp$|\.jp$/.test(host)) return "JPY";
    if (/\.ca$/.test(host)) return "CAD";
    if (/\.com\.au$|\.au$/.test(host)) return "AUD";
    if (/\.co\.in$|\.in$/.test(host)) return "INR";
    if (
      /\.de$|\.fr$|\.es$|\.it$|\.nl$|\.eu$/.test(host) ||
      host.includes("amazon.de") ||
      host.includes("amazon.fr")
    ) {
      return "EUR";
    }
    return null;
  }

  function scanCurrencyPrice() {
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = (node.nodeValue || "").trim();
          if (!text || text.length > 100) return NodeFilter.FILTER_REJECT;
          if (
            !/[$€£¥₹]|R\s?\d|\b(?:USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR)\b/i.test(
              text
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const pattern =
      /(?:(USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR)\s*)?([$€£¥₹]|R|CA\$|A\$|US\$)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(?:(USD|EUR|GBP|ZAR|JPY|CAD|AUD|INR))\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

    let match = null;
    let current;

    while ((current = walker.nextNode())) {
      const text = current.nodeValue.trim();
      const found = text.match(pattern);
      if (found) {
        match = found;
        break;
      }
    }

    if (!match) return { price: null, currency: null };

    const amount = (match[3] || match[5] || "").replace(/,/g, "");
    const currency =
      normalizeCurrency(match[1] || match[4] || match[2]) ||
      inferCurrencyFromHost();

    return {
      price: amount || null,
      currency,
    };
  }

  function scrapeDomFallback() {
    const h1 = document.querySelector("h1");
    const title = resolveProductTitle(
      h1 ? h1.textContent : "",
      document.title || ""
    );
    const image = findLargestImage();
    const { price, currency } = scanCurrencyPrice();

    if (!title && !image && !price) return null;
    return {
      title,
      image,
      price,
      currency: currency || inferCurrencyFromHost(),
      source: "dom",
    };
  }

  function mergeProductData(...tiers) {
    const result = {
      title: "",
      image: "",
      price: null,
      currency: null,
      source: "unknown",
    };

    for (const tier of tiers) {
      if (!tier) continue;
      if (!result.title && tier.title) {
        const title = sanitizeTitle(tier.title) || "";
        if (title) result.title = title;
      }
      if (!result.image && tier.image) result.image = tier.image;
      if (!result.price && tier.price) result.price = tier.price;
      if (!result.currency && tier.currency) result.currency = tier.currency;
      if (result.source === "unknown" && tier.source) {
        result.source = tier.source;
      }
      if (result.title && result.image && result.price && result.currency) {
        break;
      }
    }

    if (!result.title) {
      result.title = findAgentProductTitle();
    }

    return result;
  }

  function parsePriceNumber(raw) {
    if (raw == null || raw === "") return null;
    const cleaned = String(raw).replace(/[^0-9.,]/g, "").replace(/,/g, "");
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function scrapeProduct() {
    const tier1 = scrapeJsonLd();
    const tier2 = scrapeMetaTags();
    const tier3 = scrapeMicrodata();
    const tier4 = scrapeDomFallback();
    const merged = mergeProductData(tier1, tier2, tier3, tier4);

    const hostname = location.hostname.replace(/^www\./, "");
    const priceValue = parsePriceNumber(merged.price);
    const currency =
      normalizeCurrency(merged.currency) ||
      inferCurrencyFromHost() ||
      "USD";

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title:
        resolveProductTitle(merged.title, document.title) || "Untitled product",
      image: absoluteUrl(merged.image),
      price: priceValue,
      currency,
      originalCurrency: currency,
      url: location.href,
      domain: hostname,
      source: merged.source,
      quantity: 1,
      savedAt: new Date().toISOString(),
    };
  }

  function onAddClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!isProductPage()) {
      hideButton();
      return;
    }

    const button = ensureButton();
    const item = scrapeProduct();

    // Save as pending so the popup can ask the user which list to store it in
    chrome.storage.local.set({
      pendingProduct: item,
      pendingProductTimestamp: Date.now()
    }, () => {
      flashSaved(button);
      // Notify popup if it is already open
      chrome.runtime.sendMessage({ type: "PRODUCT_SCRAPED" }).catch(() => {});
    });
  }

  function watchSpaNavigation() {
    let debounceTimer = null;

    const recheck = () => {
      const urlChanged = location.href !== lastUrl;
      if (urlChanged) lastUrl = location.href;
      syncButtonForPage();
    };

    const scheduleRecheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recheck, 250);
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const ret = originalPushState.apply(this, args);
      recheck();
      return ret;
    };

    history.replaceState = function (...args) {
      const ret = originalReplaceState.apply(this, args);
      recheck();
      return ret;
    };

    window.addEventListener("popstate", recheck);
    window.addEventListener("hashchange", recheck);

    const observer = new MutationObserver((mutations) => {
      const buttonExists = Boolean(document.getElementById(BUTTON_ID));
      const touchedButton = mutations.some((mutation) => {
        const nodes = [
          ...Array.from(mutation.addedNodes),
          ...Array.from(mutation.removedNodes),
        ];
        return nodes.some(
          (node) =>
            node.id === BUTTON_ID ||
            (node.nodeType === 1 &&
              node.querySelector &&
              node.querySelector(`#${BUTTON_ID}`))
        );
      });

      if (touchedButton && buttonExists) return;
      scheduleRecheck();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    setInterval(recheck, 1000);
  }

  function init() {
    syncButtonForPage();
    watchSpaNavigation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
