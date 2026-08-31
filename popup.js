(() => {
  const LISTS_KEY = "cartLists";
  const ACTIVE_LIST_KEY = "activeList";
  const PREFERRED_CURRENCY_KEY = "preferredCurrency";
  const RATES_CACHE_KEY = "exchangeRates";
  const RATES_URL = "https://open.er-api.com/v6/latest/USD";

  const SUPPORTED_CURRENCIES = [
    "USD", "EUR", "GBP", "ZAR", "JPY", "CAD", "AUD", "INR",
  ];

  const FALLBACK_RATES = {
    USD: 1, EUR: 0.92, GBP: 0.79, ZAR: 18.5, JPY: 150,
    CAD: 1.36, AUD: 1.53, INR: 83,
  };

  const CURRENCY_SYMBOLS = {
    USD: "$", EUR: "€", GBP: "£", ZAR: "R", JPY: "¥",
    CAD: "CA$", AUD: "A$", INR: "₹",
  };

  // ── Safe DOM helpers (never throw on null refs) ─────────────────────────
  const on = (el, event, handler) => { if (el) el.addEventListener(event, handler); };
  const text = (el, val) => { if (el) el.textContent = val; };
  const html = (el, val) => { if (el) el.innerHTML = val; };
  const show = (el) => { if (el) el.style.display = ""; };
  const hide = (el) => { if (el) el.style.display = "none"; };
  const val = (el, v) => { if (el) { if (v !== undefined) el.value = v; return el.value; } return ""; };
  const disabled = (el, v) => { if (el) el.disabled = v; };
  const focus = (el) => { if (el) el.focus(); };
  const placeholder = (el, v) => { if (el) el.placeholder = v; };
  const classAdd = (el, c) => { if (el) el.classList.add(c); };
  const classRemove = (el, c) => { if (el) el.classList.remove(c); };
  const qs = (sel, parent) => (parent || document).querySelector(sel);

  // ── DOM refs ────────────────────────────────────────────────────────────
  const cartListEl = document.getElementById("cart-list");
  const cartCountEl = document.getElementById("cart-count");
  const cartTotalEl = document.getElementById("cart-total");
  const clearAllBtn = document.getElementById("clear-all");
  const currencySelectEl = document.getElementById("currency-select");
  const listSelectEl = document.getElementById("list-select");
  const newListBtn = document.getElementById("new-list-btn");
  const deleteListBtn = document.getElementById("delete-list-btn");
  const renameListBtn = document.getElementById("rename-list-btn");
  const newListForm = document.getElementById("new-list-form");
  const newListInput = document.getElementById("new-list-input");
  const confirmListBtn = document.getElementById("confirm-list-btn");
  const cancelListBtn = document.getElementById("cancel-list-btn");
  const backBtn = document.getElementById("back-btn");

  const listModal = document.getElementById("list-modal");
  const modalProductSummary = document.getElementById("modal-product-summary");
  const modalListOptions = document.getElementById("modal-list-options");
  const modalListInput = document.getElementById("modal-list-input");
  const modalCreateBtn = document.getElementById("modal-create-btn");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");

  const listBarEl = qs(".list-bar");

  // ── State ───────────────────────────────────────────────────────────────
  let preferredCurrency = "USD";
  let rates = { ...FALLBACK_RATES };
  let lists = {};
  let activeList = "";
  let currentItems = [];
  let viewMode = "dashboard";
  let pendingProduct = null;
  let modalActive = false;

  // ── Utilities ───────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeCurrency(code) {
    const v = String(code || "USD").toUpperCase();
    return SUPPORTED_CURRENCIES.includes(v) ? v : "USD";
  }

  function formatMoney(amount, currency) {
    const code = normalizeCurrency(currency);
    const val = Number.isFinite(amount) ? amount : 0;
    const sym = CURRENCY_SYMBOLS[code] || `${code} `;
    const digits = code === "JPY" ? 0 : 2;
    return `${sym}${val.toFixed(digits)}`;
  }

  function convertAmount(amount, fromCurrency, toCurrency) {
    if (!Number.isFinite(amount)) return null;
    const f = normalizeCurrency(fromCurrency);
    const t = normalizeCurrency(toCurrency);
    if (f === t) return amount;
    const fr = rates[f] || FALLBACK_RATES[f] || 1;
    const tr = rates[t] || FALLBACK_RATES[t] || 1;
    return (amount / fr) * tr;
  }

  function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (r) => resolve(r || {}));
    });
  }

  function setStorage(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve());
    });
  }

  // ── List management ─────────────────────────────────────────────────────
  async function loadLists() {
    const result = await getStorage([LISTS_KEY, ACTIVE_LIST_KEY, "cartItems"]);
    lists = result[LISTS_KEY] || {};
    activeList = result[ACTIVE_LIST_KEY] || "";

    if (Array.isArray(result.cartItems) && result.cartItems.length) {
      if (!lists.Default) lists.Default = [];
      const ids = new Set(lists.Default.map((i) => i.id));
      result.cartItems.forEach((it) => { if (!ids.has(it.id)) lists.Default.push(it); });
      await chrome.storage.local.remove("cartItems");
    }

    if (!Object.keys(lists).length) lists.Default = [];
    if (!activeList || !lists[activeList]) {
      activeList = Object.keys(lists)[0] || "Default";
    }
    if (!lists[activeList]) lists[activeList] = [];
    await persistLists();
  }

  async function persistLists() {
    await setStorage({ [LISTS_KEY]: lists, [ACTIVE_LIST_KEY]: activeList });
  }

  function populateListSelector() {
    const names = Object.keys(lists);
    html(listSelectEl, names
      .map((n) => `<option value="${escapeHtml(n)}"${n === activeList ? " selected" : ""}>${escapeHtml(n)}</option>`)
      .join(""));
    disabled(deleteListBtn, names.length <= 1);
  }

  async function switchList(name) {
    if (!lists[name] || name === activeList) return;
    activeList = name;
    await persistLists();
    populateListSelector();
    if (viewMode === "list" && cartListEl) renderItems(lists[activeList] || []);
  }

  async function createList(name) {
    name = name.trim();
    if (!name || lists[name]) return false;
    lists[name] = [];
    activeList = name;
    await persistLists();
    populateListSelector();
    return true;
  }

  async function deleteCurrentList() {
    const names = Object.keys(lists);
    if (names.length <= 1) return;
    if (!confirm(`Delete the entire list "${activeList}"?`)) return;
    delete lists[activeList];
    activeList = names.find((n) => n !== activeList) || "Default";
    if (!lists[activeList]) lists[activeList] = [];
    await persistLists();
    populateListSelector();
    if (viewMode === "list" && cartListEl) renderItems(lists[activeList]);
    else if (cartListEl) renderDashboard();
  }

  async function renameCurrentList() {
    const oldName = activeList;
    if (!oldName || !lists[oldName]) return;
    const raw = prompt("Enter new list name:", oldName);
    if (raw === null) return; // cancelled
    const newName = raw.trim();
    if (!newName || newName === oldName) return;
    if (lists[newName]) {
      alert(`A list named "${newName}" already exists.`);
      return;
    }
    lists[newName] = lists[oldName];
    delete lists[oldName];
    activeList = newName;
    await persistLists();
    populateListSelector();
    if (viewMode === "list" && cartListEl) renderItems(lists[activeList]);
    else if (cartListEl) renderDashboard();
  }

  // ── Item operations ─────────────────────────────────────────────────────
  async function deleteItem(id) {
    if (!confirm("Remove this item from the list?")) return;
    const items = lists[activeList] || [];
    lists[activeList] = items.filter((it) => it.id !== id);
    await persistLists();
    if (cartListEl) renderItems(lists[activeList]);
  }

  async function moveItem(id, targetList) {
    const items = lists[activeList] || [];
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1 || !lists[targetList] || targetList === activeList) return;
    const [item] = items.splice(idx, 1);
    lists[targetList].push(item);
    await persistLists();
    if (cartListEl) renderItems(items);
  }

  async function clearAll() {
    if (!currentItems.length) return;
    if (!confirm("Remove all items in this list?")) return;
    lists[activeList] = [];
    await persistLists();
    if (cartListEl) renderItems([]);
  }

  async function updateItemQuantity(id, qty) {
    const items = lists[activeList] || [];
    const item = items.find((i) => i.id === id);
    if (item) {
      item.quantity = qty;
      await persistLists();
      updateFooter(items);
    }
  }

  // ── Pending product → save with dedup ───────────────────────────────────
  function saveToList(product, listName) {
    if (!product || !lists[listName]) return;
    const existing = lists[listName].find((item) => item.url === product.url);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + (product.quantity || 1);
    } else {
      lists[listName].push({ ...product });
    }
    persistLists();
    chrome.storage.local.remove("pendingProduct").catch(() => {});
    pendingProduct = null;
    modalActive = false;
    hideListModal();
    if (cartListEl) {
      if (viewMode === "list" && activeList === listName) {
        renderItems(lists[listName]);
      } else {
        renderDashboard();
      }
    }
  }

  // ── Currency ────────────────────────────────────────────────────────────
  async function loadPreferences() {
    const r = await getStorage([PREFERRED_CURRENCY_KEY, RATES_CACHE_KEY]);
    preferredCurrency = normalizeCurrency(r[PREFERRED_CURRENCY_KEY] || "USD");
    if (currencySelectEl) currencySelectEl.value = preferredCurrency;
    if (r[RATES_CACHE_KEY] && r[RATES_CACHE_KEY].rates) {
      rates = { ...FALLBACK_RATES, ...r[RATES_CACHE_KEY].rates };
    }
  }

  async function savePreferredCurrency(c) {
    preferredCurrency = normalizeCurrency(c);
    await setStorage({ [PREFERRED_CURRENCY_KEY]: preferredCurrency });
  }

  async function fetchExchangeRates() {
    try {
      const resp = await fetch(RATES_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || !data.rates) throw new Error("Invalid rates payload");
      const nr = { ...FALLBACK_RATES };
      SUPPORTED_CURRENCIES.forEach((code) => { if (typeof data.rates[code] === "number") nr[code] = data.rates[code]; });
      rates = nr;
      await setStorage({ [RATES_CACHE_KEY]: { rates: nr, fetchedAt: new Date().toISOString(), base: "USD" } });
    } catch (e) {
      rates = { ...FALLBACK_RATES };
      console.warn("CrossCart: fallback rates", e);
    }
  }

  // ── Rendering helpers ───────────────────────────────────────────────────
  function calcTotal(items) {
    return items.reduce((sum, item) => {
      const qty = (typeof item.quantity === "number" && item.quantity >= 1) ? item.quantity : 1;
      const price = typeof item.price === "number" ? item.price : null;
      if (!Number.isFinite(price)) return sum;
      const conv = convertAmount(price, item.currency || item.originalCurrency || "USD", preferredCurrency);
      return sum + (Number.isFinite(conv) ? conv * qty : 0);
    }, 0);
  }

  function grandTotals() {
    let total = 0, count = 0;
    Object.keys(lists).forEach((name) => {
      total += calcTotal(lists[name]);
      count += (lists[name] || []).reduce((s, it) => s + (it.quantity || 1), 0);
    });
    return { total, count };
  }

  function updateFooter(items) {
    const totalQty = items.reduce((s, it) => s + (it.quantity || 1), 0);
    text(cartCountEl, `${totalQty} item${totalQty === 1 ? "" : "s"}`);
    text(cartTotalEl, formatMoney(calcTotal(items), preferredCurrency));
  }

  // ── Dashboard (Lists Summary) ───────────────────────────────────────────
  function renderDashboard() {
    viewMode = "dashboard";
    hide(backBtn);
    hide(clearAllBtn);
    show(listBarEl);

    const names = Object.keys(lists);

    const gt = grandTotals();
    text(cartCountEl, `${names.length} list${names.length === 1 ? "" : "s"} · ${gt.count} item${gt.count === 1 ? "" : "s"}`);
    text(cartTotalEl, formatMoney(gt.total, preferredCurrency));

    if (!names.length) {
      html(cartListEl, '<div class="empty">No lists yet.<br />Use “+ Add to CrossCart” on a product page.</div>');
      return;
    }

    html(cartListEl, names.map((name) => {
      const items = lists[name] || [];
      const qtyCount = items.reduce((s, it) => s + (it.quantity || 1), 0);
      const price = calcTotal(items);
      return `
        <article class="list-card" data-list="${escapeHtml(name)}">
          <div class="list-card-header">
            <h3 class="list-card-name">${escapeHtml(name)}</h3>
            <span class="list-card-meta">${qtyCount} item${qtyCount === 1 ? "" : "s"}</span>
          </div>
          <div class="list-card-total">${formatMoney(price, preferredCurrency)}</div>
        </article>`;
    }).join(""));
  }

  // ── List view (items in a specific list) ────────────────────────────────
  function switchToListView(name) {
    if (!lists[name] || !cartListEl) return;
    activeList = name;
    viewMode = "list";
    show(backBtn);
    show(clearAllBtn);
    populateListSelector();
    renderItems(lists[name]);
  }

  function renderItems(items) {
    currentItems = items;
    updateFooter(items);

    if (!items.length) {
      html(cartListEl, `<div class="empty">No products in "${escapeHtml(activeList)}".<br />Use “+ Add to CrossCart” on a product page.</div>`);
      return;
    }

    const otherListOpts = Object.keys(lists)
      .filter((n) => n !== activeList)
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join("");

    html(cartListEl, items.map((item) => {
      const title = escapeHtml(item.title || "Untitled product");
      const url = escapeHtml(item.url || "#");
      const domain = escapeHtml(item.domain || "unknown");
      const image = escapeHtml(item.image || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Crect fill='%23333' width='56' height='56'/%3E%3C/svg%3E");
      const id = escapeHtml(item.id);
      const origCur = normalizeCurrency(item.currency || item.originalCurrency || "USD");
      const origPrice = (typeof item.price === "number" && Number.isFinite(item.price)) ? item.price : null;

      let priceHtml = "N/A", originalHtml = "";
      if (origPrice != null) {
        const conv = convertAmount(origPrice, origCur, preferredCurrency);
        priceHtml = escapeHtml(formatMoney(conv, preferredCurrency));
        if (origCur !== preferredCurrency) {
          originalHtml = `<div class="item-price-original">${escapeHtml(formatMoney(origPrice, origCur))} ${escapeHtml(origCur)}</div>`;
        }
      }

      const qty = (typeof item.quantity === "number" && item.quantity >= 1) ? item.quantity : 1;
      const qtyHtml = `
        <div class="qty-row">
          <button type="button" class="qty-btn qty-minus" data-id="${id}" aria-label="Decrease">&minus;</button>
          <input type="number" class="qty-input" value="${qty}" min="1" max="999" data-id="${id}" />
          <button type="button" class="qty-btn qty-plus" data-id="${id}" aria-label="Increase">+</button>
        </div>`;

      const moveHtml = otherListOpts.length
        ? `<div class="move-row"><select class="move-select" data-id="${id}"><option value="" disabled selected>Move to&hellip;</option>${otherListOpts}</select></div>`
        : "";

      return `
        <article class="item-card" data-id="${id}" draggable="true">
          <span class="drag-handle" aria-label="Drag to reorder">⠿</span>
          <img src="${image}" alt="" />
          <div class="item-meta">
            <a class="item-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
            <div class="item-price">${priceHtml}</div>
            ${originalHtml}
            <span class="domain-badge">${domain}</span>
            ${qtyHtml}
            ${moveHtml}
          </div>
          <button class="delete-btn" type="button" data-id="${id}" aria-label="Remove item">&times;</button>
        </article>`;
    }).join(""));
  }

  // ── List-selection modal ────────────────────────────────────────────────
  function showListModal(product) {
    if (modalActive) return;
    modalActive = true;

    const title = escapeHtml(product.title || "Untitled product");
    const priceStr = product.price
      ? formatMoney(convertAmount(product.price, product.currency || "USD", preferredCurrency) || product.price, preferredCurrency)
      : null;

    html(modalProductSummary,
      priceStr
        ? `<span class="modal-prod-title">${title}</span> <span class="modal-prod-price">${escapeHtml(priceStr)}</span>`
        : `<span class="modal-prod-title">${title}</span>`
    );

    const names = Object.keys(lists);
    if (!names.length) names.push("Default");
    html(modalListOptions, names
      .map((n) => `<button type="button" class="modal-list-btn" data-list="${escapeHtml(n)}">${escapeHtml(n)}</button>`)
      .join(""));

    val(modalListInput, "");
    show(listModal);
    focus(modalListInput);
  }

  function hideListModal() {
    hide(listModal);
    modalActive = false;
  }

  async function checkPendingProduct() {
    const r = await getStorage(["pendingProduct"]);
    if (r.pendingProduct) {
      pendingProduct = r.pendingProduct;
      showListModal(pendingProduct);
    }
  }

  // ── Event listeners (every binding is null-guarded) ─────────────────────

  // Click delegation on cart-list (dashboard cards + item actions)
  on(cartListEl, "click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const card = target.closest(".list-card");
    if (card && viewMode === "dashboard") {
      const name = card.getAttribute("data-list");
      if (name && lists[name]) switchToListView(name);
      return;
    }

    if (target.classList.contains("delete-btn")) {
      event.preventDefault();
      const id = target.getAttribute("data-id");
      if (id) deleteItem(id);
      return;
    }

    if (target.classList.contains("qty-btn")) {
      const id = target.getAttribute("data-id");
      const input = target.parentElement.querySelector(".qty-input");
      if (!input || !id) return;
      let qty = parseInt(input.value, 10) || 1;
      if (target.classList.contains("qty-minus")) { if (qty > 1) qty--; }
      else { if (qty < 999) qty++; }
      input.value = qty;
      updateItemQuantity(id, qty);
    }
  });

  // Change delegation (qty input, move select)
  on(cartListEl, "change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.classList.contains("qty-input")) {
      const id = target.getAttribute("data-id");
      let qty = parseInt(target.value, 10);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      if (qty > 999) qty = 999;
      target.value = qty;
      if (id) updateItemQuantity(id, qty);
      return;
    }

    if (target.classList.contains("move-select")) {
      const id = target.getAttribute("data-id");
      const tgt = target.value;
      target.value = "";
      if (id && tgt) moveItem(id, tgt);
    }
  });

  // ── Drag-and-drop reordering ───────────────────────────────────────────
  let draggedId = null;

  on(cartListEl, "dragstart", (event) => {
    const card = event.target.closest(".item-card");
    if (!card) return;
    const id = card.getAttribute("data-id");
    if (!id) return;
    draggedId = id;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  });

  on(cartListEl, "dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const card = event.target.closest(".item-card");
    if (!card || card.classList.contains("dragging")) return;
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    card.classList.toggle("drop-before", event.clientY < midY);
    card.classList.toggle("drop-after", event.clientY >= midY);
  });

  on(cartListEl, "dragleave", (event) => {
    const card = event.target.closest(".item-card");
    if (card) card.classList.remove("drop-before", "drop-after");
  });

  on(cartListEl, "drop", (event) => {
    event.preventDefault();
    const dropCard = event.target.closest(".item-card");
    if (!dropCard || !draggedId) return;
    const items = lists[activeList];
    if (!items) return;
    const fromIdx = items.findIndex((i) => i.id === draggedId);
    if (fromIdx === -1) return;
    const insertAfter = dropCard.classList.contains("drop-after");
    const [moved] = items.splice(fromIdx, 1);
    let targetIdx = items.findIndex((i) => i.id === dropCard.getAttribute("data-id"));
    if (targetIdx === -1) return;
    if (insertAfter) targetIdx++;
    items.splice(targetIdx, 0, moved);
    lists[activeList] = items;
    persistLists();
    renderItems(items);
  });

  on(cartListEl, "dragend", () => {
    document.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((el) => {
      el.classList.remove("dragging", "drop-before", "drop-after");
    });
    draggedId = null;
  });

  // Modal list-option clicks
  on(modalListOptions, "click", (event) => {
    const btn = event.target.closest(".modal-list-btn");
    if (!btn || !pendingProduct) return;
    const listName = btn.getAttribute("data-list");
    if (listName) saveToList(pendingProduct, listName);
  });

  // Modal create & save
  on(modalCreateBtn, "click", () => {
    if (!pendingProduct) return;
    const name = val(modalListInput).trim();
    if (!name) { focus(modalListInput); return; }
    if (!lists[name]) lists[name] = [];
    saveToList(pendingProduct, name);
  });

  on(modalListInput, "keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); if (modalCreateBtn) modalCreateBtn.click(); }
    if (event.key === "Escape") { if (modalCancelBtn) modalCancelBtn.click(); }
  });

  on(modalCancelBtn, "click", () => {
    if (pendingProduct) {
      chrome.storage.local.remove("pendingProduct").catch(() => {});
      pendingProduct = null;
    }
    modalActive = false;
    hideListModal();
  });

  // Back button → dashboard
  on(backBtn, "click", () => { if (cartListEl) renderDashboard(); });

  on(clearAllBtn, "click", clearAll);

  on(currencySelectEl, "change", async () => {
    await savePreferredCurrency(currencySelectEl.value);
    if (viewMode === "list" && cartListEl) renderItems(currentItems);
    else if (cartListEl) renderDashboard();
  });

  on(listSelectEl, "change", () => {
    switchList(listSelectEl.value);
  });

  on(newListBtn, "click", () => {
    hide(newListBtn);
    classAdd(newListForm, "visible");
    val(newListInput, "");
    focus(newListInput);
  });

  on(confirmListBtn, "click", async () => {
    const name = val(newListInput).trim();
    if (!name) { focus(newListInput); return; }
    if (lists[name]) {
      val(newListInput, "");
      placeholder(newListInput, "Name already exists…");
      focus(newListInput);
      setTimeout(() => { placeholder(newListInput, "List name…"); }, 2000);
      return;
    }
    await createList(name);
    hideNewListForm();
    if (viewMode === "dashboard" && cartListEl) renderDashboard();
  });

  on(cancelListBtn, "click", hideNewListForm);

  on(newListInput, "keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); if (confirmListBtn) confirmListBtn.click(); }
    if (event.key === "Escape") { hideNewListForm(); }
  });

  on(deleteListBtn, "click", deleteCurrentList);
  on(renameListBtn, "click", renameCurrentList);

  function hideNewListForm() {
    classRemove(newListForm, "visible");
    show(newListBtn);
  }

  // Storage change listener
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.pendingProduct && changes.pendingProduct.newValue) {
      pendingProduct = changes.pendingProduct.newValue;
      showListModal(pendingProduct);
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────
  async function init() {
    // If the critical container element is missing, bail out silently.
    if (!cartListEl) {
      console.warn("CrossCart: #cart-list not found — aborting popup init");
      return;
    }

    await loadPreferences();
    await loadLists();
    populateListSelector();
    renderDashboard();
    await checkPendingProduct();
    fetchExchangeRates().then(() => {
      if (viewMode === "list") renderItems(currentItems);
      else renderDashboard();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
