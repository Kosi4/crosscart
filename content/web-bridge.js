(function () {
  const { STORAGE_KEYS, storage } = window.Crosscart;
  const FROM_PAGE = 'crosscart-web';
  const TO_PAGE = 'crosscart-ext';

  // Any script on the web app origin can post here, so only these keys cross the bridge.
  const ALLOWED = new Set([
    STORAGE_KEYS.CART_LISTS,
    STORAGE_KEYS.ACTIVE_LIST,
    STORAGE_KEYS.PREFERRED_CURRENCY,
    STORAGE_KEYS.EXCHANGE_RATES,
    STORAGE_KEYS.THEME,
  ]);

  function allowedOnly(obj) {
    if (!obj || typeof obj !== 'object') return {};
    return Object.fromEntries(Object.entries(obj).filter(([key]) => ALLOWED.has(key)));
  }

  function post(msg) {
    window.postMessage({ source: TO_PAGE, ...msg }, location.origin);
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== FROM_PAGE) return;

    if (msg.type === 'ping') {
      post({ type: 'ready' });
    } else if (msg.type === 'get') {
      const keys = (Array.isArray(msg.keys) ? msg.keys : []).filter((key) => ALLOWED.has(key));
      const data = keys.length ? await storage.getStorage(keys) : {};
      post({ type: 'result', id: msg.id, data });
    } else if (msg.type === 'set') {
      const data = allowedOnly(msg.data);
      if (Object.keys(data).length) await storage.setStorage(data);
      post({ type: 'result', id: msg.id, data: {} });
    } else if (msg.type === 'setSession') {
      // Write-only: the session is never in ALLOWED, so pages can hand it over but never read it back.
      const s = msg.session;
      const valid =
        s &&
        typeof s.access_token === 'string' &&
        typeof s.refresh_token === 'string' &&
        Number.isFinite(s.expires_at) &&
        s.user &&
        typeof s.user.id === 'string';
      if (valid) {
        await storage.setStorage({
          [STORAGE_KEYS.AUTH_SESSION]: {
            access_token: s.access_token,
            refresh_token: s.refresh_token,
            expires_at: s.expires_at,
            user: { id: s.user.id, email: typeof s.user.email === 'string' ? s.user.email : null },
          },
        });
      }
      post({ type: 'result', id: msg.id, data: {} });
    } else if (msg.type === 'clearSession') {
      await storage.removeStorage([STORAGE_KEYS.AUTH_SESSION]);
      post({ type: 'result', id: msg.id, data: {} });
    }
  });

  storage.subscribeToChanges((changes) => {
    const filtered = allowedOnly(changes);
    if (Object.keys(filtered).length) post({ type: 'changed', changes: filtered });
  });

  post({ type: 'ready' });
})();
