window.Crosscart = window.Crosscart || {};

(function () {
  const FALLBACK_KEY = 'crosscart-theme';

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  function current() {
    return document.documentElement.dataset.theme || 'light';
  }

  // Web pages without the extension installed have no chrome.storage bridge;
  // theme still has to work there, so it alone falls back to localStorage.
  async function read() {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    try {
      const result = await storage.getStorage([STORAGE_KEYS.THEME]);
      return result[STORAGE_KEYS.THEME] || null;
    } catch (e) {
      try {
        return localStorage.getItem(FALLBACK_KEY);
      } catch (_) {
        return null;
      }
    }
  }

  async function set(theme) {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    apply(theme);
    try {
      localStorage.setItem(FALLBACK_KEY, theme);
    } catch (_) {}
    try {
      await storage.setStorage({ [STORAGE_KEYS.THEME]: theme });
    } catch (e) {}
  }

  async function init() {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    // Mirror copy applies instantly; the bridge answer can take up to its timeout.
    try {
      apply(localStorage.getItem(FALLBACK_KEY) || systemTheme());
    } catch (_) {
      apply(systemTheme());
    }
    const stored = await read();
    if (stored) apply(stored);
    try {
      storage.subscribeToChanges((changes) => {
        if (changes[STORAGE_KEYS.THEME]) apply(changes[STORAGE_KEYS.THEME].newValue);
      });
    } catch (e) {}
  }

  window.Crosscart.theme = { init, set, current, apply };
})();
