(function () {
  const C = window.Crosscart;
  const { STORAGE_KEYS, SUPPORTED_CURRENCIES, storage, lists: listsApi, render, dnd, currencyRates } = C;

  const state = {
    lists: {},
    activeList: listsApi.DEFAULT_LIST_NAME,
    preferredCurrency: 'USD',
    rates: currencyRates.FALLBACK_RATES,
    viewMode: 'dashboard',
    deleteMode: false,
  };

  const els = {};

  function cacheEls() {
    els.currencySelect = document.getElementById('currency-select');
    els.openWebBtn = document.getElementById('open-web-btn');
    els.clearAllBtn = document.getElementById('clear-all-btn');
    els.listTitle = document.getElementById('list-title');
    els.listNameInput = document.getElementById('list-name-input');
    els.newListBtn = document.getElementById('new-list-btn');
    els.deleteListBtn = document.getElementById('delete-list-btn');
    els.backBtn = document.getElementById('back-btn');
    els.cartList = document.getElementById('cart-list');
    els.footer = document.getElementById('footer-summary');
  }

  function populateCurrencySelect() {
    els.currencySelect.innerHTML = SUPPORTED_CURRENCIES.map(
      (c) => `<option value="${c}" ${c === state.preferredCurrency ? 'selected' : ''}>${c}</option>`
    ).join('');
  }

  // The bar shows "Carts" on the dashboard and the editable cart name inside one,
  // so the title doubles as the rename field and needs no separate button.
  function renderListBar() {
    const inList = state.viewMode === 'list';
    els.backBtn.hidden = !inList;
    els.listTitle.hidden = inList;
    els.listNameInput.hidden = !inList;
    if (inList && document.activeElement !== els.listNameInput) {
      els.listNameInput.value = state.activeList;
    }
    els.deleteListBtn.title = inList ? 'Delete this cart' : 'Delete a cart';
    els.deleteListBtn.setAttribute('aria-label', els.deleteListBtn.title);
    els.deleteListBtn.setAttribute('aria-pressed', String(!inList && state.deleteMode));
  }

  function renderCurrentView() {
    renderListBar();
    if (state.viewMode === 'dashboard') {
      render.renderDashboard(
        els.cartList,
        state.lists,
        state.preferredCurrency,
        state.rates,
        (name) => {
          state.activeList = name;
          state.viewMode = 'list';
          state.deleteMode = false;
          renderCurrentView();
        },
        { deleteMode: state.deleteMode, onDeleteList: handleDeleteList }
      );
      const allItems = Object.values(state.lists).flat();
      render.updateFooter(els.footer, allItems, state.preferredCurrency, state.rates);
    } else {
      const items = state.lists[state.activeList] || [];
      render.renderItems(els.cartList, items, state.activeList, state.preferredCurrency, state.rates, {
        onDelete: handleDeleteItem,
        onQuantityChange: handleQuantityChange,
      });
      dnd.attachDragAndDrop(els.cartList, items, handleReorder);
      render.updateFooter(els.footer, items, state.preferredCurrency, state.rates);
    }
  }

  // Apply `op` to the latest lists in storage, not this popup's copy: the web app or a
  // sync may have changed them since the popup opened, and saving a stale copy undoes that.
  async function update(op) {
    const { lists } = await listsApi.loadLists();
    state.lists = op(lists);
    await listsApi.persistLists(state.lists, state.activeList);
  }

  async function handleDeleteItem(itemId) {
    const list = state.activeList;
    await update((lists) => listsApi.deleteItem(lists, list, itemId));
    renderCurrentView();
  }

  async function handleQuantityChange(itemId, qty) {
    const list = state.activeList;
    await update((lists) => listsApi.updateItemQuantity(lists, list, itemId, qty));
    renderCurrentView();
  }

  async function handleReorder(reordered) {
    const list = state.activeList;
    const rank = new Map(reordered.map((item, n) => [item.id, n]));
    const pos = (item) => (rank.has(item.id) ? rank.get(item.id) : Infinity);
    await update((lists) => ({ ...lists, [list]: [...(lists[list] || [])].sort((a, b) => pos(a) - pos(b)) }));
    renderCurrentView();
  }

  // A new cart is created with a placeholder name and opened with the name selected,
  // so naming it is just typing — there is no separate create form.
  async function handleCreateList() {
    let n = 0;
    let name;
    do {
      name = `Cart ${++n}`;
    } while (state.lists[name]);
    state.activeList = name;
    state.viewMode = 'list';
    state.deleteMode = false;
    await update((lists) => listsApi.createList(lists, name));
    renderCurrentView();
    els.listNameInput.focus();
    els.listNameInput.select();
  }

  async function handleDeleteList(name) {
    const list = name || state.activeList;
    await update((lists) => {
      const next = listsApi.deleteList(lists, list);
      if (!next[state.activeList]) state.activeList = Object.keys(next)[0];
      return next;
    });
    if (!name) {
      state.viewMode = 'dashboard';
      state.deleteMode = false;
    }
    renderCurrentView();
  }

  async function handleRenameList(newName) {
    const name = newName.trim();
    const list = state.activeList;
    if (!name || name === list || state.lists[name]) {
      renderListBar();
      return;
    }
    state.activeList = name;
    await update((lists) => listsApi.renameList(lists, list, name));
    renderCurrentView();
  }

  async function handleClearAll() {
    const list = state.activeList;
    await update((lists) => listsApi.clearAll(lists, list));
    renderCurrentView();
  }

  function wireEvents() {
    els.currencySelect.addEventListener('change', async () => {
      state.preferredCurrency = els.currencySelect.value;
      await currencyRates.savePreferredCurrency(state.preferredCurrency);
      renderCurrentView();
    });

    // TODO: swap for the real deployed origin at launch (see handoff §7, Phase 6).
    els.openWebBtn.href = 'http://localhost:55983/web/#/carts';
    els.clearAllBtn.addEventListener('click', handleClearAll);

    els.newListBtn.addEventListener('click', handleCreateList);

    // On the dashboard the minus arms delete mode (a minus then appears on each cart);
    // inside a cart it deletes the cart you are looking at.
    // Deleting the open cart takes a second tap within 3 seconds: one stray tap mustn't lose a cart.
    let armTimer = null;
    els.deleteListBtn.addEventListener('click', () => {
      if (state.viewMode === 'list') {
        if (els.deleteListBtn.dataset.armed) {
          clearTimeout(armTimer);
          delete els.deleteListBtn.dataset.armed;
          handleDeleteList();
          return;
        }
        els.deleteListBtn.dataset.armed = 'true';
        els.deleteListBtn.title = 'Tap again to delete this cart';
        els.deleteListBtn.setAttribute('aria-label', els.deleteListBtn.title);
        armTimer = setTimeout(() => {
          delete els.deleteListBtn.dataset.armed;
          renderListBar();
        }, 3000);
        return;
      }
      state.deleteMode = !state.deleteMode;
      renderCurrentView();
    });

    els.listNameInput.addEventListener('change', () => handleRenameList(els.listNameInput.value));
    els.listNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.listNameInput.blur();
      if (e.key === 'Escape') {
        els.listNameInput.value = state.activeList;
        els.listNameInput.blur();
      }
    });

    els.backBtn.addEventListener('click', () => {
      state.viewMode = 'dashboard';
      state.deleteMode = false;
      renderCurrentView();
    });

    storage.subscribeToChanges((changes) => {
      if (changes[STORAGE_KEYS.CART_LISTS]) {
        state.lists = changes[STORAGE_KEYS.CART_LISTS].newValue || state.lists;
        renderCurrentView();
      }
    });
  }

  async function init() {
    cacheEls();
    await C.theme.init();
    // Pull changes from other devices whenever the popup opens; results arrive via storage change events.
    chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});

    const { lists, activeList } = await listsApi.loadLists();
    state.lists = lists;
    state.activeList = activeList;
    state.preferredCurrency = await currencyRates.loadPreferences();

    const ratesResult = await storage.getStorage([STORAGE_KEYS.EXCHANGE_RATES]);
    const cached = ratesResult[STORAGE_KEYS.EXCHANGE_RATES];
    const isStale = !cached || Date.now() - cached.fetchedAt > 1000 * 60 * 60;
    state.rates = isStale ? (await currencyRates.fetchExchangeRates()).rates : cached.rates;

    populateCurrencySelect();
    wireEvents();
    renderCurrentView();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
