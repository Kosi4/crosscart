// Checks the checkout fee math, and that the fees cover what an order costs CrossCart.
// Usage: node tests/pricing.check.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = require('path').resolve(__dirname, '..');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(`${ROOT}/shared/pricing.js`, 'utf8'), ctx);
const { PRICING, quote, margin } = ctx.window.Crosscart.pricing;

// Fee parts on a mixed cart: two USD stores, one ZAR store.
const cart = [
  { goodsUsd: 100, shipUsd: 6, currency: 'USD' },
  { goodsUsd: 50, shipUsd: 6, currency: 'usd' },
  { goodsUsd: 200, shipUsd: 10, currency: 'ZAR' },
];
const free = quote(cart, 'free');
assert.strictEqual(free.goods, 350);
assert.strictEqual(free.service, 17.5); // 5% of 350
assert.strictEqual(free.perStore, 4.5); // 3 x 1.50
assert.strictEqual(free.conversion, 4.2); // 2% of the ZAR store's items + shipping only; currency match is case-insensitive
assert.strictEqual(free.shipping, 22);
assert.strictEqual(free.foreignStores, 1);
assert.strictEqual(free.fee, 26.2);

// Plus waives the store fee and nothing else.
const plus = quote(cart, 'plus');
assert.strictEqual(plus.perStore, 0);
assert.strictEqual(plus.waived, 4.5);
assert.strictEqual(plus.fee, 21.7);

// Anything that isn't 'plus' is the free plan.
assert.strictEqual(quote(cart, undefined).plan, 'free');
assert.strictEqual(quote([], 'free').fee, 0);

// Small orders pay the minimum service fee, not 5%.
assert.strictEqual(quote([{ goodsUsd: 12, currency: 'USD' }], 'free').service, PRICING.MIN_SERVICE_USD);

// Free-plan fees must cover our costs on every realistic order, including the
// worst case: an international card buying from stores in another currency.
let worst = null;
for (const goodsPerStore of [15, 40, 100, 250, 600]) {
  for (const storeCount of [1, 2, 3, 6]) {
    for (const foreign of [false, true]) {
      for (const intlCard of [false, true]) {
        const stores = Array.from({ length: storeCount }, () => ({ goodsUsd: goodsPerStore, shipUsd: 10, currency: foreign ? 'ZAR' : 'USD' }));
        const m = margin(quote(stores, 'free'), { intlCard });
        if (!worst || m < worst.m) worst = { m, goodsPerStore, storeCount, foreign, intlCard };
        assert.ok(m >= 0, `free plan loses $${-m} on ${storeCount} stores x $${goodsPerStore} (foreign ${foreign}, intl card ${intlCard})`);
      }
    }
  }
}

// Plus orders can dip below zero per order; the subscription pays for that. Report it.
const typical = Array.from({ length: 3 }, () => ({ goodsUsd: 80, shipUsd: 10, currency: 'ZAR' }));
const plusWorst = margin(quote(typical, 'plus'), { intlCard: true });

console.log('pricing: ok');
console.log(`  structure: ${PRICING.SERVICE_RATE * 100}% + $${PRICING.PER_STORE_USD}/store + ${PRICING.FX_RATE * 100}% on non-${PRICING.CARD_CURRENCY} stores`);
console.log(`  free plan lowest margin: $${worst.m} (${worst.storeCount} stores x $${worst.goodsPerStore}, foreign ${worst.foreign}, intl card ${worst.intlCard})`);
console.log(`  plus, typical worst-case order: $${plusWorst} vs $${PRICING.PLUS_MONTHLY_USD}/month`);
