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

  function flashSaved(btn, listName) {
    const original = btn.textContent;
    btn.textContent = `Saved to ${listName}!`;
    btn.classList.add('crosscart-saved');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('crosscart-saved');
    }, 1500);
  }

  function onAddClick() {
    const product = window.Crosscart.scrape.scrapeProduct();
    window.Crosscart.picker.showPicker(button, product, (listName) => {
      if (button) flashSaved(button, listName);
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
    window.Crosscart.watchSpaNavigation(syncButtonForPage);
  }

  init();
})();
