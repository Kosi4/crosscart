window.Crosscart = window.Crosscart || {};

// Mock backend. Every function here is a seam for the real server: same
// names and shapes, fixture data and localStorage underneath for now.
(function () {
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

  // www.thesupermade.com and thesupermade.com are the same store.
  function storeKey(domain) {
    return String(domain || '').toLowerCase().replace(/^www\./, '');
  }

  function storeInfo(domain) {
    const key = storeKey(domain);
    const known = STORES[key];
    return { key, name: known ? known.name : key, shipUsd: known ? known.shipUsd : DEFAULT_SHIP_USD };
  }

  // No live stock/price check exists yet, so only the demo cart's scripted flags show.
  // Real items must never get made-up "out of stock" or "price rose" labels.
  function checkItem(item) {
    return { oos: Boolean(item.demoOos), wasPrice: item.demoWas || null };
  }

  // ---------- auth (real: Supabase) ----------

  // Publishable key is meant to ship in client code; row-level security is what protects data.
  const SUPABASE_URL = 'https://yrfengptboswesicdmhe.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PYdC8UYjLq5OAdcwnafyTg_sNiszXl1';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true },
  });

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  // Plan comes from the profile; only CrossCart's billing can set it (see the plus_plan migration).
  // Anything unreadable, including a database without that migration yet, counts as free.
  async function getPlan() {
    const session = await getSession();
    if (!session) return 'free';
    const { data, error } = await supabase.from('profiles').select('plan').eq('id', session.user.id).maybeSingle();
    return !error && data && data.plan === 'plus' ? 'plus' : 'free';
  }

  // Waitlist for paid checkout: one row per user (the table enforces it), insert-only.
  async function isOnWaitlist() {
    const session = await getSession();
    if (!session) return false;
    const { data, error } = await supabase.from('waitlist').select('id').eq('user_id', session.user.id).maybeSingle();
    return !error && Boolean(data);
  }

  async function joinWaitlist({ itemCount, valueMinor, currency, domains }) {
    const { error } = await supabase.from('waitlist').insert({
      cart_item_count: itemCount,
      cart_value_minor: valueMinor,
      cart_currency: currency,
      store_domains: domains,
    });
    // 23505 = already on the list (unique user_id), which is what the shopper wanted anyway.
    if (error && error.code !== '23505') throw error;
  }

  // OAuth appends ?code= to the redirect, which would land inside our #/ route, so redirect to the bare page.
  async function signInWithGoogle() {
    // signInWithOAuth navigates away immediately; check the provider is enabled first so a
    // misconfigured project shows a message instead of a raw JSON error page.
    const settings = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    }).then((res) => (res.ok ? res.json() : null));
    if (!settings || !settings.external || !settings.external.google) {
      throw new Error('provider is not enabled');
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  // Sends whatever the Supabase email templates contain: a link today, a 6-digit code once
  // custom SMTP lets the templates include {{ .Token }}. The redirect is used by the link.
  async function sendEmailSignIn(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  async function verifyEmailCode(email, token) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    return data.session;
  }

  async function createExtensionLink(accessToken) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/extension-link`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token_hash) throw new Error(body.error || `Extension link failed (${res.status})`);
    return body;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function onAuthChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
    return () => data.subscription.unsubscribe();
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
  // fee: the pricing quote the shopper saw, kept so a receipt never changes later.
  function placeOrder(cartName, legs, totalUsd, fee) {
    const saved = readJson(ORDERS_KEY, []);
    const order = {
      id: nextOrderId(saved),
      date: new Date().toISOString(),
      cart: cartName,
      totalUsd,
      fee: fee || null,
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
    storeKey,
    storeInfo,
    checkItem,
    supabase,
    getSession,
    getPlan,
    isOnWaitlist,
    joinWaitlist,
    signInWithGoogle,
    sendEmailSignIn,
    verifyEmailCode,
    signOut,
    onAuthChange,
    createExtensionLink,
    listOrders,
    getOrder,
    placeOrder,
    setLegState,
  };
})();
