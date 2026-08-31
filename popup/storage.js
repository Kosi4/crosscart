window.Crosscart = window.Crosscart || {};

(function () {
  function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function setStorage(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }

  function subscribeToChanges(callback) {
    const listener = (changes, area) => {
      if (area !== 'local') return;
      callback(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  window.Crosscart.storage = { getStorage, setStorage, subscribeToChanges };
})();
