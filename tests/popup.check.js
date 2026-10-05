// Drives popup/popup.html in jsdom against a fake chrome.storage.
// Usage: node tests/popup.check.js
// jsdom lives in ../crosscart-dev (outside the extension folder: Chrome refuses to load an
// unpacked extension containing files named "_..." and node_modules has some).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
module.paths.push(path.resolve(ROOT, '../crosscart-dev/node_modules'));
const { JSDOM } = require('jsdom');

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const item = (id, title, quantity = 1) => ({ id, title, url: `https://shop.com/${id}`, domain: 'shop.com', image: '', price: '10', currency: 'USD', quantity, savedAt: 1 });

async function openPopup(initial) {
  const store = JSON.parse(JSON.stringify(initial));
  const listeners = [];
  const source = fs.readFileSync(`${ROOT}/popup/popup.html`, 'utf8');
  const dom = new JSDOM(source.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), { runScripts: 'outside-only', url: 'https://popup.test/popup/popup.html' });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.chrome = {
    runtime: { id: 'test', sendMessage: () => Promise.resolve({ ok: true }) },
    storage: {
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener() {} },
      local: {
        get: (keys, cb) => cb(Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, sortKeys(store[k])]))),
        set: (data, cb) => {
          const changes = {};
          for (const [k, v] of Object.entries(data)) { store[k] = JSON.parse(JSON.stringify(v)); changes[k] = { newValue: sortKeys(v) }; }
          if (cb) cb();
          listeners.forEach((fn) => fn(changes, 'local'));
        },
        remove: (keys, cb) => { [].concat(keys).forEach((k) => delete store[k]); if (cb) cb(); },
      },
    },
  };
  for (const [, src] of source.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    window.eval(fs.readFileSync(path.resolve(ROOT, 'popup', src), 'utf8'));
  }
  // jsdom fires DOMContentLoaded itself once parsing finishes; dispatching it again would run init twice.
  if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick(60);
  const $ = (sel) => window.document.querySelector(sel);
  const $$ = (sel) => [...window.document.querySelectorAll(sel)];
  const click = async (el) => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(); };
  const change = async (el, value) => { el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); await tick(); };
  // Another screen (web app, sync) writing behind the popup's back, without telling it.
  const writeBehind = (fn) => { store.cartLists = fn(JSON.parse(JSON.stringify(store.cartLists))); };
  return { store, $, $$, click, change, writeBehind };
}

(async () => {
  const p = await openPopup({
    cartLists: { Tops: [item('a', 'A'), item('b', 'B')], Shoes: [item('s', 'S')] },
    activeList: 'Tops',
    exchangeRates: { rates: { USD: 1 }, fetchedAt: Date.now() },
  });
  // chrome.storage sorts object keys, so carts always come back alphabetical.
  assert.deepStrictEqual(p.$$('.crosscart-list-card').map((c) => c.dataset.list), ['Shoes', 'Tops']);
  console.log('1 dashboard lists every cart: ok');

  await p.click(p.$('[data-list="Tops"] .crosscart-list-card-body'));
  assert.strictEqual(p.$('#list-name-input').value, 'Tops');
  assert.strictEqual(p.$$('.crosscart-item').length, 2);
  console.log('2 opening a cart shows its items and name: ok');

  // The web app adds an item while the popup is open; a popup edit must not wipe it.
  p.writeBehind((lists) => ({ ...lists, Tops: [...lists.Tops, item('c', 'C')] }));
  await p.change(p.$('.crosscart-qty[data-id="a"]'), '3');
  assert.deepStrictEqual(p.store.cartLists.Tops.map((i) => [i.id, i.quantity]), [['a', 3], ['b', 1], ['c', 1]]);
  await p.click(p.$('.crosscart-delete[data-id="b"]'));
  assert.deepStrictEqual(p.store.cartLists.Tops.map((i) => i.id), ['a', 'c']);
  console.log('3 quantity and delete keep changes made elsewhere: ok');

  await p.change(p.$('#list-name-input'), 'Shirts');
  assert.deepStrictEqual(Object.keys(p.store.cartLists).sort(), ['Shirts', 'Shoes']);
  assert.strictEqual(p.store.activeList, 'Shirts');
  await p.change(p.$('#list-name-input'), 'Shoes');
  assert.deepStrictEqual(Object.keys(p.store.cartLists).sort(), ['Shirts', 'Shoes'], 'renaming onto an existing cart is refused');
  console.log('4 rename by editing the name; duplicates refused: ok');

  await p.click(p.$('#delete-list-btn'));
  assert.ok(p.store.cartLists.Shirts, 'one tap only arms the delete');
  await p.click(p.$('#delete-list-btn'));
  assert.ok(!p.store.cartLists.Shirts);
  assert.ok(p.$('.crosscart-list-card'), 'back on the dashboard');
  console.log('5 deleting the open cart takes two taps: ok');

  await p.click(p.$('#new-list-btn'));
  assert.ok(p.store.cartLists['Cart 1']);
  assert.strictEqual(p.$('#list-name-input').value, 'Cart 1');
  console.log('6 new cart is "Cart 1", opened for naming: ok');

  console.log('ALL POPUP CHECKS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
