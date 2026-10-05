// Extension service worker: owns the extension's own Supabase session and keeps the local
// chrome.storage lists in sync with the user's account (the server is the source of truth once
// signed in; chrome.storage is the offline cache the popup and content scripts read).

self.window = self; // shared/*.js attach their APIs to window.Crosscart
importScripts('/shared/constants.js', '/shared/storage.js', '/shared/config.js');

const { STORAGE_KEYS, storage } = self.Crosscart;

const SUPABASE_URL = 'https://yrfengptboswesicdmhe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PYdC8UYjLq5OAdcwnafyTg_sNiszXl1';
const SYNC_ALARM = 'crosscart-sync';
const LOCAL_CHANGE_DEBOUNCE_MS = 1500;
const ZERO_DECIMAL = new Set(['JPY']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- session ----------

async function getSession() {
  const session = (await storage.getStorage([STORAGE_KEYS.AUTH_SESSION]))[STORAGE_KEYS.AUTH_SESSION] || null;
  // Sessions from the old handoff were the web app's own; refreshing one would revoke the web sign-in.
  if (session && !session.ownSession) {
    await storage.removeStorage([STORAGE_KEYS.AUTH_SESSION]);
    return null;
  }
  return session;
}

function sessionFrom(body) {
  return {
    ownSession: true,
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
    user: { id: body.user.id, email: body.user.email || null },
  };
}

async function authPost(path, body, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.msg || json.error_description || json.message || `Auth request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return json;
}

let refreshing = null;

async function accessToken() {
  const session = await getSession();
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const body = await authPost('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        const next = sessionFrom(body);
        await storage.setStorage({ [STORAGE_KEYS.AUTH_SESSION]: next });
        return next.access_token;
      } catch (error) {
        // A rejected refresh token means the session is gone for good; a network error does not.
        if (error.status === 400 || error.status === 401) await storage.removeStorage([STORAGE_KEYS.AUTH_SESSION]);
        throw error;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

// ---------- REST ----------

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Signed out');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const error = new Error(`Sync request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  return method === 'GET' ? res.json() : null;
}

const upsert = (table, rows) =>
  rows.length
    ? rest(`${table}?on_conflict=id`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' })
    : null;

const softDelete = (table, ids) =>
  ids.length
    ? rest(`${table}?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        body: { deleted_at: new Date().toISOString() },
        prefer: 'return=minimal',
      })
    : null;

// ---------- local <-> server shapes ----------

function toMinor(price, currency) {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * (ZERO_DECIMAL.has(currency) ? 1 : 100));
}

function fromMinor(minor, currency) {
  if (minor === null || minor === undefined) return '';
  return ZERO_DECIMAL.has(currency) ? minor : minor / 100;
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$)/;

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    [...parsed.searchParams.keys()].filter((k) => TRACKING_PARAMS.test(k)).forEach((k) => parsed.searchParams.delete(k));
    return parsed.href;
  } catch (e) {
    return url;
  }
}

// Postgres jsonb reorders keys, so compare variants with keys sorted.
function stableVariant(variant) {
  return JSON.stringify(Object.fromEntries(Object.entries(variant || {}).sort(([a], [b]) => a.localeCompare(b))));
}

function dedupeKey(item) {
  return `${canonicalUrl(item.url)} ${stableVariant(item.variantSelected)}`;
}

function isSyncable(item) {
  return item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url);
}

function itemRow(item, listId, position, userId) {
  const currency = /^[A-Z]{3}$/.test(item.currency || '') ? item.currency : null;
  let domain = item.domain;
  if (!domain) {
    try {
      domain = new URL(item.url).hostname;
    } catch (e) {
      domain = 'unknown';
    }
  }
  return {
    id: item.id,
    list_id: listId,
    user_id: userId,
    url: item.url,
    canonical_url: canonicalUrl(item.url),
    domain,
    title: String(item.title || '').trim().slice(0, 500) || 'Untitled product',
    image_url: /^https?:\/\//i.test(item.image || '') ? item.image : null,
    saved_price_minor: toMinor(item.price, currency),
    saved_currency: currency,
    quantity: Math.min(999, Math.max(1, Math.round(Number(item.quantity) || 1))),
    position,
    variant_selected: item.variantSelected || {},
    variant_options: item.variantOptions || {},
    variant_source: item.variantSource || null,
    variant_confidence: item.variantConfidence || null,
    saved_at: new Date(item.savedAt || Date.now()).toISOString(),
    deleted_at: null,
  };
}

// Key order must not matter: chrome.storage hands objects back with sorted keys and Postgres
// jsonb returns its own order, so a plain JSON.stringify saw every variant item as "edited
// here", re-pushed it on every sync and pushed it over fixes made on the server.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

// Change detection ignores position (compared separately) and saved_at (never changes).
function rowHash(row) {
  const { position, saved_at, deleted_at, ...rest } = row;
  return JSON.stringify(sortKeys(rest));
}

// Snapshots saved before key order was ignored hold order-sensitive hashes; re-sort them once
// so the first sync after the update doesn't mistake every item for a local edit.
function upgradeShadowHashes(shadow) {
  for (const entry of Object.values(shadow.items || {})) {
    try {
      entry.hash = JSON.stringify(sortKeys(JSON.parse(entry.hash)));
    } catch (e) {}
  }
}

function localItem(row) {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    url: row.url,
    image: row.image_url || '',
    price: fromMinor(row.saved_price_minor, row.saved_currency),
    currency: row.saved_currency || 'USD',
    quantity: row.quantity,
    savedAt: Date.parse(row.saved_at) || Date.now(),
    variantSelected: row.variant_selected || {},
    variantOptions: row.variant_options || {},
    variantSource: row.variant_source || null,
    variantConfidence: row.variant_confidence || null,
  };
}

// ---------- sync ----------

// Local ids from before sync existed are "timestamp-random"; the server needs UUIDs.
function normalizeLocal(lists) {
  let changed = false;
  const next = {};
  for (const [name, items] of Object.entries(lists)) {
    const seen = new Map();
    next[name] = [];
    for (const raw of items || []) {
      if (!isSyncable(raw)) continue;
      const item = { ...raw };
      if (!UUID_RE.test(String(item.id))) {
        item.id = crypto.randomUUID();
        changed = true;
      }
      const key = dedupeKey(item);
      if (seen.has(key)) {
        const kept = seen.get(key);
        kept.quantity = Math.max(kept.quantity || 1, item.quantity || 1);
        continue;
      }
      seen.set(key, item);
      next[name].push(item);
    }
    if (next[name].length !== (items || []).length) changed = true;
  }
  return { lists: next, changed };
}

function mergeServerIntoLocal(lists, serverLists, serverItems) {
  const next = Object.fromEntries(Object.entries(lists).map(([name, items]) => [name, [...items]]));
  const nameById = {};
  for (const list of [...serverLists].sort((a, b) => a.position - b.position)) {
    nameById[list.id] = list.name;
    if (!next[list.name]) next[list.name] = [];
  }
  for (const row of [...serverItems].sort((a, b) => a.position - b.position)) {
    const name = nameById[row.list_id];
    if (!name) continue;
    const incoming = localItem(row);
    const items = next[name];
    if (items.some((i) => i.id === incoming.id)) continue; // local copy wins on first merge and is pushed next
    const sameProduct = items.findIndex((i) => dedupeKey(i) === dedupeKey(incoming));
    if (sameProduct !== -1) {
      // Keep the higher quantity rather than adding, so merging twice never doubles a cart.
      const kept = items[sameProduct];
      items[sameProduct] = { ...kept, id: incoming.id, quantity: Math.max(kept.quantity || 1, incoming.quantity) };
    } else {
      items.push(incoming);
    }
  }
  return next;
}

function applyServerChanges(lists, shadow, listIds, serverLists, serverItems) {
  const next = Object.fromEntries(Object.entries(lists).map(([name, items]) => [name, [...items]]));
  const nameById = Object.fromEntries(Object.entries(listIds).map(([name, id]) => [id, name]));

  for (const list of serverLists) {
    const localName = nameById[list.id];
    if (list.deleted_at) {
      if (localName) {
        delete next[localName];
        delete listIds[localName];
      }
      continue;
    }
    if (localName && localName !== list.name && next[localName] && !next[list.name]) {
      next[list.name] = next[localName];
      delete next[localName];
      delete listIds[localName];
    } else if (!next[list.name]) {
      next[list.name] = [];
    }
    listIds[list.name] = list.id;
    nameById[list.id] = list.name;
  }

  const locate = (id) => {
    for (const [name, items] of Object.entries(next)) {
      const index = items.findIndex((i) => i.id === id);
      if (index !== -1) return { name, index };
    }
    return null;
  };

  // Where each item sat before this pull starts moving things around.
  const localPlace = {};
  for (const [name, items] of Object.entries(next)) {
    items.forEach((item, index) => (localPlace[item.id] = { index, listId: listIds[name] }));
  }

  for (const row of serverItems) {
    const found = locate(row.id);
    const shadowItem = shadow.items[row.id];
    // Items edited locally since the last sync keep the local edit; it gets pushed below.
    // A move counts as an edit: the pull re-reads rows our last push touched, still
    // holding the old position, and would otherwise undo a drag-reorder.
    // Synced before but gone locally means it was deleted here: don't let the echo
    // bring it back. The push below soft-deletes it on the server.
    if (!found && shadowItem && !row.deleted_at) continue;
    if (found && shadowItem) {
      const localHash = rowHash(itemRow(next[found.name][found.index], shadowItem.listId, 0, shadow.userId));
      const place = localPlace[row.id];
      const moved = place && (place.index !== shadowItem.position || place.listId !== shadowItem.listId);
      if (localHash !== shadowItem.hash || moved) continue;
    }
    if (row.deleted_at) {
      if (found) next[found.name].splice(found.index, 1);
      continue;
    }
    const targetName = nameById[row.list_id];
    if (!targetName || !next[targetName]) continue;
    if (found) next[found.name].splice(found.index, 1);
    const target = next[targetName];
    target.splice(Math.min(row.position, target.length), 0, localItem(row));
  }
  return next;
}

async function runSync() {
  const session = await getSession();
  if (!session) return;
  const userId = session.user.id;

  const stored = await storage.getStorage([STORAGE_KEYS.CART_LISTS, STORAGE_KEYS.SYNC_STATE]);
  const previous = stored[STORAGE_KEYS.SYNC_STATE];
  const firstSync = !previous || previous.userId !== userId;
  const shadow = firstSync ? { userId, cursor: null, listIds: {}, lists: {}, items: {} } : previous;
  upgradeShadowHashes(shadow);

  let { lists, changed } = normalizeLocal(stored[STORAGE_KEYS.CART_LISTS] || {});
  const listIds = { ...shadow.listIds };

  // Pull everything on first sync, then only rows changed since the last one (deletions included).
  const filter = shadow.cursor ? `updated_at=gt.${encodeURIComponent(shadow.cursor)}` : 'deleted_at=is.null';
  const [serverLists, serverItems] = await Promise.all([
    rest(`lists?select=*&${filter}&order=updated_at.asc`),
    rest(`list_items?select=*&${filter}&order=updated_at.asc`),
  ]);
  const cursor = [...serverLists, ...serverItems].reduce((max, row) => (row.updated_at > max ? row.updated_at : max), shadow.cursor || '');

  if (firstSync) {
    lists = mergeServerIntoLocal(lists, serverLists, serverItems);
    serverLists.forEach((list) => (listIds[list.name] = list.id));
    changed = true;
  } else if (serverLists.length || serverItems.length) {
    const before = JSON.stringify(lists);
    lists = applyServerChanges(lists, shadow, listIds, serverLists, serverItems);
    if (JSON.stringify(lists) !== before) changed = true;
  }

  // Push: lists first (items reference them), then items, then deletions.
  const vanishedNames = Object.keys(listIds).filter((name) => !lists[name]);
  const finalListIds = {};
  const listRows = [];

  Object.entries(lists).forEach(([name, items], position) => {
    let id = listIds[name];
    if (!id) {
      // A new name holding items that used to live in a list that vanished is a rename: keep that list's id.
      const renamedFrom = vanishedNames.find((old) => items.some((i) => shadow.items[i.id]?.listId === listIds[old]));
      if (renamedFrom) {
        id = listIds[renamedFrom];
        vanishedNames.splice(vanishedNames.indexOf(renamedFrom), 1);
      } else {
        id = crypto.randomUUID();
      }
    }
    finalListIds[name] = id;
    const known = shadow.lists[id];
    if (!known || known.name !== name || known.position !== position) {
      listRows.push({ id, user_id: userId, name, position, deleted_at: null });
    }
  });

  const itemRows = [];
  const nextItems = {};
  for (const [name, items] of Object.entries(lists)) {
    items.forEach((item, position) => {
      const row = itemRow(item, finalListIds[name], position, userId);
      const hash = rowHash(row);
      const known = shadow.items[item.id];
      nextItems[item.id] = { hash, listId: row.list_id, position };
      if (!known || known.hash !== hash || known.position !== position || known.listId !== row.list_id) itemRows.push(row);
    });
  }

  const liveListIds = new Set(Object.values(finalListIds));
  const deletedItemIds = Object.keys(shadow.items).filter((id) => !nextItems[id]);
  const deletedListIds = Object.keys(shadow.lists).filter((id) => !liveListIds.has(id));

  await upsert('lists', listRows);
  await upsert('list_items', itemRows);
  await softDelete('list_items', deletedItemIds);
  await softDelete('lists', deletedListIds);

  if (changed) await writeLocalLists(lists);

  const names = Object.keys(lists);
  await storage.setStorage({
    [STORAGE_KEYS.SYNC_STATE]: {
      userId,
      cursor: cursor || null,
      listIds: finalListIds,
      lists: Object.fromEntries(names.map((name, position) => [finalListIds[name], { name, position }])),
      items: nextItems,
    },
  });
}

// Writes made by sync itself must not trigger another sync.
let lastWrittenLists = null;

async function writeLocalLists(lists) {
  lastWrittenLists = JSON.stringify(lists);
  const stored = await storage.getStorage([STORAGE_KEYS.ACTIVE_LIST]);
  const active = stored[STORAGE_KEYS.ACTIVE_LIST];
  const update = { [STORAGE_KEYS.CART_LISTS]: lists };
  if (!active || !lists[active]) update[STORAGE_KEYS.ACTIVE_LIST] = Object.keys(lists)[0];
  await storage.setStorage(update);
}

let syncing = null;
let syncAgain = false;
let lastSyncError = null;

function requestSync() {
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = runSync()
    .then(() => {
      lastSyncError = null;
    })
    .catch((error) => {
      lastSyncError = error.message;
      console.warn('[CrossCart] sync failed:', error.message);
    })
    .finally(() => {
      syncing = null;
      if (syncAgain) {
        syncAgain = false;
        requestSync();
      }
    });
  return syncing;
}

// ---------- linking and sign-out ----------

async function linkWithToken(tokenHash) {
  const previous = await getSession();
  const body = await authPost('verify', { type: 'magiclink', token_hash: tokenHash });
  const session = sessionFrom(body);

  // A different account was signed in here: its cached lists belong to that account, not this one.
  if (previous && previous.user.id !== session.user.id) {
    await storage.removeStorage([STORAGE_KEYS.CART_LISTS, STORAGE_KEYS.ACTIVE_LIST, STORAGE_KEYS.SYNC_STATE]);
  }
  await storage.setStorage({ [STORAGE_KEYS.AUTH_SESSION]: session });
  await requestSync();
  return session.user.id;
}

async function signOut() {
  if (!(await getSession())) return;
  await requestSync();
  const synced = lastSyncError === null;
  try {
    const token = await accessToken();
    if (token) await authPost('logout?scope=local', {}, token);
  } catch (e) {
    // Signing out locally still matters even if the server call fails.
  }
  const keys = [STORAGE_KEYS.AUTH_SESSION, STORAGE_KEYS.SYNC_STATE];
  // ponytail: if the final upload failed (offline), keep the cached lists rather than lose unsynced saves
  if (synced) keys.push(STORAGE_KEYS.CART_LISTS, STORAGE_KEYS.ACTIVE_LIST);
  await storage.removeStorage(keys);
}

// ---------- wiring ----------

function fromAllowedPage(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    // Only the web app (shared/config.js) may link or sign out the extension.
    return new URL(sender.url).origin === self.Crosscart.WEB_ORIGIN;
  } catch (e) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message) return false;

  const reply = (promise) => {
    promise
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };

  if (message.type === 'syncNow') return reply(requestSync().then(() => ({})));
  if (message.type === 'extensionStatus') {
    return reply(getSession().then((s) => ({ userId: s ? s.user.id : null, lastSyncError })));
  }
  if (message.type === 'linkExtension' && typeof message.tokenHash === 'string' && fromAllowedPage(sender)) {
    return reply(linkWithToken(message.tokenHash).then((userId) => ({ userId })));
  }
  if (message.type === 'signOut' && fromAllowedPage(sender)) return reply(signOut().then(() => ({})));
  return false;
});

let debounce = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEYS.CART_LISTS]) return;
  if (JSON.stringify(changes[STORAGE_KEYS.CART_LISTS].newValue) === lastWrittenLists) return;
  clearTimeout(debounce);
  debounce = setTimeout(requestSync, LOCAL_CHANGE_DEBOUNCE_MS);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) requestSync();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  requestSync();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  requestSync();
});
