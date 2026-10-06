(function () {
  const BUTTON_ID = 'crosscart-btn';
  let button = null;

  function ensureButton() {
    if (button) return button;
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '+ Add to CrossCart';
    button.addEventListener('click', onAddClick);
    window.Crosscart.picker.applyTheme(button);
    document.documentElement.appendChild(button);
    return button;
  }

  function removeButton() {
    if (button) {
      button.remove();
      button = null;
    }
  }

  function hideButton() {
    if (button) button.style.display = 'none';
  }

  function showButton() {
    if (button) button.style.display = '';
  }

  function flashSaved(btn, listName) {
    const original = btn.textContent;
    btn.textContent = `Saved to ${listName}!`;
    btn.classList.add('crosscart-saved');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('crosscart-saved');
    }, 1500);
  }

  // After the extension is updated or reloaded, buttons in tabs that were already open are
  // cut off from it (Chrome doesn't re-inject into open tabs). Say so instead of failing.
  function onAddClick() {
    if (!window.Crosscart.storage.alive()) {
      if (button.dataset.stale) return location.reload();
      button.dataset.stale = 'true';
      button.textContent = 'CrossCart was updated: click to reload page';
      return;
    }
    const product = window.Crosscart.scrape.scrapeProduct();
    window.Crosscart.picker
      .showPicker(button, product, (listName) => {
        if (button) flashSaved(button, listName);
      })
      .catch(() => {
        window.Crosscart.picker.closePicker();
        button.dataset.stale = 'true';
        button.textContent = 'CrossCart was updated: click to reload page';
      });
  }

  function syncButtonForPage() {
    const isProduct = window.Crosscart.detect.isProductPage();
    if (isProduct) {
      ensureButton();
      showButton();
    } else if (button) {
      hideButton();
    }
  }

  function init() {
    syncButtonForPage();
    // Switching light/dark in the popup or web app updates the button right away.
    try {
      window.Crosscart.storage.subscribeToChanges((changes) => {
        if (!changes[window.Crosscart.STORAGE_KEYS.THEME]) return;
        window.Crosscart.picker.applyTheme(button);
        window.Crosscart.picker.applyTheme(document.getElementById('crosscart-picker'));
      });
    } catch (e) {}
    window.Crosscart.watchSpaNavigation(syncButtonForPage);
  }

  init();
})();
