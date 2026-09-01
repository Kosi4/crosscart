window.Crosscart = window.Crosscart || {};

(function () {
  const DEFAULT_LIST_NAME = 'General';

  async function loadLists() {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    const result = await storage.getStorage([STORAGE_KEYS.CART_LISTS, STORAGE_KEYS.ACTIVE_LIST]);
    let lists = result[STORAGE_KEYS.CART_LISTS];
    let activeList = result[STORAGE_KEYS.ACTIVE_LIST];

    if (!lists) {
      lists = { [DEFAULT_LIST_NAME]: [] };
      activeList = DEFAULT_LIST_NAME;
      await storage.setStorage({
        [STORAGE_KEYS.CART_LISTS]: lists,
        [STORAGE_KEYS.ACTIVE_LIST]: activeList,
      });
    }
    if (!activeList || !lists[activeList]) {
      activeList = Object.keys(lists)[0] || DEFAULT_LIST_NAME;
    }

    return { lists, activeList };
  }

  async function persistLists(lists, activeList) {
    const { storage, STORAGE_KEYS } = window.Crosscart;
    await storage.setStorage({
      [STORAGE_KEYS.CART_LISTS]: lists,
      [STORAGE_KEYS.ACTIVE_LIST]: activeList,
    });
  }

  function createList(lists, name) {
    if (!name || lists[name]) return lists;
    return { ...lists, [name]: [] };
  }

  function deleteList(lists, name) {
    const next = { ...lists };
    delete next[name];
    if (Object.keys(next).length === 0) {
      next[DEFAULT_LIST_NAME] = [];
    }
    return next;
  }

  function renameList(lists, oldName, newName) {
    if (!newName || lists[newName] || !lists[oldName]) return lists;
    const next = { ...lists };
    next[newName] = next[oldName];
    delete next[oldName];
    return next;
  }

  function saveToList(lists, listName, product) {
    const items = lists[listName] ? [...lists[listName]] : [];
    const existing = items.find((item) => item.url === product.url);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
    } else {
      items.push(product);
    }
    return { ...lists, [listName]: items };
  }

  function deleteItem(lists, listName, itemId) {
    const items = (lists[listName] || []).filter((item) => item.id !== itemId);
    return { ...lists, [listName]: items };
  }

  function moveItem(lists, fromList, toList, itemId) {
    const source = lists[fromList] || [];
    const item = source.find((i) => i.id === itemId);
    if (!item) return lists;
    const next = { ...lists };
    next[fromList] = source.filter((i) => i.id !== itemId);
    next[toList] = [...(lists[toList] || []), item];
    return next;
  }

  function updateItemQuantity(lists, listName, itemId, quantity) {
    const items = (lists[listName] || []).map((item) =>
      item.id === itemId ? { ...item, quantity: Math.max(1, quantity) } : item
    );
    return { ...lists, [listName]: items };
  }

  function clearAll(lists, listName) {
    return { ...lists, [listName]: [] };
  }

  window.Crosscart.lists = {
    DEFAULT_LIST_NAME,
    loadLists,
    persistLists,
    createList,
    deleteList,
    renameList,
    saveToList,
    deleteItem,
    moveItem,
    updateItemQuantity,
    clearAll,
  };
})();
