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
    const { lists } = await listsApi.loadLists();
    const updated = listsApi.saveToList(lists, listName, product);
    await listsApi.persistLists(updated, listName);
    closePicker();
    if (onSaved) onSaved(listName);
  }

  async function showPicker(anchorEl, product, onSaved) {
    closePicker();

    const { lists: listsApi } = window.Crosscart;
    const { lists } = await listsApi.loadLists();
    const listNames = Object.keys(lists);
    const defaultName = listsApi.DEFAULT_LIST_NAME;
    const otherNames = listNames.filter((n) => n !== defaultName);

    picker = document.createElement('div');
    picker.id = PICKER_ID;

    const title = document.createElement('div');
    title.className = 'crosscart-picker-title';
    title.textContent = 'Save to CrossCart';
    picker.appendChild(title);

    const defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'crosscart-picker-default';
    defaultBtn.textContent = `Add to ${defaultName}`;
    defaultBtn.addEventListener('click', () => handlePick(defaultName, product, anchorEl, onSaved));
    picker.appendChild(defaultBtn);

    if (otherNames.length) {
      const divider = document.createElement('div');
      divider.className = 'crosscart-picker-divider';
      divider.textContent = 'or choose a list';
      picker.appendChild(divider);

      const listWrap = document.createElement('div');
      listWrap.className = 'crosscart-picker-list';
      otherNames.forEach((name) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'crosscart-picker-chip';
        chip.textContent = name;
        chip.addEventListener('click', () => handlePick(name, product, anchorEl, onSaved));
        listWrap.appendChild(chip);
      });
      picker.appendChild(listWrap);
    }

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

  window.Crosscart.picker = { showPicker, closePicker };
})();
