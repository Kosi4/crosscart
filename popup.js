(() => {
  const STORAGE_KEY = "cartItems";
  const PREFERRED_CURRENCY_KEY = "preferredCurrency";
  const RATES_CACHE_KEY = "exchangeRates";
  const RATES_URL = "https://open.er-api.com/v6/latest/USD";

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

  const FALLBACK_RATES = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    ZAR: 18.5,
    JPY: 150,
    CAD: 1.36,
    AUD: 1.53,
    INR: 83,
  };

  const CURRENCY_SYMBOLS = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    ZAR: "R",
    JPY: "¥",
    CAD: "CA$",
    AUD: "A$",
    INR: "₹",
  };

  const cartListEl = document.getElementById("cart-list");
  const cartCountEl = document.getElementById("cart-count");
  const cartTotalEl = document.getElementById("cart-total");
  const clearAllBtn = document.getElementById("clear-all");
  const currencySelectEl = document.getElementById("currency-select");

  let preferredCurrency = "USD";
  let rates = { ...FALLBACK_RATES };
  let cartItems = [];

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeCurrency(code) {
    const value = String(code || "USD").toUpperCase();
    return SUPPORTED_CURRENCIES.includes(value) ? value : "USD";
  }

  function formatMoney(amount, currency) {
    const code = normalizeCurrency(currency);
    const value = Number.isFinite(amount) ? amount : 0;
    const symbol = CURRENCY_SYMBOLS[code] || `${code} `;
    const digits = code === "JPY" ? 0 : 2;
    return `${symbol}${value.toFixed(digits)}`;
  }

  function convertAmount(amount, fromCurrency, toCurrency) {
    if (!Number.isFinite(amount)) return null;

    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    if (from === to) return amount;

    const fromRate = rates[from] || FALLBACK_RATES[from] || 1;
    const toRate = rates[to] || FALLBACK_RATES[to] || 1;
    const usdAmount = amount / fromRate;
    return usdAmount * toRate;
  }

  function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function setStorage(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve());
    });
  }

  async function loadPreferences() {
    const result = await getStorage([
      PREFERRED_CURRENCY_KEY,
      RATES_CACHE_KEY,
      STORAGE_KEY,
    ]);

    preferredCurrency = normalizeCurrency(
      result[PREFERRED_CURRENCY_KEY] || "USD"
    );
    currencySelectEl.value = preferredCurrency;

    if (result[RATES_CACHE_KEY] && result[RATES_CACHE_KEY].rates) {
      rates = { ...FALLBACK_RATES, ...result[RATES_CACHE_KEY].rates };
    }

    cartItems = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  }

  async function savePreferredCurrency(currency) {
    preferredCurrency = normalizeCurrency(currency);
    await setStorage({ [PREFERRED_CURRENCY_KEY]: preferredCurrency });
  }

  async function fetchExchangeRates() {
    try {
      const response = await fetch(RATES_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !data.rates) throw new Error("Invalid rates payload");

      const nextRates = { ...FALLBACK_RATES };
      SUPPORTED_CURRENCIES.forEach((code) => {
        if (typeof data.rates[code] === "number") {
          nextRates[code] = data.rates[code];
        }
      });

      rates = nextRates;
      await setStorage({
        [RATES_CACHE_KEY]: {
          rates: nextRates,
          fetchedAt: new Date().toISOString(),
          base: "USD",
        },
      });
    } catch (error) {
      rates = { ...FALLBACK_RATES };
      console.warn("CrossCart: using fallback exchange rates", error);
    }
  }

  function calcTotal(items) {
    return items.reduce((sum, item) => {
      const price = typeof item.price === "number" ? item.price : null;
      if (!Number.isFinite(price)) return sum;
      const converted = convertAmount(
        price,
        item.currency || item.originalCurrency || "USD",
        preferredCurrency
      );
      return sum + (Number.isFinite(converted) ? converted : 0);
    }, 0);
  }

  function updateFooter(items) {
    const count = items.length;
    cartCountEl.textContent = `${count} item${count === 1 ? "" : "s"}`;
    cartTotalEl.textContent = formatMoney(
      calcTotal(items),
      preferredCurrency
    );
  }

  function renderItems(items) {
    cartItems = items;
    updateFooter(items);

    if (!items.length) {
      cartListEl.innerHTML =
        '<div class="empty">No products saved yet.<br />Use “+ Add to CrossCart” on a product page.</div>';
      return;
    }

    cartListEl.innerHTML = items
      .map((item) => {
        const title = escapeHtml(item.title || "Untitled product");
        const url = escapeHtml(item.url || "#");
        const domain = escapeHtml(item.domain || "unknown");
        const image = escapeHtml(
          item.image ||
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Crect fill='%23333' width='56' height='56'/%3E%3C/svg%3E"
        );
        const id = escapeHtml(item.id);
        const originalCurrency = normalizeCurrency(
          item.currency || item.originalCurrency || "USD"
        );
        const originalPrice =
          typeof item.price === "number" && Number.isFinite(item.price)
            ? item.price
            : null;

        let priceHtml = "N/A";
        let originalHtml = "";

        if (originalPrice != null) {
          const converted = convertAmount(
            originalPrice,
            originalCurrency,
            preferredCurrency
          );
          priceHtml = escapeHtml(
            formatMoney(converted, preferredCurrency)
          );

          if (originalCurrency !== preferredCurrency) {
            originalHtml = `<div class="item-price-original">${escapeHtml(
              formatMoney(originalPrice, originalCurrency)
            )} ${escapeHtml(originalCurrency)}</div>`;
          }
        }

        return `
          <article class="item-card" data-id="${id}">
            <img src="${image}" alt="" />
            <div class="item-meta">
              <a class="item-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
              <div class="item-price">${priceHtml}</div>
              ${originalHtml}
              <span class="domain-badge">${domain}</span>
            </div>
            <button class="delete-btn" type="button" data-id="${id}" aria-label="Remove item">×</button>
          </article>
        `;
      })
      .join("");
  }

  async function deleteItem(id) {
    const result = await getStorage([STORAGE_KEY]);
    const items = Array.isArray(result[STORAGE_KEY])
      ? result[STORAGE_KEY]
      : [];
    const next = items.filter((item) => item.id !== id);
    await setStorage({ [STORAGE_KEY]: next });
    renderItems(next);
  }

  async function clearAll() {
    await setStorage({ [STORAGE_KEY]: [] });
    renderItems([]);
  }

  cartListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.classList.contains("delete-btn")) {
      event.preventDefault();
      const id = target.getAttribute("data-id");
      if (id) deleteItem(id);
    }
  });

  clearAllBtn.addEventListener("click", () => {
    clearAll();
  });

  currencySelectEl.addEventListener("change", async () => {
    await savePreferredCurrency(currencySelectEl.value);
    renderItems(cartItems);
  });

  async function init() {
    await loadPreferences();
    renderItems(cartItems);
    await fetchExchangeRates();
    renderItems(cartItems);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
