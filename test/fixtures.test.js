// One test per page in test/fixtures/. Each page is a pair:
//
//   some-page.html   the saved page (or a trimmed copy of it)
//   some-page.json   where it lives and what the scraper should get from it
//
// See test/README.md for how to add one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./load-page');

const FIXTURES = path.join(__dirname, 'fixtures');

const names = fs
  .readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length));

for (const name of names) {
  const spec = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
  const html = fs.readFileSync(path.join(FIXTURES, `${name}.html`), 'utf8');

  // "todo" marks a known bug: the test still runs and reports, but doesn't
  // fail the suite until someone fixes it and deletes the line.
  test(`${name}: ${spec.about || ''}`.trim(), { todo: spec.todo }, () => {
    const window = loadPage(html, spec.url);

    if ('isProductPage' in spec) {
      assert.equal(
        window.Crosscart.detect.isProductPage(),
        spec.isProductPage,
        'isProductPage()'
      );
    }

    if (spec.expect) {
      const item = window.Crosscart.scrape.scrapeProduct();
      for (const [field, want] of Object.entries(spec.expect)) {
        assert.equal(item[field], want, `scraped ${field}`);
      }
    }
  });
}
