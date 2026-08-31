(function () {
  const C = window.Crosscart;
  const { STORAGE_KEYS, SUPPORTED_CURRENCIES, storage, lists: listsApi, render, dnd, currencyRates } = C;

  const state = {
    lists: {},
    activeList: listsApi.DEFAULT_LIST_NAME,
    preferredCurrency: 'USD',
    rates: currencyRates.FALLBACK_RATES,
    viewMode: 'dashboard',
  };

  const els = {};

  function cacheEls() {
    els.currencySelect = document.getElementById('currency-select');
    els.clearAllBtn = document.getElementById('clear-all-btn');
    els.listSelect = document.getElementById('list-select');
    els.newListBtn = document.getElementById('new-list-btn');
    els.renameListBtn = document.getElementById('rename-list-btn');
    els.deleteListBtn = document.getElementById('delete-list-btn');
    els.newListForm = document.getElementById('new-list-form');
    els.newListInput = document.getElementById('new-list-input');
    els.newListConfirm = document.getElementById('new-list-confirm');
    els.newListCancel = document.getElementById('new-list-cancel');
    els.backBtn = document.getElementById('back-btn');
    els.cartList = document.getElementById('cart-list');
    els.footer = document.getElementById('footer-summary');
    els.modal = document.getElementById('save-modal');
    els.modalListSelect = document.getElementById('modal-list-select');
    els.modalSave = document.getElementById('modal-save');
    els.modalCancel = document.getElementById('modal-cancel');
  }

  function populateCurrencySelect() {
    els.currencySelect.innerHTML = SUPPORTED_CURRENCIES.map(
      (c) => `<option value="${c}" ${c === state.preferredCurrency ? 'selected' : ''}>${c}</option>`
    ).join('');
  }

  function populateListSelector() {
    const names = Object.keys(state.lists);
    els.listSelect.innerHTML = names
      .map((n) => `<option value="${n}" ${n === state.activeList ? 'selected' : ''}>${n}</option>`)
      .join('');
  }

  function renderCurrentView() {
    if (state.viewMode === 'dashboard') {
      els.backBtn.style.display = 'none';
      render.renderDashboard(els.cartList, state.lists, state.preferredCurrency, state.rates, (name) => {
        state.activeList = name;
        state.viewMode = 'list';
        populateListSelector();
        renderCurrentView();
      });
      const allItems = Object.values(state.lists).flat();
      render.updateFooter(els.footer, allItems, state.preferredCurrency, state.rates);
    } else {
      els.backBtn.style.display = '';
      const items = state.lists[state.activeList] || [];
      render.renderItems(els.cartList, items, state.activeList, state.preferredCurrency, state.rates, {
        onDelete: handleDeleteItem,
        onQuantityChange: handleQuantityChange,
      });
      dnd.attachDragAndDrop(els.cartList, items, handleReorder);
      render.updateFooter(els.footer, items, state.preferredCurrency, state.rates);
    }
  }

  async function persist() {
    await listsApi.persistLists(state.lists, state.activeList);
  }

  async function handleDeleteItem(itemId) {
    state.lists = listsApi.deleteItem(state.lists, state.activeList, itemId);
    await persist();
    renderCurrentView();
  }

  async function handleQuantityChange(itemId, qty) {
    state.lists = listsApi.updateItemQuantity(state.lists, state.activeList, itemId, qty);
    await persist();
    renderCurrentView();
  }

  async function handleReorder(reordered) {
    state.lists = { ...state.lists, [state.activeList]: reordered };
    await persist();
    renderCurrentView();
  }

  async function handleCreateList(name) {
    state.lists = listsApi.createList(state.lists, name);
    state.activeList = name;
    await persist();
    populateListSelector();
  }

  async function handleDeleteList() {
    state.lists = listsApi.deleteList(state.lists, state.activeList);
    state.activeList = Object.keys(state.lists)[0];
    await persist();
    populateListSelector();
    state.viewMode = 'dashboard';
    renderCurrentView();
  }

  async function handleRenameList() {
    const newName = prompt('Rename list to:', state.activeList);
    if (!newName) return;
    state.lists = listsApi.renameList(state.lists, state.activeList, newName);
    state.activeList = newName;
    await persist();
    populateListSelector();
    renderCurrentView();
  }

  async function handleClearAll() {
    state.lists = listsApi.clearAll(state.lists, state.activeList);
    await persist();
    renderCurrentView();
  }

  function showListModal(product) {
    els.modalListSelect.innerHTML = Object.keys(state.lists)
      .map((n) => `<option value="${n}">${render.escapeHtml(n)}</option>`)
      .join('');
    els.modal.dataset.pendingProduct = JSON.stringify(product);
    els.modal.style.display = '';
  }

  function hideListModal() {
    els.modal.style.display = 'none';
    delete els.modal.dataset.pendingProduct;
  }

  async function checkPendingProduct() {
    const result = await storage.getStorage([STORAGE_KEYS.PENDING_PRODUCT, STORAGE_KEYS.PENDING_PRODUCT_TIMESTAMP]);
    const product = result[STORAGE_KEYS.PENDING_PRODUCT];
    if (product) showListModal(product);
  }

  async function consumePendingProduct(listName) {
    const raw = els.modal.dataset.pendingProduct;
    if (!raw) return;
    const product = JSON.parse(raw);
    state.lists = listsApi.saveToList(state.lists, listName, product);
    state.activeList = listName;
    await persist();
    await storage.setStorage({
      [STORAGE_KEYS.PENDING_PRODUCT]: null,
      [STORAGE_KEYS.PENDING_PRODUCT_TIMESTAMP]: null,
    });
    hideListModal();
    populateListSelector();
    state.viewMode = 'list';
    renderCurrentView();
  }

  function wireEvents() {
    els.currencySelect.addEventListener('change', async () => {
      state.preferredCurrency = els.currencySelect.value;
      await currencyRates.savePreferredCurrency(state.preferredCurrency);
      renderCurrentView();
    });

    els.clearAllBtn.addEventListener('click', handleClearAll);

    els.listSelect.addEventListener('change', () => {
      state.activeList = els.listSelect.value;
      state.viewMode = 'list';
      renderCurrentView();
    });

    els.newListBtn.addEventListener('click', () => {
      els.newListForm.style.display = '';
      els.newListInput.value = '';
      els.newListInput.focus();
    });

    els.newListCancel.addEventListener('click', () => {
      els.newListForm.style.display = 'none';
    });

    els.newListConfirm.addEventListener('click', async () => {
      const name = els.newListInput.value.trim();
      if (!name) return;
      await handleCreateList(name);
      els.newListForm.style.display = 'none';
      state.viewMode = 'list';
      renderCurrentView();
    });

    els.renameListBtn.addEventListener('click', handleRenameList);
    els.deleteListBtn.addEventListener('click', handleDeleteList);

    els.backBtn.addEventListener('click', () => {
      state.viewMode = 'dashboard';
      renderCurrentView();
    });

    els.modalSave.addEventListener('click', () => consumePendingProduct(els.modalListSelect.value));
    els.modalCancel.addEventListener('click', async () => {
      await storage.setStorage({
        [STORAGE_KEYS.PENDING_PRODUCT]: null,
        [STORAGE_KEYS.PENDING_PRODUCT_TIMESTAMP]: null,
      });
      hideListModal();
    });

    storage.subscribeToChanges((changes) => {
      if (changes[STORAGE_KEYS.PENDING_PRODUCT] && changes[STORAGE_KEYS.PENDING_PRODUCT].newValue) {
        showListModal(changes[STORAGE_KEYS.PENDING_PRODUCT].newValue);
      }
      if (changes[STORAGE_KEYS.CART_LISTS]) {
        state.lists = changes[STORAGE_KEYS.CART_LISTS].newValue || state.lists;
        renderCurrentView();
      }
    });
  }

  async function init() {
    cacheEls();

    const { lists, activeList } = await listsApi.loadLists();
    state.lists = lists;
    state.activeList = activeList;
    state.preferredCurrency = await currencyRates.loadPreferences();

    const ratesResult = await storage.getStorage([STORAGE_KEYS.EXCHANGE_RATES]);
    const cached = ratesResult[STORAGE_KEYS.EXCHANGE_RATES];
    const isStale = !cached || Date.now() - cached.fetchedAt > 1000 * 60 * 60;
    state.rates = isStale ? (await currencyRates.fetchExchangeRates()).rates : cached.rates;

    populateCurrencySelect();
    populateListSelector();
    wireEvents();
    renderCurrentView();

    await checkPendingProduct();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
