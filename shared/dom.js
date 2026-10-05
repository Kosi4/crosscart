window.Crosscart = window.Crosscart || {};

(function () {
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Item URLs come from scraped pages, so only http(s) may become a live link —
  // anything else (javascript:, data:, ...) renders as plain, unclickable markup.
  function safeUrl(raw) {
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  }

  window.Crosscart.dom = { escapeHtml, safeUrl };
})();
