window.Crosscart = window.Crosscart || {};

(function () {
  function watchSpaNavigation(onNavigate) {
    let lastUrl = window.location.href;
    let debounceTimer = null;

    const notify = () => {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      onNavigate();
    };

    const debouncedNotify = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(notify, 300);
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      notify();
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      notify();
      return result;
    };

    window.addEventListener('popstate', notify);
    window.addEventListener('hashchange', notify);

    const observer = new MutationObserver(debouncedNotify);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', notify);
      window.removeEventListener('hashchange', notify);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }

  window.Crosscart.watchSpaNavigation = watchSpaNavigation;
})();
