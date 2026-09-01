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

  // Variant context ("Size M · Titanium Grey"), omitted entirely for items
  // saved before specs existed or scraped from pages that expose none.
  function specsLine(specs) {
    if (!Array.isArray(specs) || !specs.length) return '';
    const text = specs.map((s) => `${s.label} ${s.value}`).join(' · ');
    return `<div class="crosscart-item-specs">${escapeHtml(text)}</div>`;
  }

  function calcTotal(items, preferredCurrency, rates) {
    const { convertAmount } = window.Crosscart.currencyRates;
    return items.reduce((sum, item) => {
      const converted = convertAmount(item.price, item.currency, preferredCurrency, rates);
      return sum + (Number.isFinite(converted) ? converted * (item.quantity || 1) : 0);
    }, 0);
  }

  function grandTotals(lists, preferredCurrency, rates) {
    return Object.entries(lists).map(([name, items]) => ({
      name,
      count: items.reduce((n, i) => n + (i.quantity || 1), 0),
      total: calcTotal(items, preferredCurrency, rates),
    }));
  }

  function renderDashboard(container, lists, preferredCurrency, rates, onSelectList) {
    const { formatMoney } = window.Crosscart;
    const totals = grandTotals(lists, preferredCurrency, rates);
    container.innerHTML = totals
      .map(
        (t) => `
      <div class="crosscart-list-card" data-list="${escapeHtml(t.name)}">
        <div class="crosscart-list-card-name">${escapeHtml(t.name)}</div>
        <div class="crosscart-list-card-meta">${t.count} item(s) &middot; ${formatMoney(t.total, preferredCurrency)}</div>
      </div>`
      )
      .join('');
    container.querySelectorAll('.crosscart-list-card').forEach((card) => {
      card.addEventListener('click', () => onSelectList(card.dataset.list));
    });
  }

  function renderItems(container, items, listName, preferredCurrency, rates, handlers) {
    const { formatMoney } = window.Crosscart;
    if (!items.length) {
      container.innerHTML = '<div class="crosscart-empty">No items in this list yet.</div>';
      return;
    }
    container.innerHTML = items
      .map((item, index) => {
        const converted = window.Crosscart.currencyRates.convertAmount(
          item.price,
          item.currency,
          preferredCurrency,
          rates
        );
        const href = safeUrl(item.url);
        const body = `
          <img class="crosscart-item-img" src="${escapeHtml(item.image)}" alt="" />
          <div class="crosscart-item-info">
            <div class="crosscart-item-title">${escapeHtml(item.title)}</div>
            <div class="crosscart-item-domain">${escapeHtml(item.domain)}</div>
            ${specsLine(item.specs)}
            <div class="crosscart-item-price">${formatMoney(converted, preferredCurrency)}</div>
          </div>`;
        return `
        <div class="crosscart-item" draggable="true" data-index="${index}" data-id="${escapeHtml(item.id)}">
          ${
            href
              ? `<a class="crosscart-item-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Open product page">${body}</a>`
              : `<div class="crosscart-item-link">${body}</div>`
          }
          <div class="crosscart-item-controls">
            <input type="number" min="1" class="crosscart-qty" value="${item.quantity || 1}" data-id="${escapeHtml(item.id)}" />
            <button class="crosscart-delete" data-id="${escapeHtml(item.id)}">Delete</button>
          </div>
        </div>`;
      })
      .join('');

    container.querySelectorAll('.crosscart-delete').forEach((btn) => {
      btn.addEventListener('click', () => handlers.onDelete(btn.dataset.id));
    });
    container.querySelectorAll('.crosscart-qty').forEach((input) => {
      input.addEventListener('change', () => handlers.onQuantityChange(input.dataset.id, Number(input.value)));
    });
  }

  function updateFooter(footerEl, items, preferredCurrency, rates) {
    const { formatMoney } = window.Crosscart;
    const count = items.reduce((n, i) => n + (i.quantity || 1), 0);
    const total = calcTotal(items, preferredCurrency, rates);
    footerEl.textContent = `${count} item(s) · ${formatMoney(total, preferredCurrency)}`;
  }

  window.Crosscart.render = {
    escapeHtml,
    calcTotal,
    grandTotals,
    renderDashboard,
    renderItems,
    updateFooter,
  };
})();
