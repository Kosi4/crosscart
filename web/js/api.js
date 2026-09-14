window.Crosscart = window.Crosscart || {};

// Mock backend. Every function here is a seam for the real server: same
// names and shapes, fixture data and localStorage underneath for now.
(function () {
  const SESSION_KEY = 'crosscart-session';
  const ORDERS_KEY = 'crosscart-orders';

  // Demo stores from the design; shipping is a flat per-store USD amount.
  const STORES = {
    'wearerighteous.com.co': { name: 'Righteous', shipUsd: 6.0 },
    'jdsports.co.za': { name: 'JD Sports', shipUsd: 9.5 },
    'thesupermade.com': { name: 'The Supermade', shipUsd: 12.0 },
  };
  // ponytail: flat mock shipping for unknown stores, real quotes come from the checkout agent
  const DEFAULT_SHIP_USD = 8.0;

  function demoItem(id, domain, title, price, quantity, extra) {
    return { id, title, domain, url: `https://${domain}`, image: '', price, currency: 'USD', quantity, ...extra };
  }

  const DEMO_CARTS = {
    General: [
      demoItem('a', 'wearerighteous.com.co', 'Heavyweight Logo Hoodie', 48.9, 1),
      demoItem('b', 'wearerighteous.com.co', 'Zip-Up Hoodie', 64.0, 1),
      demoItem('c', 'jdsports.co.za', 'Air Max 90 — Triple Black', 129.99, 1, { demoWas: 119.99 }),
      demoItem('d', 'jdsports.co.za', 'Puffer Jacket — Olive', 174.0, 1),
      demoItem('e', 'thesupermade.com', 'Cargo Utility Pants', 86.0, 2),
      demoItem('f', 'thesupermade.com', 'Ribbed Beanie', 22.5, 1, { demoOos: true }),
    ],
    'Winter Fits': [
      demoItem('g', 'jdsports.co.za', 'Sherpa Half-Zip', 92.0, 1),
      demoItem('h', 'thesupermade.com', 'Wool Overshirt', 118.0, 1),
    ],
    Gifts: [demoItem('i', 'wearerighteous.com.co', 'Logo Cap — Sand', 34.0, 1)],
  };

  const DEMO_PAST_ORDER = {
    id: 'CC-7602',
    date: '2026-09-02T12:00:00.000Z',
    cart: 'General',
    totalUsd: 214.5,
    legs: [
      { domain: 'jdsports.co.za', amountUsd: 0, state: 'delivered', note: 'Delivered 6 Sep' },
      { domain: 'wearerighteous.com.co', amountUsd: 0, state: 'delivered', note: 'Delivered 8 Sep' },
    ],
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function storeInfo(domain) {
    const known = STORES[domain];
    return { name: known ? known.name : domain, shipUsd: known ? known.shipUsd : DEFAULT_SHIP_USD };
  }

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // ponytail: deterministic fake stock/price check so every checkout state is reachable; replace with the agent's live check
  function checkItem(item) {
    if (item.demoOos) return { oos: true, wasPrice: null };
    if (item.demoWas) return { oos: false, wasPrice: item.demoWas };
    const n = hash(item.url || item.id || '') % 10;
    if (n === 0) return { oos: true, wasPrice: null };
    if (n === 1) return { oos: false, wasPrice: Math.round(item.price * 0.92 * 100) / 100 };
    return { oos: false, wasPrice: null };
  }

  function getSession() {
    return readJson(SESSION_KEY, null);
  }

  function signIn(provider) {
    const session = { provider, card: 'Visa •••• 4412' };
    writeJson(SESSION_KEY, session);
    return session;
  }

  function signOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function listOrders() {
    return readJson(ORDERS_KEY, []).concat(DEMO_PAST_ORDER);
  }

  function getOrder(id) {
    return listOrders().find((o) => o.id === id) || null;
  }

  function nextOrderId(orders) {
    const max = orders.reduce((m, o) => Math.max(m, Number(String(o.id).replace('CC-', '')) || 0), 7740);
    return 'CC-' + (max + 1);
  }

  // legs: [{ domain, amountUsd }]. The second store fails, as in the design, so
  // the retry path is always exercised.
  function placeOrder(cartName, legs, totalUsd) {
    const saved = readJson(ORDERS_KEY, []);
    const order = {
      id: nextOrderId(saved),
      date: new Date().toISOString(),
      cart: cartName,
      totalUsd,
      legs: legs.map((leg, i) => ({ ...leg, state: i === 1 ? 'failed' : 'confirmed' })),
    };
    writeJson(ORDERS_KEY, [order, ...saved]);
    return order;
  }

  function setLegState(orderId, domain, state) {
    const saved = readJson(ORDERS_KEY, []);
    const next = saved.map((o) =>
      o.id === orderId ? { ...o, legs: o.legs.map((l) => (l.domain === domain ? { ...l, state } : l)) } : o
    );
    writeJson(ORDERS_KEY, next);
    return next.find((o) => o.id === orderId) || null;
  }

  window.Crosscart.api = {
    DEMO_CARTS,
    storeInfo,
    checkItem,
    getSession,
    signIn,
    signOut,
    listOrders,
    getOrder,
    placeOrder,
    setLegState,
  };
})();
