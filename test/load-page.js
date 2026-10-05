// Loads a saved HTML page into a fake browser (jsdom) and runs the same
// content scripts the extension injects, so tests call the real scraper
// instead of a copy of it.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// Same order as manifest.json, minus the files that need chrome.* APIs or
// draw UI (storage, lists, nav-watch, picker, content).
const SCRIPTS = [
  'shared/constants.js',
  'shared/currency.js',
  'content/detect.js',
  'content/agent-sites.js',
  'content/scrape.js',
];

function loadPage(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  for (const file of SCRIPTS) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  return dom.window;
}

module.exports = { loadPage };
