(function () {
  const C = window.Crosscart;
  const { STORAGE_KEYS, SUPPORTED_CURRENCIES, storage, lists: listsApi, currencyRates, theme, api, pricing } = C;
  const esc = C.dom.escapeHtml;
  const { safeUrl } = C.dom;

  const MODE_KEY = 'crosscart-mode';
  const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R', JPY: '¥', CAD: 'CA$', AUD: 'A$', INR: '₹' };
  const APP_SCREENS = ['carts', 'cart', 'checkout', 'placing', 'confirm', 'orders'];
  const RATES_MAX_AGE_MS = 1000 * 60 * 60;
  // 'link' until a custom SMTP sender lets Supabase's templates send {{ .Token }}; then 'code'.
  const EMAIL_SIGN_IN = 'link';

  const state = {
    screen: 'landing',
    mode: null,
    plan: 'free',
    feeOpen: false,
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
    session: null,
    auth: { step: 'email', sending: false, error: '' },
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
  function plural(count, word) {
    return `${count} ${count === 1 ? word : word + 's'}`;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  // ---------- cart math ----------

  // Checkout can cover one cart or every cart at once; the cart screen always shows one.
  function cartItems() {
    if (state.screen === 'checkout' && state.checkoutAll) return Object.values(state.carts).flat();
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
      const domain = api.storeKey(item.domain);
      let group = groups.find((g) => g.domain === domain);
      if (!group) {
        group = { domain, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });
    return groups;
  }

  // A store charges in the currency its prices were saved in.
  function storeCurrency(group) {
    const foreign = group.items.find((item) => pricing.isForeign(item.currency));
    return foreign ? foreign.currency.toUpperCase() : pricing.PRICING.CARD_CURRENCY;
  }

  // Selected items count toward totals even when flagged out of stock; the flag is a warning, not a removal.
  function checkoutTotals() {
    const chosen = cartItems().filter(isSelected);
    const groups = groupByStore(chosen);
    const quote = pricing.quote(
      groups.map((g) => ({ goodsUsd: goodsUsd(g.items), shipUsd: api.storeInfo(g.domain).shipUsd, currency: storeCurrency(g) })),
      state.plan
    );
    const { goods, shipping, fee } = quote;
    return { chosen, groups, goods, shipping, fee, quote, total: goods + shipping + fee };
  }

  // Scraped image URLs are sometimes http://, which an https page (and our CSP) won't load.
  function imageSrc(raw) {
    const url = safeUrl(raw);
    return url ? url.replace(/^http:\/\//i, 'https://') : '';
  }

  function reorderStore(domain, reordered) {
    const items = cartItems();
    const next = [...items];
    let i = 0;
    items.forEach((item, index) => {
      if (api.storeKey(item.domain) === domain) next[index] = reordered[i++];
    });
    commitCarts({ ...state.carts, [state.activeCart]: next });
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

    state.plan = await api.getPlan();
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

    // Already signed in: the sign-in page has nothing to offer, so go straight to the carts.
    if (screen === 'signin' && state.session) {
      setMode('real');
      return go('carts');
    }

    if (APP_SCREENS.includes(screen)) {
      // A signed-in user reloading should land on their own carts, not a demo left over from earlier.
      if (!state.mode) state.mode = state.session ? 'real' : sessionGet(MODE_KEY);
      if (!state.mode || (state.mode === 'real' && !state.session)) return go('signin');
      if ((screen === 'placing' || screen === 'confirm') && !state.order) return go('orders');
    }

    state.screen = screen;
    render();

    if (APP_SCREENS.includes(screen)) {
      await loadData();
      const hasItems = state.checkoutAll ? Object.values(state.carts).flat().length : state.carts[state.activeCart];
      if (screen === 'cart' && !state.carts[state.activeCart]) return go('carts');
      if (screen === 'checkout' && !hasItems) return go('carts');
      render();
    }
  }

  // ---------- auth ----------

  function authMessage(error) {
    const text = String((error && error.message) || '').toLowerCase();
    if ((error && error.status === 429) || text.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
    if (text.includes('expired') || text.includes('invalid') || text.includes('token')) return 'That code is wrong or has expired. Request a new one.';
    if (text.includes('provider is not enabled') || text.includes('unsupported provider')) return "Google sign-in isn't set up yet. Use email for now.";
    return (error && error.message) || 'Something went wrong. Try again.';
  }

  // The extension needs its own session (refresh tokens are single-use, so it can't share ours).
  // A server function mints a one-time token for this account; the extension swaps it for a session.
  let linking = null;

  function linkExtension(session) {
    if (!session || linking) return linking;
    linking = (async () => {
      if (!(await storage.isAvailable())) return;
      const status = await storage.extensionStatus();
      if (status.userId === session.user.id) return;
      const { token_hash: tokenHash } = await api.createExtensionLink(session.access_token);
      const result = await storage.linkExtension(tokenHash);
      if (!result.ok) throw new Error(result.error || 'Extension link failed');
    })()
      .catch((error) => console.warn('[CrossCart] could not connect the extension:', error.message))
      .finally(() => {
        linking = null;
      });
    return linking;
  }

  function enterApp() {
    setMode('real');
    state.loadedMode = null;
    linkExtension(state.session);
    go('carts');
  }

  // The extension uploads anything unsynced before it clears its cached lists.
  async function leaveApp() {
    state.session = null;
    state.mode = null;
    state.loadedMode = null;
    state.carts = {};
    try {
      sessionStorage.removeItem(MODE_KEY);
    } catch (e) {}
    if (await storage.isAvailable()) {
      try {
        await storage.signOutExtension();
      } catch (e) {}
    }
    go('landing');
  }

  // ---------- actions ----------

  const actions = {
    goLanding: () => go('landing'),
    goSignIn: () => {
      if (!state.session) return go('signin');
      setMode('real');
      go('carts');
    },
    goCarts: () => go('carts'),
    goCart: () => go(state.checkoutAll ? 'carts' : 'cart'),
    goCheckout: () => {
      state.checkoutAll = false;
      go('checkout');
    },
    checkoutAll: () => {
      state.checkoutAll = true;
      go('checkout');
    },
    goOrders: () => go('orders'),

    signInGoogle: async () => {
      state.auth.error = '';
      try {
        await api.signInWithGoogle();
      } catch (e) {
        state.auth.error = authMessage(e);
        render();
      }
    },

    sendCode: async () => {
      const email = (state.form.authEmail || '').trim();
      if (!email) return;
      state.auth = { ...state.auth, sending: true, error: '' };
      render();
      try {
        await api.sendEmailSignIn(email);
        state.auth.step = EMAIL_SIGN_IN;
        state.form.authCode = '';
      } catch (e) {
        state.auth.error = authMessage(e);
      }
      state.auth.sending = false;
      render();
    },

    verifyCode: async () => {
      const code = (state.form.authCode || '').replace(/\D/g, '');
      if (code.length !== 6) {
        state.auth.error = 'Enter the 6-digit code from the email.';
        render();
        return;
      }
      state.auth = { ...state.auth, sending: true, error: '' };
      render();
      try {
        state.session = await api.verifyEmailCode((state.form.authEmail || '').trim(), code);
        state.auth = { step: 'email', sending: false, error: '' };
        state.form.authCode = '';
        enterApp();
      } catch (e) {
        state.auth = { ...state.auth, sending: false, error: authMessage(e) };
        render();
      }
    },

    changeEmail: () => {
      state.auth = { step: 'email', sending: false, error: '' };
      render();
    },

    signOut: () => api.signOut(),

    demo: () => {
      setMode('demo');
      go('carts');
    },

    toggleTheme: () => theme.set(theme.current() === 'light' ? 'dark' : 'light'),

    openCart: (name) => {
      state.activeCart = name;
      state.checkoutAll = false;
      go('cart');
    },

    toggleFee: () => {
      state.feeOpen = !state.feeOpen;
      render();
      // render() replaces the markup, so put keyboard focus back on the toggle.
      const toggle = root.querySelector('[data-action="toggleFee"]');
      if (toggle) toggle.focus();
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
      state.order = api.placeOrder(state.checkoutAll ? 'All carts' : state.activeCart, legs, totals.total, totals.quote);
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

  // ---------- drag to reorder ----------
  // Pointer-driven rather than HTML5 drag-and-drop: native DnD can't lift the panel or animate
  // neighbours, and it never starts from the product link, which must stay clickable.

  const DRAG_THRESHOLD_PX = 5;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let drag = null;
  let suppressClick = false;
  let focusRowId = null;
  let focusStore = null;

  // Store order is simply the order of their items in the list, so moving a store moves its items as a block.
  function moveStore(from, to) {
    const groups = groupByStore(cartItems());
    if (from === to || to < 0 || to >= groups.length) return;
    const [moved] = groups.splice(from, 1);
    groups.splice(to, 0, moved);
    commitCarts({ ...state.carts, [state.activeCart]: groups.flatMap((g) => g.items) });
  }

  function moveInStore(domain, from, to) {
    const group = groupByStore(cartItems()).find((g) => g.domain === domain);
    if (!group || from === to || to < 0 || to >= group.items.length) return;
    const reordered = [...group.items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    reorderStore(domain, reordered);
  }

  function startDrag() {
    const rows = [...drag.container.querySelectorAll(drag.itemSelector)];
    drag.rows = rows;
    drag.from = rows.indexOf(drag.row);
    drag.to = drag.from;
    drag.slots = rows.map((r) => {
      const box = r.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
    // Store cards sit in a flex column with a gap; product panels touch. Neighbours must clear both.
    drag.gap = rows.length > 1 ? Math.max(0, drag.slots[1].top - (drag.slots[0].top + drag.slots[0].height)) : 0;
    drag.active = true;
    drag.container.classList.add('cc-sorting');
    drag.row.classList.add('cc-lifted');
    document.body.classList.add('cc-dragging-active');
  }

  function updateDrag(dy) {
    const { slots, from, row, rows } = drag;
    const last = slots[slots.length - 1];
    const minDy = slots[0].top - slots[from].top;
    const maxDy = last.top + last.height - (slots[from].top + slots[from].height);
    const y = Math.max(minDy, Math.min(maxDy, dy));
    const center = slots[from].top + slots[from].height / 2 + y;
    const to = slots.filter((s, i) => i !== from && s.top + s.height / 2 < center).length;
    const lift = slots[from].height + drag.gap;

    row.style.transform = `translateY(${y}px) scale(1.02)`;
    rows.forEach((r, i) => {
      if (i === from) return;
      let shift = 0;
      if (from < to && i > from && i <= to) shift = -lift;
      if (to < from && i >= to && i < from) shift = lift;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    drag.to = to;
  }

  function endDrag() {
    const { row, rows, from, to, slots, container, onDrop } = drag;
    const offset =
      to > from ? slots[to].top + slots[to].height - (slots[from].top + slots[from].height) : slots[to].top - slots[from].top;

    // The pointerup that ends a drag is followed by a click on the link underneath; swallow it.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 300);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.body.classList.remove('cc-dragging-active');
      if (to === from) {
        rows.forEach((r) => (r.style.transform = ''));
        row.classList.remove('cc-lifted', 'cc-settling');
        container.classList.remove('cc-sorting');
        return;
      }
      onDrop(from, to);
    };

    row.classList.add('cc-settling');
    row.style.transform = `translateY(${offset}px) scale(1)`;
    if (reduceMotion.matches) return finish();
    row.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 260);
  }

  function cancelDrag() {
    if (drag && drag.active) {
      drag.rows.forEach((r) => (r.style.transform = ''));
      drag.row.classList.remove('cc-lifted', 'cc-settling');
      drag.container.classList.remove('cc-sorting');
      document.body.classList.remove('cc-dragging-active');
    }
    drag = null;
  }

  // ponytail: mouse/pen only; touch reordering needs a long-press handle so it doesn't fight page scrolling
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch' || drag) return;
    const base = { startY: event.clientY, pointerId: event.pointerId, active: false };
    const row = event.target.closest('[data-store] > .cc-row');
    if (row) {
      if (event.target.closest('input, button, select, textarea')) return;
      const domain = row.parentElement.dataset.store;
      drag = { ...base, row, container: row.parentElement, itemSelector: ':scope > .cc-row', onDrop: (f, t) => moveInStore(domain, f, t) };
      return;
    }
    // The store header is also the collapse toggle; a plain click still toggles, moving past the threshold drags.
    const head = event.target.closest('.cc-stack > .cc-group > .cc-group-head');
    if (head) {
      const group = head.parentElement;
      drag = { ...base, row: group, container: group.parentElement, itemSelector: ':scope > .cc-group', onDrop: moveStore };
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      startDrag();
    }
    event.preventDefault();
    updateDrag(dy);
  });

  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) endDrag();
    drag = null;
  });

  window.addEventListener('pointercancel', cancelDrag);

  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  root.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const step = event.key === 'ArrowUp' ? -1 : 1;
    const target = event.target;

    if (target.matches('[data-store] > .cc-row')) {
      event.preventDefault();
      const from = Number(target.dataset.index);
      focusRowId = target.dataset.id;
      moveInStore(target.parentElement.dataset.store, from, from + step);
    } else if (target.matches('.cc-stack > .cc-group > .cc-group-head')) {
      event.preventDefault();
      const groups = [...target.closest('.cc-stack').children];
      focusStore = target.dataset.arg;
      moveStore(groups.indexOf(target.parentElement), groups.indexOf(target.parentElement) + step);
    }
  });

  // Stores block hotlinking or rename files; a dead product image falls back to the empty tile.
  root.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains('cc-thumb')) {
        const tile = document.createElement('div');
        tile.className = 'cc-thumb';
        event.target.replaceWith(tile);
      }
    },
    true
  );

  root.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-submit]');
    if (!form) return;
    event.preventDefault();
    const action = actions[form.dataset.submit];
    if (action) action();
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
      ['03 — Pay once', 'We check out for you', 'You pay CrossCart once. We pay each store with a single-use card, then report back per store.'],
    ];
    return `
      <div class="cc-landing">
        <div class="cc-topbar cc-glass">
          <img src="../icons/icon48.png" alt="" style="width:26px;height:26px;border-radius:8px" />
          <div class="cc-brand">CrossCart</div>
          <button class="cc-btn cc-btn-glass cc-btn-inset" data-action="toggleTheme">${themeLabel()}</button>
          <button class="cc-btn cc-btn-primary" data-action="goSignIn">${state.session ? 'Open my cart' : 'Sign in'}</button>
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

  function signInBody() {
    const { step, sending, error } = state.auth;
    const email = state.form.authEmail || '';
    const errorLine = error ? `<div class="cc-auth-error" role="alert">${esc(error)}</div>` : '';

    if (step === 'link') {
      return `
          <div class="cc-signin-actions">
            <div class="cc-muted">We emailed a sign-in link to <strong>${esc(email)}</strong>. Open it in this browser to finish signing in.</div>
            <button type="button" class="cc-btn cc-btn-glass" data-action="sendCode" ${sending ? 'disabled' : ''}>${sending ? 'Sending…' : 'Send the link again'}</button>
            <button type="button" class="cc-btn cc-btn-plain" data-action="changeEmail">Use a different email</button>
          </div>
          ${errorLine}`;
    }

    if (step === 'code') {
      return `
          <form class="cc-signin-actions" data-submit="verifyCode">
            <div class="cc-muted">Enter the 6-digit code we sent to <strong>${esc(email)}</strong></div>
            <input class="cc-auth-input" data-field="authCode" value="${esc(state.form.authCode || '')}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" aria-label="Verification code" required />
            <button type="submit" class="cc-btn cc-btn-primary" ${sending ? 'disabled' : ''}>${sending ? 'Checking…' : 'Verify code'}</button>
            <button type="button" class="cc-btn cc-btn-plain" data-action="changeEmail">Use a different email</button>
          </form>
          ${errorLine}`;
    }

    return `
          <div class="cc-signin-actions">
            <button type="button" class="cc-btn cc-btn-surface" data-action="signInGoogle">Continue with Google</button>
          </div>
          <form class="cc-signin-actions cc-signin-email" data-submit="sendCode">
            <input class="cc-auth-input" type="email" data-field="authEmail" value="${esc(email)}" autocomplete="email" placeholder="you@example.com" aria-label="Email address" required />
            <button type="submit" class="cc-btn cc-btn-primary" ${sending ? 'disabled' : ''}>${sending ? 'Sending code…' : 'Continue with email'}</button>
          </form>
          ${errorLine}`;
  }

  function signInView() {
    return `
      <div class="cc-center">
        <div class="cc-signin cc-glass">
          <img src="../icons/icon128.png" alt="" style="width:44px;height:44px;border-radius:12px" />
          <div class="cc-signin-title">Sign in to CrossCart</div>
          <div class="cc-muted" style="margin-top:8px">Your saved lists follow you from the extension.</div>
          ${signInBody()}
          <div class="cc-faint" style="font-size:12px;margin-top:22px;text-wrap:pretty">By continuing you let CrossCart place orders on stores on your behalf.</div>
        </div>
      </div>`;
  }

  // The fee is one line; tapping it shows what it's made of.
  function summaryRows(totals) {
    const q = totals.quote;
    const { PRICING } = pricing;
    const row = (label, value) =>
      `<div class="cc-summary-row"><div class="cc-grow">${label}</div><div>${value}</div></div>`;

    const parts = [[`Service fee (${PRICING.SERVICE_RATE * 100}%)`, fmt(q.service)]];
    if (q.storeCount) {
      parts.push(
        q.plan === 'plus'
          ? [`Store fee · ${plural(q.storeCount, 'store')} · Plus`, 'Free']
          : [`Store fee · ${q.storeCount} × ${fmt(PRICING.PER_STORE_USD)}`, fmt(q.perStore)]
      );
    }
    if (q.conversion) {
      parts.push([`Currency conversion (${PRICING.FX_RATE * 100}%) · ${plural(q.foreignStores, 'store')}`, fmt(q.conversion)]);
    }

    const open = state.feeOpen;
    const fee = `
      <button class="cc-summary-row cc-fee-toggle" data-action="toggleFee" aria-expanded="${open}" aria-controls="cc-fee-parts">
        <div class="cc-grow">CrossCart fee <span class="cc-caret">${open ? '▾' : '▸'}</span></div><div>${fmt(q.fee)}</div>
      </button>
      ${open ? `<div class="cc-fee-parts" id="cc-fee-parts">${parts.map(([l, v]) => row(l, v)).join('')}</div>` : ''}`;

    const upsell =
      q.plan !== 'plus' && q.perStore
        ? `<div class="cc-faint" style="font-size:12px;margin-top:10px;text-wrap:pretty">CrossCart Plus skips store fees: ${fmt(q.perStore)} off this order, ${fmt(PRICING.PLUS_MONTHLY_USD)}/month.</div>`
        : '';
    return `<div class="cc-summary-rows">${row(`Items (${totals.chosen.length})`, fmt(totals.goods))}${row(
      `Shipping · ${plural(totals.groups.length, 'store')}`,
      fmt(totals.shipping)
    )}${fee}</div>${upsell}`;
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

    const allItems = Object.values(state.carts).flat();
    const totalPill = allItems.length
      ? `<div class="cc-pill cc-total-pill" role="status">All carts · ${fmt(goodsUsd(allItems))}</div>`
      : '';
    const checkoutAllButton =
      Object.values(state.carts).filter((items) => items.length).length > 1
        ? `<button class="cc-btn cc-btn-primary cc-checkout-all" data-action="checkoutAll">Check out all carts · ${plural(allItems.length, 'item')}</button>`
        : '';

    return `${notice}<div class="cc-grid-2">${cards}</div>${totalPill}${checkoutAllButton}`;
  }

  function cartView(totals) {
    const groups = groupByStore(cartItems())
      .map((group) => {
        const store = api.storeInfo(group.domain);
        const open = !state.collapsed[group.domain];
        const rows = group.items
          .map((item, index) => {
            const check = api.checkItem(item);
            const flag = check.oos
              ? 'Out of stock at this store'
              : check.wasPrice
                ? `Price rose from ${fmt(currencyRates.convertAmount(check.wasPrice, item.currency || 'USD', 'USD', state.rates))} since you saved it`
                : '';
            const img = imageSrc(item.image);
            const href = safeUrl(item.url);
            // Stores sometimes label a swatch "Photo Color"/"Default"/"One Size" when there
            // was never a real choice (variantOptions has only that one value) — that tells
            // a shopper nothing, so skip it rather than showing the store's placeholder text.
            const PLACEHOLDER_VARIANT_VALUE = /^(photo color|default|one (size|color)|n\/a|standard|regular)$/i;
            const variant = item.variantSelected || {};
            const options = item.variantOptions || {};
            const variantText = Object.entries(variant)
              .filter(([k, v]) => v && !((options[k] || []).length <= 1 && PLACEHOLDER_VARIANT_VALUE.test(v)))
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ');
            const unconfirmed = variantText && item.variantConfidence === 'low';
            const body = `
                ${img ? `<img class="cc-thumb" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" />` : '<div class="cc-thumb"></div>'}
                <div class="cc-grow">
                  <div class="cc-ellipsis cc-item-title">${esc(item.title)}</div>
                  ${variantText ? `<div class="cc-item-variant">${esc(variantText)}${unconfirmed ? ' · <span class="cc-item-variant-unsure">confirm on site</span>' : ''}</div>` : ''}
                  ${flag ? `<div class="cc-flag">${flag}</div>` : ''}
                </div>`;
            return `
            <div class="cc-row" data-index="${index}" data-id="${esc(item.id)}" tabindex="0" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-roledescription="Reorderable product">
              <input type="checkbox" ${isSelected(item) ? 'checked' : ''} data-change="select" data-arg="${esc(item.id)}" aria-label="Select ${esc(item.title)}" />
              ${
                href
                  ? `<a class="cc-item-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Open product page">${body}</a>`
                  : `<div class="cc-item-link">${body}</div>`
              }
              <input class="cc-qty" type="number" min="1" value="${item.quantity || 1}" data-change="quantity" data-arg="${esc(item.id)}" aria-label="Quantity" />
              <div class="cc-price">${fmt(lineUsd(item))}</div>
              <button class="cc-remove" data-action="removeItem" data-arg="${esc(item.id)}">Remove</button>
            </div>`;
          })
          .join('');
        return `
        <div class="cc-card cc-group">
          <button class="cc-group-head" data-action="toggleGroup" data-arg="${esc(group.domain)}" aria-expanded="${open}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="Click to collapse · drag to reorder stores">
            <div class="cc-grow">
              <div class="cc-group-store">${esc(store.name)}</div>
              <div class="cc-group-domain">${esc(group.domain)}</div>
            </div>
            <div style="font-weight:700">${fmt(goodsUsd(group.items.filter(isSelected)))}</div>
            <div class="cc-caret">${open ? '▾' : '▸'}</div>
          </button>
          ${open ? `<div data-store="${esc(group.domain)}">${rows}</div>` : ''}
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
          <button class="cc-btn cc-btn-block cc-btn-primary" data-action="goCheckout" ${totals.chosen.length ? '' : 'disabled'}>Check out ${totals.chosen.length} items</button>
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
        const currency = storeCurrency(g);
        const priced = pricing.isForeign(currency) ? ` · charges in ${esc(currency)}` : '';
        return `
        <div class="cc-line">
          <div class="cc-grow">
            <div style="font-weight:600">${esc(store.name)}</div>
            <div class="cc-line-meta">${plural(g.items.length, 'item')} · ${fmt(store.shipUsd)} shipping${priced}</div>
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
      if (api.checkItem(item).oos) warnings.push(`${esc(item.title)} is marked out of stock at this store and may not be ordered.`);
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
          <button class="cc-btn cc-btn-block cc-btn-plain" data-action="goCart">${state.checkoutAll ? 'Back to carts' : 'Back to cart'}</button>
        </div>
      </div>`;
  }

  function placingView() {
    const order = state.order;
    return `
      <div class="cc-placing cc-glass">
        <div class="cc-spinner"></div>
        <div style="font-weight:700;font-size:20px;letter-spacing:-0.02em;margin-top:22px">Placing your orders</div>
        <div class="cc-muted" style="margin-top:8px;text-wrap:pretty">CrossCart is checking out on ${plural(order.legs.length, 'store')} with your card. This takes about a minute — you can leave this page.</div>
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
            <div class="cc-muted cc-grow" style="font-size:13px">${fmtDate(order.date)} · ${plural(order.legs.length, 'store')}</div>
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
      cart: [state.activeCart || '', `${plural(totals.groups.length, 'store')} · ${plural(totals.chosen.length, 'item')} selected`],
      checkout: [
        state.checkoutAll ? 'Check out all carts' : 'Checkout',
        `One payment, ${plural(totals.groups.length, 'store order')}`,
      ],
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
    // The saved card belongs to the demo's checkout preview; real accounts have no payments yet.
    const sideFoot =
      state.mode === 'demo'
        ? `<div class="cc-saved-card">
              <div class="cc-eyebrow">Saved card</div>
              <div style="font-weight:600;margin-top:6px">Visa •••• 4412</div>
            </div>
            ${state.session ? '<button class="cc-btn cc-btn-plain" data-action="goSignIn">Back to my carts</button>' : ''}`
        : `<div class="cc-saved-card">
              <div class="cc-eyebrow">Signed in</div>
              <div class="cc-ellipsis" style="margin-top:6px">${esc((state.session && state.session.user.email) || '')}</div>
            </div>
            <button class="cc-btn cc-btn-plain" data-action="signOut">Sign out</button>`;

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
            ${sideFoot}
            <button class="cc-btn cc-btn-glass cc-btn-flat" data-action="toggleTheme">${themeLabel()}</button>
          </div>
        </aside>

        <main class="cc-main">
          <div class="cc-pagehead">
            <div class="cc-grow">
              <div class="cc-pagetitle">${esc(title)}</div>
              <div class="cc-muted" style="margin-top:2px">${esc(sub)}</div>
            </div>
            <select class="cc-pill cc-select" data-change="currency" aria-label="Currency">
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

    if (focusRowId) {
      const row = root.querySelector(`.cc-row[data-id="${CSS.escape(focusRowId)}"]`);
      if (row) row.focus();
      focusRowId = null;
    }
    if (focusStore) {
      const head = root.querySelector(`.cc-group-head[data-arg="${CSS.escape(focusStore)}"]`);
      if (head) head.focus();
      focusStore = null;
    }

    if (focusKey) {
      const again = root.querySelector(`[data-field="${focusKey}"]`);
      if (again) again.focus();
    }
  }

  // ---------- boot ----------

  // The popup can flip the theme too; keep the toggle label honest.
  let renderedTheme = theme.current();
  new MutationObserver(() => {
    if (theme.current() === renderedTheme) return;
    renderedTheme = theme.current();
    render();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  storage.subscribeToChanges((changed) => {
    if (state.mode !== 'real') return;
    if (changed[STORAGE_KEYS.CART_LISTS]) {
      state.carts = changed[STORAGE_KEYS.CART_LISTS].newValue || {};
      if (!state.carts[state.activeCart] && APP_SCREENS.includes(state.screen)) state.activeCart = Object.keys(state.carts)[0] || null;
      render();
    }
  });

  api.onAuthChange((event, session) => {
    state.session = session;
    if (session && event === 'SIGNED_IN') linkExtension(session);
    if (event === 'SIGNED_OUT') leaveApp();
  });

  window.addEventListener('hashchange', route);
  theme.init();

  // Read the redirect params now: supabase-js strips ?code= from the URL once its exchange finishes.
  const params = new URLSearchParams(location.search);

  (async () => {
    // getSession waits for supabase-js to finish exchanging a Google/email-link ?code= redirect.
    state.session = await api.getSession();
    if (params.has('code') || params.has('error')) {
      history.replaceState(null, '', location.pathname + location.hash);
      if (state.session) return enterApp();
      state.auth.error = params.get('error_description') || 'Google sign-in was cancelled.';
      return go('signin');
    }
    route();
    linkExtension(state.session);
  })();
})();
