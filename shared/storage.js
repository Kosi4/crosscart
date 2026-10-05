window.Crosscart = window.Crosscart || {};

(function () {
  // Reloading the extension orphans content scripts already in open tabs: every chrome.* call
  // then throws "Extension context invalidated". Callers get a rejection they can handle instead.
  function alive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function call(fn) {
    return new Promise((resolve, reject) => {
      if (!alive()) return reject(new Error('Extension context invalidated'));
      try {
        fn(resolve);
      } catch (e) {
        reject(e);
      }
    });
  }

  const getStorage = (keys) => call((done) => chrome.storage.local.get(keys, done));
  const setStorage = (data) => call((done) => chrome.storage.local.set(data, done));
  const removeStorage = (keys) => call((done) => chrome.storage.local.remove(keys, done));

  function subscribeToChanges(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      callback(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  window.Crosscart.storage = { getStorage, setStorage, removeStorage, subscribeToChanges, alive };
})();
