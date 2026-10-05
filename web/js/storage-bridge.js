window.Crosscart = window.Crosscart || {};

// Drop-in replacement for shared/storage.js on web pages: same API, backed by
// the extension's content/web-bridge.js over window.postMessage.
(function () {
  const TO_EXT = 'crosscart-web';
  const FROM_EXT = 'crosscart-ext';
  const TIMEOUT_MS = 1500;
  // A reload leaves the service worker asleep; the first wake-up can outrun the plain TIMEOUT_MS.
  const STATUS_TIMEOUT_MS = 5000;

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== FROM_EXT) return;

    if (msg.type === 'ready') {
      markReady();
    } else if (msg.type === 'result' && pending.has(msg.id)) {
      pending.get(msg.id)(msg.data);
      pending.delete(msg.id);
    } else if (msg.type === 'changed') {
      listeners.forEach((cb) => cb(msg.changes));
    }
  });

  function send(msg) {
    window.postMessage({ source: TO_EXT, ...msg }, location.origin);
  }

  // Ping covers the page loading after the content script; the bridge's own
  // 'ready' on injection covers the reverse.
  const detected = Promise.race([
    ready.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), TIMEOUT_MS)),
  ]);
  send({ type: 'ping' });

  async function request(msg, timeoutMs = TIMEOUT_MS) {
    if (!(await detected)) throw new Error('CrossCart extension not detected');
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      send({ ...msg, id });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error('CrossCart extension did not respond'));
      }, timeoutMs);
    });
  }

  // Linking and sign-out wait on the network and a full sync, so they get longer than storage reads.
  const NETWORK_TIMEOUT_MS = 20000;

  window.Crosscart.storage = {
    getStorage: (keys) => request({ type: 'get', keys: Array.isArray(keys) ? keys : [keys] }),
    setStorage: (data) => request({ type: 'set', data }).then(() => undefined),
    subscribeToChanges(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    isAvailable: () => detected,
    extensionStatus: () => request({ type: 'extensionStatus' }, STATUS_TIMEOUT_MS),
    linkExtension: (tokenHash) => request({ type: 'linkExtension', tokenHash }, NETWORK_TIMEOUT_MS),
    signOutExtension: () => request({ type: 'signOut' }, NETWORK_TIMEOUT_MS),
  };
})();
