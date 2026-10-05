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

  // Must match background/sync.js dedupeKey(): the server allows one row per
  // canonical URL + selected variant, so a different size is a separate line.
  const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$)/;

  function productKey(item) {
    let url = item.url;
    try {
      const parsed = new URL(item.url);
      parsed.hash = '';
      [...parsed.searchParams.keys()].filter((k) => TRACKING_PARAMS.test(k)).forEach((k) => parsed.searchParams.delete(k));
      url = parsed.href;
    } catch (e) {}
    const variant = Object.fromEntries(Object.entries(item.variantSelected || {}).sort(([a], [b]) => a.localeCompare(b)));
    return `${url} ${JSON.stringify(variant)}`;
  }

  function saveToList(lists, listName, product) {
    const items = lists[listName] ? [...lists[listName]] : [];
    const key = productKey(product);
    const existing = items.find((item) => productKey(item) === key);
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

  // The shopper picks a variant in the web cart. If that variant already has its own
  // line, the two merge (quantities add): the server allows one line per product + variant.
  // Groups with a single option fill themselves; it's confirmed once every group is set.
  // A store that gave no options at all lets the shopper type one (group "Size").
  function setItemVariant(lists, listName, itemId, group, value) {
    const items = lists[listName] || [];
    const item = items.find((i) => i.id === itemId);
    if (!item) return lists;

    const options = item.variantOptions || {};
    const selected = { ...(item.variantSelected || {}), [group]: value };
    if (!value) delete selected[group]; // a typed size cleared back to nothing
    Object.entries(options).forEach(([name, values]) => {
      if (!selected[name] && values.length === 1) selected[name] = values[0];
    });
    const complete = Object.keys(options).every((name) => selected[name]);
    const updated = { ...item, variantSelected: selected, variantConfidence: complete ? 'high' : 'low' };

    const key = productKey(updated);
    const twin = items.find((i) => i.id !== itemId && productKey(i) === key);
    const next = twin
      ? items
          .filter((i) => i.id !== itemId)
          .map((i) => (i === twin ? { ...i, quantity: (i.quantity || 1) + (item.quantity || 1) } : i))
      : items.map((i) => (i.id === itemId ? updated : i));
    return { ...lists, [listName]: next };
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
    setItemVariant,
    clearAll,
  };
})();
