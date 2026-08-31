window.Crosscart = window.Crosscart || {};

(function () {
  function hasJsonLdProduct() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const nodes = collectJsonLdNodes(data);
        if (nodes.some(isProductOrOfferNode)) return true;
      } catch (e) {
        // malformed JSON-LD, skip
      }
    }
    return false;
  }

  function collectJsonLdNodes(data) {
    const nodes = [];
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (node && typeof node === 'object') {
        nodes.push(node);
        if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
      }
    }
    return nodes;
  }

  function isProductOrOfferNode(node) {
    const type = node['@type'];
    if (!type) return false;
    const types = Array.isArray(type) ? type : [type];
    return types.some((t) => typeof t === 'string' && /^(Product|Offer)$/i.test(t));
  }

  function hasProductMeta() {
    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType && /product/i.test(ogType.content || '')) return true;
    const priceMeta = document.querySelector('meta[property="product:price:amount"], meta[name="product:price:amount"]');
    return Boolean(priceMeta);
  }

  function hasProductMicrodata() {
    if (document.querySelector('[itemtype*="schema.org/Product"]')) return true;
    return Boolean(document.querySelector('[itemprop="price"]'));
  }

  function hasProductUrlPath() {
    return /\/(product|dp|item|products|shop)\//i.test(window.location.pathname);
  }

  function hasProductDomSignals() {
    const ctaPattern = /add to cart|buy now|add to bag/i;
    const buttons = document.querySelectorAll('button, a[role="button"], input[type="submit"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').trim();
      if (ctaPattern.test(text)) return true;
    }
    return false;
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

  window.Crosscart.detect = {
    isProductPage,
    hasJsonLdProduct,
    hasProductMeta,
    hasProductMicrodata,
    hasProductUrlPath,
    hasProductDomSignals,
    collectJsonLdNodes,
  };
})();
