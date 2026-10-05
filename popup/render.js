window.Crosscart = window.Crosscart || {};

(function () {
  const { escapeHtml, safeUrl } = window.Crosscart.dom;
  const { calcTotal } = window.Crosscart.currencyRates;

  function grandTotals(lists, preferredCurrency, rates) {
    return Object.entries(lists).map(([name, items]) => ({
      name,
      count: items.reduce((n, i) => n + (i.quantity || 1), 0),
      total: calcTotal(items, preferredCurrency, rates),
    }));
  }

  function renderDashboard(container, lists, preferredCurrency, rates, onSelectList, options) {
    const { formatMoney } = window.Crosscart;
    const { deleteMode = false, onDeleteList } = options || {};
    const totals = grandTotals(lists, preferredCurrency, rates);
    container.innerHTML = totals
      .map(
        (t) => `
      <div class="crosscart-list-card" data-list="${escapeHtml(t.name)}">
        <div class="crosscart-list-card-body">
          <div class="crosscart-list-card-name">${escapeHtml(t.name)}</div>
          <div class="crosscart-list-card-meta">${t.count} item(s) &middot; ${formatMoney(t.total, preferredCurrency)}</div>
        </div>
        ${
          deleteMode
            ? `<button class="crosscart-card-delete" data-delete-list="${escapeHtml(t.name)}" title="Delete ${escapeHtml(t.name)}" aria-label="Delete ${escapeHtml(t.name)}">&minus;</button>`
            : ''
        }
      </div>`
      )
      .join('');
    container.querySelectorAll('.crosscart-list-card-body').forEach((body) => {
      body.addEventListener('click', () => onSelectList(body.parentElement.dataset.list));
    });
    container.querySelectorAll('[data-delete-list]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onDeleteList) onDeleteList(btn.dataset.deleteList);
      });
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
