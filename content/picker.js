window.Crosscart = window.Crosscart || {};

(function () {
  const PICKER_ID = 'crosscart-picker';
  let picker = null;
  let outsideClickHandler = null;
  let escHandler = null;

  function closePicker() {
    if (picker) {
      picker.remove();
      picker = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
  }

  function positionAboveAnchor(el, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.right = `${window.innerWidth - rect.right}px`;
    el.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  }

  async function handlePick(listName, product, anchorEl, onSaved) {
    const { lists: listsApi } = window.Crosscart;
    try {
      const { lists } = await listsApi.loadLists();
      const updated = listsApi.saveToList(lists, listName, product);
      await listsApi.persistLists(updated, listName);
    } catch (e) {
      // The extension was reloaded while the picker was open: the button explains it next click.
      closePicker();
      if (anchorEl) anchorEl.textContent = 'CrossCart was updated: click to reload page';
      if (anchorEl) anchorEl.dataset.stale = 'true';
      return;
    }
    closePicker();
    if (onSaved) onSaved(listName);
  }

  async function showPicker(anchorEl, product, onSaved) {
    closePicker();

    const { lists: listsApi } = window.Crosscart;
    const { lists } = await listsApi.loadLists();
    const listNames = Object.keys(lists);

    picker = document.createElement('div');
    picker.id = PICKER_ID;

    const title = document.createElement('div');
    title.className = 'crosscart-picker-title';
    title.textContent = 'Save to CrossCart';
    picker.appendChild(title);

    // The big button makes a new list: it turns into a name box, and Enter saves the product there.
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'crosscart-picker-default';
    newBtn.textContent = '+ New list';
    newBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 40;
      input.placeholder = 'Name your list, then press Enter';
      input.className = 'crosscart-picker-default crosscart-picker-name';
      input.setAttribute('aria-label', 'New list name');
      // Keep typing away from the store's own keyboard shortcuts.
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closePicker();
        if (e.key !== 'Enter') return;
        const name = input.value.trim();
        if (name) handlePick(name, product, anchorEl, onSaved); // an existing name just adds to that list
      });
      newBtn.replaceWith(input);
      input.focus();
    });
    picker.appendChild(newBtn);

    if (listNames.length) {
      const divider = document.createElement('div');
      divider.className = 'crosscart-picker-divider';
      divider.textContent = 'or add to a list';
      picker.appendChild(divider);

      const listWrap = document.createElement('div');
      listWrap.className = 'crosscart-picker-list';
      listNames.forEach((name) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'crosscart-picker-chip';
        chip.textContent = name;
        chip.addEventListener('click', () => handlePick(name, product, anchorEl, onSaved));
        listWrap.appendChild(chip);
      });
      picker.appendChild(listWrap);
    }

    await applyTheme(picker);
    document.documentElement.appendChild(picker);
    positionAboveAnchor(picker, anchorEl);

    outsideClickHandler = (e) => {
      if (picker && !picker.contains(e.target) && e.target !== anchorEl) {
        closePicker();
      }
    };
    escHandler = (e) => {
      if (e.key === 'Escape') closePicker();
    };
    document.addEventListener('mousedown', outsideClickHandler, true);
    document.addEventListener('keydown', escHandler, true);
  }

  // The button and picker sit on the store's page, so the theme goes on them as a class,
  // never on the page itself. Your CrossCart setting wins; otherwise follow the computer.
  async function applyTheme(el) {
    if (!el) return;
    const { storage, STORAGE_KEYS } = window.Crosscart;
    let theme = null;
    try {
      theme = (await storage.getStorage([STORAGE_KEYS.THEME]))[STORAGE_KEYS.THEME];
    } catch (e) {}
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    el.classList.toggle('crosscart-dark', dark);
  }

  window.Crosscart.picker = { showPicker, closePicker, applyTheme };
})();
