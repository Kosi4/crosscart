# Scraper tests

These check that the scraper pulls the right title, price, currency and image out of real-looking product pages, and that the product-page detector says yes/no on the right pages.

## Running them

Once, to install the fake browser the tests use (jsdom):

```
npm install
```

Then any time:

```
npm test
```

That runs every `tests/*.check.js` (lists, pricing, sync and this one). To run just the scraper: `node tests/scrape.check.js`.

`ok` means that page scraped the way its `.json` says. `FAIL` prints which field was wrong, what it expected and what it actually got. `todo` lines are known bugs (see below) and don't count as failures.

## How it works

Every scraper check is a pair of files in `tests/fixtures/` with the same name:

- `some-page.html` is the page. A trimmed copy is fine, as long as it still has the bits that matter (the JSON-LD, the price markup, the meta tags).
- `some-page.json` says where the page lives and what the scraper should get from it.

`scrape.check.js` loops over every `.json`, opens the matching `.html` in jsdom at that URL, runs the real `content/` scripts on it (the same ones `manifest.json` injects), then compares. There's no list to update: drop a new pair in and it runs.

## Adding a page

Say a store saves the wrong price.

1. Open the product page in Chrome, right-click, **View page source**, and save it as `tests/fixtures/storename-what-broke.html`. (View source gives the HTML the server sent. If the price only shows up after JavaScript runs, use DevTools instead: Elements panel, right-click `<html>`, Copy, Copy outerHTML.)
2. Optional but nice: delete the huge chunks that don't matter (inline scripts, svg icons, the footer) so the file is readable. Run the test after trimming to make sure it still breaks the same way.
3. Make `tests/fixtures/storename-what-broke.json`:

   ```json
   {
     "about": "one line on what this page checks",
     "url": "https://the-real-store.com/products/the-thing",
     "isProductPage": true,
     "expect": {
       "title": "The Thing",
       "price": "985.00",
       "currency": "ZAR"
     }
   }
   ```

   - `url` matters: currency guessing (`.co.za` means ZAR) and site-name stripping both read the domain.
   - Only list the fields you care about. Anything left out of `expect` isn't checked.
   - `price` is a string with a `.` decimal, the way the scraper stores it: `"1499.95"`, not `1499.95` or `"R 1 499,95"`.
   - Leave out `expect` entirely for pages that only test detection (like a blog post that should get no button).

4. `npm test`. It should fail, which proves the test catches the bug. Fix the scraper until it passes.

## Known bugs (`todo`)

If you find a bug but aren't fixing it yet, add `"todo": "what's wrong"` to the `.json`. The check still runs and prints it as `todo`, but doesn't fail. Once the bug is fixed it prints `fixed?` instead, telling you to delete the line. Right now `not-product-category` is one of these: any page with an "Add to cart" button counts as a product page, so category grids get the save button too.
