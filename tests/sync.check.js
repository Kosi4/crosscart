// Runs background/sync.js against an in-memory fake Supabase + chrome.storage.
// Usage: node tests/sync.check.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { webcrypto } = require('crypto');
const ROOT = require('path').resolve(__dirname, '..');
const USER = '11111111-1111-4111-8111-111111111111';

function makeWorld(initialLocal) {
  const store = JSON.parse(JSON.stringify(initialLocal));
  const changeListeners = [];
  const emit = (changes) => changeListeners.forEach((fn) => fn(changes, 'local'));
  const world = {};
  const chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (fn) => (world.onMessage = fn) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    storage: {
      onChanged: { addListener: (fn) => changeListeners.push(fn), removeListener() {} },
      local: {
        get: (keys, cb) => cb(Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))]))),
        set: (data, cb) => {
          const changes = {};
          for (const [k, v] of Object.entries(data)) { changes[k] = { newValue: JSON.parse(JSON.stringify(v)) }; store[k] = JSON.parse(JSON.stringify(v)); }
          cb(); emit(changes);
        },
        remove: (keys, cb) => { const changes = {}; [].concat(keys).forEach((k) => { if (k in store) { changes[k] = { newValue: undefined }; delete store[k]; } }); cb(); emit(changes); },
      },
    },
  };

  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 15, 12, 0, 0) + ++tick * 1000).toISOString();
  const db = { lists: [], list_items: [] };
  const requests = [];
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

  function checkUnique(table, row) {
    if (row.deleted_at) return;
    const clash = db[table].find((r) => r.id !== row.id && !r.deleted_at && (table === 'lists'
      ? r.user_id === row.user_id && r.name === row.name
      : r.list_id === row.list_id && r.canonical_url === row.canonical_url && JSON.stringify(r.variant_selected) === JSON.stringify(row.variant_selected)));
    if (clash) throw Object.assign(new Error('duplicate key'), { status: 409 });
  }

  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const method = opts.method || 'GET';
    requests.push(`${method} ${u.pathname}${u.search}`);
    if (u.pathname === '/auth/v1/verify') return res(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, user: { id: USER, email: 'a@b.c' } });
    if (u.pathname === '/auth/v1/logout') return res(204, {});
    if (u.pathname === '/auth/v1/token') return res(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600, user: { id: USER } });
    const table = u.pathname.replace('/rest/v1/', '');
    if (method === 'GET') {
      let rows = db[table];
      const del = u.searchParams.get('deleted_at');
      const upd = u.searchParams.get('updated_at');
      if (del === 'is.null') rows = rows.filter((r) => !r.deleted_at);
      if (upd) rows = rows.filter((r) => r.updated_at > upd.replace('gt.', ''));
      return res(200, JSON.parse(JSON.stringify(rows)));
    }
    if (method === 'POST') {
      const rows = JSON.parse(opts.body);
      try {
        for (const row of rows) {
          const existing = db[table].find((r) => r.id === row.id);
          const merged = { ...(existing || {}), ...row, updated_at: now() };
          checkUnique(table, merged);
          if (existing) Object.assign(existing, merged); else db[table].push(merged);
        }
      } catch (e) { return res(e.status || 500, { message: e.message }); }
      return res(201, null);
    }
    if (method === 'PATCH') {
      const ids = u.searchParams.get('id').replace(/^in\.\(|\)$/g, '').split(',');
      const patch = JSON.parse(opts.body);
      db[table].filter((r) => ids.includes(r.id)).forEach((r) => Object.assign(r, patch, { updated_at: now() }));
      return res(204, null);
    }
    throw new Error(`unhandled ${method} ${url}`);
  }

  const ctx = { chrome, fetch, crypto: webcrypto, console: { warn: (...a) => world.warnings.push(a.join(' ')), log: console.log }, setTimeout, clearTimeout, URL, Date, JSON, Math, Promise, Object, Array, Set, Map, String, Number, Boolean, Error, RegExp, encodeURIComponent };
  ctx.self = ctx;
  ctx.importScripts = (...paths) => paths.forEach((p) => vm.runInContext(fs.readFileSync(ROOT + p, 'utf8'), ctx));
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(`${ROOT}/background/sync.js`, 'utf8'), ctx);

  Object.assign(world, {
    store, db, requests, now, warnings: [],
    send: (message) => new Promise((resolve) => world.onMessage(message, { id: 'ext', url: 'http://localhost:55983/web/' }, resolve)),
    active: (table) => db[table].filter((r) => !r.deleted_at),
  });
  return world;
}

const item = (id, title, url, price, currency, quantity = 1) => ({ id, title, url, domain: new URL(url).hostname, image: 'https://x.com/i.jpg', price, currency, quantity, savedAt: 1789000000000 });
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const w = makeWorld({
    cartLists: { Shoes: [item('1789-abc', 'ASICS', 'https://stockx.com/asics?utm_source=x', '97', 'USD')], Hoodie: [item('1789-def', 'Denim', 'https://jdsports.co.za/d', '1499.95', 'ZAR', 2)] },
    activeList: 'Shoes',
  });
  let r = await w.send({ type: 'linkExtension', tokenHash: 'hash' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(w.warnings, []);
  assert.strictEqual(w.active('lists').length, 2);
  assert.strictEqual(w.active('list_items').length, 2);
  const denim = w.db.list_items.find((i) => i.title === 'Denim');
  assert.strictEqual(denim.saved_price_minor, 149995);
  assert.strictEqual(denim.quantity, 2);
  assert.match(w.store.cartLists.Shoes[0].id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(w.db.list_items.find((i) => i.title === 'ASICS').canonical_url, 'https://stockx.com/asics');
  console.log('1 first upload: ok');

  let before = w.requests.length;
  await w.send({ type: 'syncNow' });
  assert.deepStrictEqual(w.requests.slice(before).filter((x) => !x.startsWith('GET')), []);
  console.log('2 no-op sync sends no writes: ok');

  let lists = clone(w.store.cartLists);
  lists.Hoodie[0].quantity = 5;
  w.store.cartLists = lists;
  await w.send({ type: 'syncNow' });
  assert.strictEqual(w.db.list_items.find((i) => i.title === 'Denim').quantity, 5);
  console.log('3 local edit pushed: ok');

  const remote = w.db.list_items.find((i) => i.title === 'ASICS');
  Object.assign(remote, { title: 'ASICS Gel 1130', updated_at: w.now() });
  await w.send({ type: 'syncNow' });
  assert.strictEqual(w.store.cartLists.Shoes[0].title, 'ASICS Gel 1130');
  console.log('4 remote edit pulled: ok');

  const shoesId = w.active('lists').find((l) => l.name === 'Shoes').id;
  lists = clone(w.store.cartLists);
  w.store.cartLists = { Sneakers: lists.Shoes, Hoodie: lists.Hoodie };
  await w.send({ type: 'syncNow' });
  assert.deepStrictEqual(w.warnings, []);
  assert.strictEqual(w.active('lists').length, 2);
  assert.strictEqual(w.active('lists').find((l) => l.name === 'Sneakers').id, shoesId);
  console.log('5 rename keeps list id: ok');

  lists = clone(w.store.cartLists);
  lists.Hoodie = [];
  w.store.cartLists = lists;
  await w.send({ type: 'syncNow' });
  assert.strictEqual(w.active('list_items').length, 1);
  console.log('6 local delete pushed: ok');

  const hoodie = w.active('lists').find((l) => l.name === 'Hoodie');
  Object.assign(hoodie, { deleted_at: w.now(), updated_at: w.now() });
  await w.send({ type: 'syncNow' });
  assert.ok(!w.store.cartLists.Hoodie);
  console.log('7 remote list delete pulled: ok');

  const w2 = makeWorld({ cartLists: { Sneakers: [item('local-1', 'ASICS', 'https://stockx.com/asics', '97', 'USD', 1)], Local: [item('local-2', 'Cap', 'https://wearerighteous.com.co/cap', '34', 'USD')] } });
  w2.db.lists.push(...clone(w.db.lists));
  w2.db.list_items.push(...clone(w.db.list_items));
  const serverAsics = w2.active('list_items').find((i) => i.canonical_url === 'https://stockx.com/asics');
  serverAsics.quantity = 3;
  r = await w2.send({ type: 'linkExtension', tokenHash: 'hash' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(w2.warnings, []);
  assert.strictEqual(w2.store.cartLists.Sneakers.length, 1);
  assert.strictEqual(w2.store.cartLists.Sneakers[0].quantity, 3);
  assert.strictEqual(w2.store.cartLists.Sneakers[0].id, serverAsics.id);
  assert.strictEqual(w2.active('list_items').filter((i) => i.canonical_url === 'https://stockx.com/asics').length, 1);
  assert.ok(w2.active('lists').some((l) => l.name === 'Local'));
  await w2.send({ type: 'syncNow' });
  assert.strictEqual(w2.active('list_items').length, 2);
  console.log('8 second-device merge, no duplicates or doubled quantity: ok');

  r = await w2.send({ type: 'signOut' });
  assert.strictEqual(r.ok, true);
  assert.ok(!('authSession' in w2.store) && !('cartLists' in w2.store) && !('syncState' in w2.store));
  console.log('9 sign-out clears session and cache: ok');

  const w3 = makeWorld({ authSession: { access_token: 'web', refresh_token: 'web-rt', expires_at: 0, user: { id: USER } } });
  r = await w3.send({ type: 'extensionStatus' });
  assert.strictEqual(r.userId, null);
  assert.ok(!('authSession' in w3.store));
  assert.ok(!w3.requests.some((x) => x.includes('token')));
  console.log('10 old web-app session discarded, never refreshed: ok');

  console.log('ALL SYNC CHECKS PASSED');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
