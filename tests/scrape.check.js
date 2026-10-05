// Runs the real content scripts against saved pages in tests/fixtures/ and
// checks what the scraper and product-page detector get from each one.
// Usage: node tests/scrape.check.js   (needs `npm install` once, for jsdom)
//
// Each page is a pair: some-page.html (the saved page) and some-page.json
// (its URL and the expected result). See tests/README.md to add one.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = `${__dirname}/fixtures`;

// Same order as manifest.json, minus the files that need chrome.* APIs or
// draw UI (storage, lists, nav-watch, picker, content).
const SCRIPTS = [
  'shared/constants.js',
  'shared/currency.js',
  'content/detect.js',
  'content/agent-sites.js',
  'content/scrape.js',
].map((file) => fs.readFileSync(`${ROOT}/${file}`, 'utf8'));

function loadPage(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  for (const source of SCRIPTS) dom.window.eval(source);
  return dom.window;
}

function check(spec, html) {
  const window = loadPage(html, spec.url);
  if ('isProductPage' in spec) {
    assert.strictEqual(window.Crosscart.detect.isProductPage(), spec.isProductPage, 'isProductPage()');
  }
  if (spec.expect) {
    const item = window.Crosscart.scrape.scrapeProduct();
    for (const [field, want] of Object.entries(spec.expect)) {
      assert.strictEqual(item[field], want, `scraped ${field}`);
    }
  }
}

let failed = 0;
const names = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
for (const name of names) {
  const spec = JSON.parse(fs.readFileSync(`${FIXTURES}/${name}.json`, 'utf8'));
  const html = fs.readFileSync(`${FIXTURES}/${name}.html`, 'utf8');
  try {
    check(spec, html);
    // A todo that passes means the bug got fixed: say so, so the line gets deleted.
    console.log(spec.todo ? `fixed?  ${name} passes now, delete its "todo"` : `ok      ${name}`);
  } catch (e) {
    if (spec.todo) {
      console.log(`todo    ${name}: ${spec.todo}`);
    } else {
      failed++;
      console.log(`FAIL    ${name}: ${spec.about || ''}\n        ${e.message.split('\n').join('\n        ')}`);
    }
  }
}

if (failed) {
  console.log(`\n${failed} of ${names.length} pages failed`);
  process.exit(1);
}
console.log(`scrape: ok (${names.length} pages)`);
