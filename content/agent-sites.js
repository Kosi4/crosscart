window.Crosscart = window.Crosscart || {};

(function () {
  const AGENT_TITLE_SELECTORS = [
    '.goods-name',
    '.goods-title',
    '.product-name',
    '.item-title',
    '.product-detail-title',
  ];

  const TITLE_BOILERPLATE_PHRASES = [
    'buy now',
    'free shipping',
    'best price',
    'official store',
    'official site',
    'price and deal',
    'shop online',
    'buy online',
    'online shopping',
    'free delivery',
    'best deals',
  ];

  function matchesAgentSite(hostname) {
    if (!hostname) return false;
    return window.Crosscart.AGENT_SITE_NAMES.some((name) => hostname.toLowerCase().includes(name));
  }

  function containsBoilerplatePhrase(title) {
    const lower = title.toLowerCase();
    return TITLE_BOILERPLATE_PHRASES.some((phrase) => lower.includes(phrase));
  }

  function cleanTitle(raw) {
    if (!raw) return raw;
    let title = raw.trim();
    // Split on separators only — a bare hyphen would tear "Zip-Up Hoodie" apart.
    const parts = title.split(/\s*[|–—·]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const kept = parts.filter((p) => !containsBoilerplatePhrase(p));
      if (kept.length) title = kept.join(' - ');
    }
    return title.replace(/\s{2,}/g, ' ').trim();
  }

  function findAgentProductTitle() {
    for (const selector of AGENT_TITLE_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) {
        return cleanTitle(el.textContent);
      }
    }
    return null;
  }

  window.Crosscart.agentSites = {
    matchesAgentSite,
    findAgentProductTitle,
    cleanTitle,
    containsBoilerplatePhrase,
    AGENT_TITLE_SELECTORS,
    TITLE_BOILERPLATE_PHRASES,
  };
})();
