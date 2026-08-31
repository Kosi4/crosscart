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

  function flashSaved(btn) {
    const original = btn.textContent;
    btn.textContent = 'Saved!';
    btn.classList.add('crosscart-saved');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('crosscart-saved');
    }, 1500);
  }

  async function onAddClick() {
    const product = window.Crosscart.scrape.scrapeProduct();
    const keys = window.Crosscart.STORAGE_KEYS;
    await chrome.storage.local.set({
      [keys.PENDING_PRODUCT]: product,
      [keys.PENDING_PRODUCT_TIMESTAMP]: Date.now(),
    });
    if (button) flashSaved(button);
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
    window.Crosscart.watchSpaNavigation(syncButtonForPage);
  }

  init();
})();
