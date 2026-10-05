// Checks list operations that carry logic. Usage: node tests/lists.check.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = require('path').resolve(__dirname, '..');

const ctx = { window: {}, URL };
vm.runInNewContext(fs.readFileSync(`${ROOT}/shared/lists.js`, 'utf8'), ctx);
const { setItemVariant } = ctx.window.Crosscart.lists;

const options = { Size: ['S', 'M', 'L'], Colour: ['Red'] };
const shirt = (id, size, quantity) => ({
  id, url: 'https://shop.com/tee', quantity, variantOptions: options,
  variantSelected: size ? { Size: size, Colour: 'Red' } : {}, variantConfidence: size ? 'high' : 'low',
});

// Picking a size on an unconfirmed item fills the single-option colour and confirms it.
let lists = setItemVariant({ Tops: [shirt('a', null, 1)] }, 'Tops', 'a', 'Size', 'M');
assert.deepStrictEqual({ ...lists.Tops[0].variantSelected }, { Size: 'M', Colour: 'Red' });
assert.strictEqual(lists.Tops[0].variantConfidence, 'high');

// Switching to a size that already has its own line merges them; quantities add.
lists = setItemVariant({ Tops: [shirt('a', 'S', 1), shirt('b', 'M', 2)] }, 'Tops', 'a', 'Size', 'M');
assert.strictEqual(lists.Tops.length, 1);
assert.strictEqual(lists.Tops[0].id, 'b');
assert.strictEqual(lists.Tops[0].quantity, 3);

// Unknown item: nothing changes.
const same = { Tops: [shirt('a', 'S', 1)] };
assert.strictEqual(setItemVariant(same, 'Tops', 'zzz', 'Size', 'M'), same);

console.log('lists: ok');
