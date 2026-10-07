// Runs the scraper on saved store pages and compares to tests/scrape.expected.json.
// Usage: node tests/scrape.check.js            (check)
//        node tests/scrape.check.js --record   (accept current output as expected; review the diff!)
// Pages live in ../crosscart-dev/fixtures (copies of other companies' pages stay out of the
// public repo); jsdom in ../crosscart-dev/node_modules. Missing pages are reported, not failed.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const DEV = path.resolve(ROOT, '../crosscart-dev');
module.paths.push(`${DEV}/node_modules`);
const { JSDOM, VirtualConsole } = require('jsdom');

const STORES = {
  cottonon: 'https://cottonon.com/ZA/authentics-oversized-zip-thru-hoodie/5299923-04.html',
  frclothing: 'https://frclothingandsupply.com/carhartt-fr-duck-bib-overall-unlined-black/',
  kittedsa: 'https://kittedsa.co.za/products/manchester-united-07-08-ronaldo-black-long-sleeve',
  kyw: 'https://kywmovement.com/products/pink-kyw-rugby-tshirt',
  valeclothing: 'https://vale-clothing.com/product/vale-forever-rhinestone-plaid-flannel/',
  righteous: 'https://wearerighteous.com.co/product/risen-king-zip-up-sky-blue/',
  amazon: 'https://www.amazon.co.za/Dolce-Gabbana-Light-Homme-Toilette/dp/B0C71NJHMQ',
  spaceboy: 'https://www.spaceboy-apparel.com/products/spaceboy-university-set-copy',
  supermade: 'https://www.thesupermade.com/products/graphic-streetwear-zip-up-hoodie',
  youngla: 'https://www.youngla.com/products/2127',
  osmanlioud: 'https://za.osmanlioud.net/product/blue-motion-eau-de-perfume/',
  jdsports: 'https://jdsports.co.za/jordan-men-s-flight-short-sleeve-white-t-shirt-62001354/p',
  samsung: 'https://www.samsung.com/za/smartphones/galaxy-s26-ultra/buy/',
  stockx: 'https://stockx.com/puma-lamelo-ball-lafrance-amour-black',
  cfs: 'https://www.classicfootballshirts.co.uk/2025-26-manchester-united-authentic-third-ls-shirt-mainoo-37jp3040-37mainoo.html',
  farfetch: 'https://www.farfetch.com/za/shopping/men/sp5der-graphic-print-hoodie-item-22543745.aspx',
};
const SCRIPTS = ['shared/constants.js', 'shared/currency.js', 'content/detect.js', 'content/agent-sites.js', 'content/scrape.js'];

function scrape(file, url) {
  // Keep JSON-LD, drop the stores' own scripts (they'd try to run in jsdom).
  const html = fs.readFileSync(file, 'utf8').replace(/<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, '');
  const { window } = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) }; // jsdom lacks CSS.escape
  for (const s of SCRIPTS) window.eval(fs.readFileSync(`${ROOT}/${s}`, 'utf8'));
  const C = window.Crosscart;
  const p = C.scrape.scrapeProduct();
  return {
    isProduct: Boolean(C.detect.isProductPage()),
    title: p.title,
    price: String(p.price),
    currency: p.currency,
    originalPrice: p.originalPrice || '',
    image: /^https:\/\/.+/.test(p.image || '') && !/logo/i.test(p.image) ? 'photo' : p.image ? `bad:${p.image.slice(0, 60)}` : 'none',
    options: Object.keys(p.variantOptions || {}).sort(),
  };
}

// Name cleanup: a stock code in front goes, brand names that look like codes stay.
{
  const { window } = new JSDOM('', { runScripts: 'outside-only' });
  for (const s of SCRIPTS.slice(0, 4)) window.eval(fs.readFileSync(`${ROOT}/${s}`, 'utf8'));
  const clean = window.Crosscart.agentSites.cleanTitle;
  assert.strictEqual(clean('SP260924P7NV Graphic Streetwear Zip-Up Jacket'), 'Graphic Streetwear Zip-Up Jacket');
  assert.strictEqual(clean('SP5DER Graphic Hoodie'), 'SP5DER Graphic Hoodie');
  assert.strictEqual(clean('ESSENTIALS Fleece Hoodie'), 'ESSENTIALS Fleece Hoodie');
  assert.strictEqual(clean('Air Jordan 4 Retro'), 'Air Jordan 4 Retro');
  console.log('  name cleanup: ok');
}

const expectedFile = `${__dirname}/scrape.expected.json`;
const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, 'utf8')) : {};
const record = process.argv.includes('--record');
const actual = {};
let failed = 0;
for (const [name, url] of Object.entries(STORES)) {
  const file = `${DEV}/fixtures/${name}.html`;
  if (!fs.existsSync(file) || fs.statSync(file).size < 20000) {
    console.log(`- ${name}: no saved page (blocked or not downloaded)`);
    if (expected[name]) actual[name] = expected[name];
    continue;
  }
  try {
    actual[name] = scrape(file, url);
  } catch (e) {
    actual[name] = { error: e.message };
  }
  if (record) continue;
  try {
    assert.deepStrictEqual(actual[name], expected[name]);
    console.log(`  ${name}: ok`);
  } catch (e) {
    failed++;
    console.log(`x ${name}: changed\n    expected ${JSON.stringify(expected[name])}\n    actual   ${JSON.stringify(actual[name])}`);
  }
}
if (record) {
  fs.writeFileSync(expectedFile, JSON.stringify(actual, null, 2) + '\n');
  console.log(`recorded ${Object.keys(actual).length} stores; review: git diff tests/scrape.expected.json`);
} else if (failed) {
  console.log(`${failed} STORE(S) CHANGED`);
  process.exit(1);
} else {
  console.log('ALL SCRAPE CHECKS PASSED');
}
