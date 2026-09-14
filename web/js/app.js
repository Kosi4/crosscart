(function () {
  const C = window.Crosscart;
  const { STORAGE_KEYS, SUPPORTED_CURRENCIES, storage, lists: listsApi, currencyRates, theme, api } = C;
  const esc = C.dom.escapeHtml;
  const { safeUrl } = C.dom;

  const MODE_KEY = 'crosscart-mode';
  const FEE_RATE = 0.025;
  const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R', JPY: '¥', CAD: 'CA$', AUD: 'A$', INR: '₹' };
  const APP_SCREENS = ['carts', 'cart', 'checkout', 'placing', 'confirm', 'orders'];
  const RATES_MAX_AGE_MS = 1000 * 60 * 60;

  const state = {
    screen: 'landing',
    mode: null,
    loadedMode: null,
    extension: null,
    carts: {},
    activeCart: null,
    currency: 'USD',
    rates: currencyRates.FALLBACK_RATES,
    collapsed: {},
    selected: {},
    form: {},
    order: null,
  };

  const root = document.getElementById('app');

  // ---------- money ----------

  function toUsd(item) {
    return currencyRates.convertAmount(item.price, item.currency || 'USD', 'USD', state.rates);
  }

  function fmt(usd) {
    const code = state.currency;
    const value = currencyRates.convertAmount(usd, 'USD', code, state.rates);
    const digits = code === 'JPY' ? 0 : 2;
    const number = (Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return (SYMBOLS[code] || code + ' ') + number;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Locale month names vary ("Sept" in en-GB); the design uses fixed three-letter months.
  function fmtDate(iso) {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  // ---------- cart math ----------

  function cartItems() {
    return state.carts[state.activeCart] || [];
  }

  function isSelected(item) {
    return item.id in state.selected ? state.selected[item.id] : !api.checkItem(item).oos;
  }

  function lineUsd(item) {
    const usd = toUsd(item);
    return (Number.isFinite(usd) ? usd : 0) * (item.quantity || 1);
  }

  function goodsUsd(items) {
    return items.reduce((sum, item) => sum + lineUsd(item), 0);
  }

  function groupByStore(items) {
    const groups = [];
    items.forEach((item) => {
      let group = groups.find((g) => g.domain === item.domain);
      if (!group) {
        group = { domain: item.domain, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });
    return groups;
  }

  // Out-of-stock items stay selectable (the warning explains they're skipped) but are never charged.
  function checkoutTotals() {
    const chosen = cartItems().filter(isSelected);
    const charged = chosen.filter((item) => !api.checkItem(item).oos);
    const groups = groupByStore(charged);
    const goods = goodsUsd(charged);
    const shipping = groups.reduce((sum, g) => sum + api.storeInfo(g.domain).shipUsd, 0);
    const fee = goods * FEE_RATE;
    return { chosen, charged, groups, goods, shipping, fee, total: goods + shipping + fee };
  }

  // ---------- data ----------

  function sessionGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function sessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {}
  }

  function setMode(mode) {
    state.mode = mode;
    sessionSet(MODE_KEY, mode);
  }

  async function loadData() {
    if (state.loadedMode === state.mode) return;
    state.loadedMode = state.mode;
    state.selected = {};
    state.collapsed = {};

    if (state.mode === 'demo') {
      state.carts = JSON.parse(JSON.stringify(api.DEMO_CARTS));
      state.activeCart = state.activeCart && state.carts[state.activeCart] ? state.activeCart : 'General';
      return;
    }

    state.extension = await storage.isAvailable();
    if (!state.extension) {
      state.carts = {};
      state.activeCart = null;
      return;
    }

    const { lists, activeList } = await listsApi.loadLists();
    state.carts = lists;
    state.activeCart = state.activeCart && lists[state.activeCart] ? state.activeCart : activeList;
    state.currency = await currencyRates.loadPreferences();

    const ratesResult = await storage.getStorage([STORAGE_KEYS.EXCHANGE_RATES]);
    const cached = ratesResult[STORAGE_KEYS.EXCHANGE_RATES];
    const stale = !cached || Date.now() - cached.fetchedAt > RATES_MAX_AGE_MS;
    state.rates = stale ? (await currencyRates.fetchExchangeRates()).rates : cached.rates;
  }

  async function commitCarts(next) {
    state.carts = next;
    render();
    if (state.mode !== 'real') return;
    try {
      await listsApi.persistLists(state.carts, state.activeCart);
    } catch (e) {
      state.extension = false;
      render();
    }
  }

  // ---------- routing ----------

  function go(screen) {
    const hash = '#/' + screen;
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  async function route() {
    let screen = location.hash.replace(/^#\//, '') || 'landing';
    if (screen !== 'landing' && screen !== 'signin' && !APP_SCREENS.includes(screen)) screen = 'landing';

    if (APP_SCREENS.includes(screen)) {
      if (!state.mode) state.mode = sessionGet(MODE_KEY) || (api.getSession() ? 'real' : null);
      if (!state.mode) return go('signin');
      if ((screen === 'placing' || screen === 'confirm') && !state.order) return go('orders');
    }

    state.screen = screen;
    render();

    if (APP_SCREENS.includes(screen)) {
      await loadData();
      if ((screen === 'cart' || screen === 'checkout') && !state.carts[state.activeCart]) return go('carts');
      render();
    }
  }

  // ---------- actions ----------

  const actions = {
    goLanding: () => go('landing'),
    goSignIn: () => go('signin'),
    goCarts: () => go('carts'),
    goCart: () => go('cart'),
    goCheckout: () => go('checkout'),
    goOrders: () => go('orders'),

    signIn: (provider) => {
      api.signIn(provider);
      setMode('real');
      go('carts');
    },

    demo: () => {
      setMode('demo');
      go('carts');
    },

    toggleTheme: () => theme.set(theme.current() === 'light' ? 'dark' : 'light'),

    openCart: (name) => {
      state.activeCart = name;
      go('cart');
    },

    toggleGroup: (domain) => {
      state.collapsed[domain] = !state.collapsed[domain];
      render();
    },

    removeItem: (id) => commitCarts(listsApi.deleteItem(state.carts, state.activeCart, id)),

    placeOrders: () => {
      const totals = checkoutTotals();
      if (!totals.groups.length) return;
      const legs = totals.groups.map((g) => ({
        domain: g.domain,
        amountUsd: goodsUsd(g.items) + api.storeInfo(g.domain).shipUsd,
      }));
      state.order = api.placeOrder(state.activeCart, legs, totals.total);
      state.form = {};
      go('placing');
      setTimeout(() => {
        if (state.screen === 'placing') go('confirm');
      }, 2600);
    },

    retry: (domain) => {
      const orderId = state.order.id;
      state.order = api.setLegState(orderId, domain, 'retrying');
      render();
      setTimeout(() => {
        const updated = api.setLegState(orderId, domain, 'confirmed');
        if (state.order && state.order.id === orderId) state.order = updated;
        render();
      }, 1800);
    },
  };

  const changes = {
    currency: async (el) => {
      state.currency = el.value;
      render();
      if (state.mode === 'real' && state.extension) {
        try {
          await currencyRates.savePreferredCurrency(state.currency);
        } catch (e) {}
      }
    },
    select: (el) => {
      state.selected[el.dataset.arg] = el.checked;
      render();
    },
    quantity: (el) => {
      const qty = Math.max(1, Number(el.value) || 1);
      commitCarts(listsApi.updateItemQuantity(state.carts, state.activeCart, el.dataset.arg, qty));
    },
  };

  root.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const action = actions[el.dataset.action];
    if (action) action(el.dataset.arg);
  });

  root.addEventListener('change', (event) => {
    const el = event.target.closest('[data-change]');
    if (!el) return;
    const handler = changes[el.dataset.change];
    if (handler) handler(el);
  });

  // Checkout fields aren't state-driven, but re-renders (currency, live list sync) must not wipe what was typed.
  root.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset && el.dataset.field) state.form[el.dataset.field] = el.value;
  });

  // ---------- views ----------

  function themeLabel() {
    return theme.current() === 'light' ? 'Dark mode' : 'Light mode';
  }

  function landingView() {
    const steps = [
      ['01 — Save', 'Add from any store', 'The extension puts an add button on product pages and reads the title, price and image off the page.'],
      ['02 — Compare', 'One running total', 'Everything converted into the currency you think in, across as many named lists as you want.'],
      ['03 — Pay once', 'We check out for you', "CrossCart places each store's order with your saved card, then reports back per store."],
    ];
    return `
      <div class="cc-landing">
        <div class="cc-topbar cc-glass">
          <img src="../icons/icon48.png" alt="" style="width:26px;height:26px;border-radius:8px" />
          <div class="cc-brand">CrossCart</div>
          <button class="cc-btn cc-btn-glass cc-btn-inset" data-action="toggleTheme">${themeLabel()}</button>
          <button class="cc-btn cc-btn-primary" data-action="goSignIn">Sign in</button>
        </div>

        <div class="cc-hero">
          <div class="cc-pill-label">Chrome extension + web checkout</div>
          <h1>Your cart, wherever you shop</h1>
          <p>Save products from any online store into one cart. When you're ready, CrossCart checks out on every store for you — you pay once, here.</p>
          <div class="cc-hero-actions">
            <button class="cc-btn cc-btn-lg cc-btn-primary" data-action="goSignIn">Open my cart</button>
            <button class="cc-btn cc-btn-lg cc-btn-glass" data-action="demo">See a demo cart</button>
          </div>
        </div>

        <div class="cc-steps">
          ${steps
            .map(
              ([eyebrow, title, body]) => `
            <div class="cc-card cc-step">
              <div class="cc-eyebrow">${eyebrow}</div>
              <div class="cc-step-title">${title}</div>
              <p>${body}</p>
            </div>`
            )
            .join('')}
        </div>
      </div>`;
  }

  function signInView() {
    return `
      <div class="cc-center">
        <div class="cc-signin cc-glass">
          <img src="../icons/icon128.png" alt="" style="width:44px;height:44px;border-radius:12px" />
          <div class="cc-signin-title">Sign in to CrossCart</div>
          <div class="cc-muted" style="margin-top:8px">Your saved lists follow you from the extension.</div>
          <div class="cc-signin-actions">
            <button class="cc-btn cc-btn-surface" data-action="signIn" data-arg="google">Continue with Google</button>
            <button class="cc-btn cc-btn-primary" data-action="signIn" data-arg="apple">Continue with Apple</button>
          </div>
          <div class="cc-faint" style="font-size:12px;margin-top:22px;text-wrap:pretty">By continuing you let CrossCart place orders on stores on your behalf.</div>
        </div>
      </div>`;
  }

  function summaryRows(totals) {
    const rows = [
      [`Items (${totals.charged.length})`, fmt(totals.goods)],
      [`Shipping · ${totals.groups.length} stores`, fmt(totals.shipping)],
      ['CrossCart fee (2.5%)', fmt(totals.fee)],
    ];
    return `<div class="cc-summary-rows">${rows
      .map(([label, value]) => `<div class="cc-summary-row"><div class="cc-grow">${label}</div><div>${value}</div></div>`)
      .join('')}</div>`;
  }

  function cartsView() {
    const notice =
      state.mode === 'real' && state.extension === false
        ? `
        <div class="cc-card cc-notice">
          <div style="font-weight:700;font-size:15px">CrossCart extension not detected</div>
          <div class="cc-muted" style="margin-top:4px">Install the extension and reload this page to see the lists you've saved, or look around with a demo cart.</div>
          <div class="cc-actions" style="margin-top:14px">
            <button class="cc-btn cc-btn-md cc-btn-glass" data-action="demo">See a demo cart</button>
          </div>
        </div>`
        : '';

    const cards = Object.entries(state.carts)
      .map(([name, items]) => {
        const count = items.reduce((n, i) => n + (i.quantity || 1), 0);
        const stores = [...new Set(items.map((i) => api.storeInfo(i.domain).name))];
        return `
        <button class="cc-card cc-cart-card" data-action="openCart" data-arg="${esc(name)}">
          <div class="cc-cart-card-head">
            <div class="cc-cart-card-name">${esc(name)}</div>
            <div>${fmt(goodsUsd(items))}</div>
          </div>
          <div class="cc-cart-card-meta">${count} ${count === 1 ? 'item' : 'items'}</div>
          <div class="cc-chips">${stores.map((s) => `<div class="cc-chip">${esc(s)}</div>`).join('')}</div>
        </button>`;
      })
      .join('');

    return `${notice}<div class="cc-grid-2">${cards}</div>`;
  }

  function cartView(totals) {
    const groups = groupByStore(cartItems())
      .map((group) => {
        const store = api.storeInfo(group.domain);
        const open = !state.collapsed[group.domain];
        const rows = group.items
          .map((item) => {
            const check = api.checkItem(item);
            const flag = check.oos
              ? 'Out of stock at this store'
              : check.wasPrice
                ? `Price rose from ${fmt(currencyRates.convertAmount(check.wasPrice, item.currency || 'USD', 'USD', state.rates))} since you saved it`
                : '';
            const img = safeUrl(item.image);
            return `
            <div class="cc-row">
              <input type="checkbox" ${isSelected(item) ? 'checked' : ''} data-change="select" data-arg="${esc(item.id)}" aria-label="Select ${esc(item.title)}" />
              ${img ? `<img class="cc-thumb" src="${esc(img)}" alt="" />` : '<div class="cc-thumb"></div>'}
              <div class="cc-grow">
                <div class="cc-ellipsis">${esc(item.title)}</div>
                ${flag ? `<div class="cc-flag">${flag}</div>` : ''}
              </div>
              <input class="cc-qty" type="number" min="1" value="${item.quantity || 1}" data-change="quantity" data-arg="${esc(item.id)}" aria-label="Quantity" />
              <div class="cc-price">${fmt(lineUsd(item))}</div>
              <button class="cc-remove" data-action="removeItem" data-arg="${esc(item.id)}">Remove</button>
            </div>`;
          })
          .join('');
        return `
        <div class="cc-card cc-group">
          <button class="cc-group-head" data-action="toggleGroup" data-arg="${esc(group.domain)}" aria-expanded="${open}">
            <div class="cc-grow">
              <div class="cc-group-store">${esc(store.name)}</div>
              <div class="cc-group-domain">${esc(group.domain)}</div>
            </div>
            <div style="font-weight:700">${fmt(goodsUsd(group.items.filter(isSelected)))}</div>
            <div class="cc-caret">${open ? '▾' : '▸'}</div>
          </button>
          ${open ? `<div>${rows}</div>` : ''}
        </div>`;
      })
      .join('');

    return `
      <div class="cc-two-col">
        <div class="cc-stack">${groups}</div>
        <div class="cc-summary cc-glass">
          <div class="cc-summary-title">Summary</div>
          ${summaryRows(totals)}
          <div class="cc-summary-total"><div class="cc-grow">Total</div><div>${fmt(totals.total)}</div></div>
          <button class="cc-btn cc-btn-block cc-btn-primary" data-action="goCheckout" ${totals.charged.length ? '' : 'disabled'}>Check out ${totals.chosen.length} items</button>
          <div class="cc-note">Orders are placed store by store. Unselected items stay in the list.</div>
        </div>
      </div>`;
  }

  function field(name, placeholder, span, autocomplete) {
    return `<input class="${span ? 'cc-span-2' : ''}" placeholder="${placeholder}" data-field="${name}" value="${esc(state.form[name] || '')}" autocomplete="${autocomplete}" />`;
  }

  function checkoutView(totals) {
    const breakdown = totals.groups
      .map((g) => {
        const store = api.storeInfo(g.domain);
        return `
        <div class="cc-line">
          <div class="cc-grow">
            <div style="font-weight:600">${esc(store.name)}</div>
            <div class="cc-line-meta">${g.items.length} items · ${fmt(store.shipUsd)} shipping</div>
          </div>
          <div style="font-weight:700">${fmt(goodsUsd(g.items) + store.shipUsd)}</div>
        </div>`;
      })
      .join('');

    const warnings = [];
    totals.chosen.forEach((item) => {
      const check = api.checkItem(item);
      if (check.wasPrice) {
        const was = currencyRates.convertAmount(check.wasPrice, item.currency || 'USD', 'USD', state.rates);
        warnings.push(`${esc(item.title)} now costs ${fmt(toUsd(item))}, up from ${fmt(was)}. We will buy it anyway.`);
      }
    });
    totals.chosen.forEach((item) => {
      if (api.checkItem(item).oos) warnings.push(`${esc(item.title)} is out of stock and will be skipped.`);
    });

    return `
      <div class="cc-two-col cc-wide-side">
        <div class="cc-stack">
          <div class="cc-card cc-panel">
            <div class="cc-panel-title">Ship to</div>
            <div class="cc-form">
              ${field('name', 'Full name', true, 'name')}
              ${field('street', 'Street address', true, 'street-address')}
              ${field('city', 'City', false, 'address-level2')}
              ${field('postal', 'Postal code', false, 'postal-code')}
              ${field('country', 'Country', true, 'country-name')}
            </div>
            <div class="cc-panel-note">Each store ships separately, to this address.</div>
          </div>

          <div class="cc-card cc-panel">
            <div class="cc-panel-title">Pay with</div>
            <div class="cc-form">
              ${field('card', 'Card number', true, 'cc-number')}
              ${field('exp', 'MM / YY', false, 'cc-exp')}
              ${field('cvc', 'CVC', false, 'cc-csc')}
            </div>
            <div class="cc-panel-note">CrossCart charges this card once, then pays each store on your behalf.</div>
          </div>

          <div class="cc-card cc-panel">
            <div class="cc-panel-title">Per-store breakdown</div>
            <div style="display:flex;flex-direction:column;margin-top:8px">${breakdown}</div>
            ${
              warnings.length
                ? `<div class="cc-warnings">
                    <div class="cc-warnings-title">Before you pay</div>
                    <div class="cc-warnings-list">${warnings.map((w) => `<div>${w}</div>`).join('')}</div>
                  </div>`
                : ''
            }
          </div>
        </div>

        <div class="cc-summary cc-glass">
          <div class="cc-summary-title">One payment</div>
          ${summaryRows(totals)}
          <div class="cc-summary-total cc-big"><div class="cc-grow">Total</div><div>${fmt(totals.total)}</div></div>
          <button class="cc-btn cc-btn-block cc-btn-lg cc-btn-primary" data-action="placeOrders" ${totals.groups.length ? '' : 'disabled'}>Place ${totals.groups.length} orders</button>
          <button class="cc-btn cc-btn-block cc-btn-plain" data-action="goCart">Back to cart</button>
        </div>
      </div>`;
  }

  function placingView() {
    const order = state.order;
    return `
      <div class="cc-placing cc-glass">
        <div class="cc-spinner"></div>
        <div style="font-weight:700;font-size:20px;letter-spacing:-0.02em;margin-top:22px">Placing your orders</div>
        <div class="cc-muted" style="margin-top:8px;text-wrap:pretty">CrossCart is checking out on ${order.legs.length} stores with your card. This takes about a minute — you can leave this page.</div>
        <div style="font-weight:700;font-size:17px;margin-top:22px">${fmt(order.totalUsd)} charged</div>
      </div>`;
  }

  const RESULT_LEG = {
    confirmed: ['Confirmed', 'Paid · confirmation emailed'],
    failed: ['Failed', 'Card declined at checkout — retried twice'],
    retrying: ['Retrying…', 'Placing order again'],
  };

  function confirmView() {
    const order = state.order;
    const failed = order.legs.filter((l) => l.state === 'failed').length;
    const headline = failed ? `${failed} of ${order.legs.length} store orders needs attention` : 'All store orders confirmed';
    const legs = order.legs
      .map((leg) => {
        const [label, meta] = RESULT_LEG[leg.state] || [leg.state, ''];
        return `
        <div class="cc-leg">
          <div class="cc-leg-info">
            <div style="font-weight:600">${esc(api.storeInfo(leg.domain).name)}</div>
            <div class="cc-line-meta">${meta}</div>
          </div>
          <div class="cc-status" data-state="${esc(leg.state)}">${label}</div>
          <div class="cc-amount">${fmt(leg.amountUsd)}</div>
          ${leg.state === 'failed' ? `<button class="cc-btn cc-btn-primary cc-btn-inset" data-action="retry" data-arg="${esc(leg.domain)}">Retry</button>` : ''}
        </div>`;
      })
      .join('');

    return `
      <div style="max-width:720px">
        <div class="cc-card cc-panel">
          <div class="cc-result-head">
            <div class="cc-grow" style="font-weight:700;font-size:17px">${headline}</div>
            <div class="cc-faint" style="font-size:12.5px">Order ${esc(order.id)} · ${fmtDate(order.date)}</div>
          </div>
          <div style="display:flex;flex-direction:column;margin-top:10px">${legs}</div>
        </div>
        <div class="cc-actions">
          <button class="cc-btn cc-btn-md cc-btn-glass" data-action="goOrders">Track these orders</button>
          <button class="cc-btn cc-btn-md cc-btn-plain" data-action="goCarts">Back to carts</button>
        </div>
      </div>`;
  }

  const ORDER_LEG = {
    confirmed: (leg, i) => ['Shipped', 'Tracking DHL 4471' + i],
    failed: () => ['Failed', 'Awaiting retry'],
    retrying: () => ['Retrying…', 'Placing order again'],
    delivered: (leg) => ['Delivered', leg.note],
  };

  function ordersView() {
    const orders = api
      .listOrders()
      .map((order) => {
        const legs = order.legs
          .map((leg, i) => {
            const [status, tracking] = (ORDER_LEG[leg.state] || (() => [leg.state, '']))(leg, i);
            return `
            <div class="cc-order-leg">
              <div class="cc-leg-info">
                <div style="font-weight:600">${esc(api.storeInfo(leg.domain).name)}</div>
                <div class="cc-line-meta">${esc(tracking)}</div>
              </div>
              <div class="cc-status">${status}</div>
            </div>`;
          })
          .join('');
        return `
        <div class="cc-card cc-order">
          <div class="cc-order-head">
            <div style="font-weight:700;font-size:15px">${esc(order.id)}</div>
            <div class="cc-muted cc-grow" style="font-size:13px">${fmtDate(order.date)} · ${order.legs.length} stores</div>
            <div style="font-weight:700">${fmt(order.totalUsd)}</div>
          </div>
          ${legs}
        </div>`;
      })
      .join('');
    return `<div class="cc-stack" style="max-width:820px">${orders}</div>`;
  }

  function appView() {
    const totals = checkoutTotals();
    const itemCount = Object.values(state.carts).flat().length;
    const titles = {
      carts: ['Your carts', `${itemCount} items saved across ${Object.keys(state.carts).length} lists`],
      cart: [state.activeCart || '', `${totals.groups.length} stores · ${totals.chosen.length} items selected`],
      checkout: ['Checkout', `One payment, ${totals.groups.length} store orders`],
      placing: ['Checkout', 'Placing orders'],
      confirm: ['Order placed', 'CrossCart paid each store on your behalf'],
      orders: ['Orders', 'Every store order CrossCart has placed for you'],
    };
    const [title, sub] = titles[state.screen];

    const views = {
      carts: cartsView,
      cart: () => cartView(totals),
      checkout: () => checkoutView(totals),
      placing: placingView,
      confirm: confirmView,
      orders: ordersView,
    };

    const nav = [
      ['carts', 'Carts', 'goCarts'],
      ['orders', 'Orders', 'goOrders'],
      ['landing', 'About', 'goLanding'],
    ];
    const session = api.getSession();

    return `
      <div class="cc-shell">
        <aside class="cc-side">
          <button class="cc-side-brand" data-action="goLanding">
            <img src="../icons/icon48.png" alt="" style="width:24px;height:24px;border-radius:7px" />
            <span style="font-weight:700;font-size:15px;letter-spacing:-0.01em">CrossCart</span>
          </button>
          <nav class="cc-sidenav">
            ${nav
              .map(
                ([key, label, action]) =>
                  `<button class="cc-navlink" data-action="${action}" ${state.screen === key ? 'aria-current="page"' : ''}>${label}</button>`
              )
              .join('')}
          </nav>
          <div class="cc-sidefoot">
            <div class="cc-saved-card">
              <div class="cc-eyebrow">Saved card</div>
              <div style="font-weight:600;margin-top:6px">${esc((session && session.card) || 'Visa •••• 4412')}</div>
            </div>
            <button class="cc-btn cc-btn-glass cc-btn-flat" data-action="toggleTheme">${themeLabel()}</button>
          </div>
        </aside>

        <main class="cc-main">
          <div class="cc-pagehead">
            <div class="cc-grow">
              <div class="cc-pagetitle">${esc(title)}</div>
              <div class="cc-muted" style="margin-top:2px">${esc(sub)}</div>
            </div>
            <select class="cc-select" data-change="currency" aria-label="Currency">
              ${SUPPORTED_CURRENCIES.map((c) => `<option value="${c}" ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          ${views[state.screen]()}
        </main>
      </div>`;
  }

  function render() {
    const focused = document.activeElement;
    const focusKey = focused && focused.dataset ? focused.dataset.field : null;

    if (state.screen === 'landing') root.innerHTML = landingView();
    else if (state.screen === 'signin') root.innerHTML = signInView();
    else root.innerHTML = appView();

    if (focusKey) {
      const again = root.querySelector(`[data-field="${focusKey}"]`);
      if (again) again.focus();
    }
  }

  // ---------- boot ----------

  // The popup can flip the theme too; keep the toggle label honest.
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  storage.subscribeToChanges((changed) => {
    if (state.mode !== 'real') return;
    if (changed[STORAGE_KEYS.CART_LISTS]) {
      state.carts = changed[STORAGE_KEYS.CART_LISTS].newValue || {};
      if (!state.carts[state.activeCart] && APP_SCREENS.includes(state.screen)) state.activeCart = Object.keys(state.carts)[0] || null;
      render();
    }
  });

  window.addEventListener('hashchange', route);
  theme.init();
  route();
})();
