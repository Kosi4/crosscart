// Builds the Chrome Web Store zip: dist/crosscart-<version>.zip
// Usage: node scripts/release.js
// Takes only the extension's own folders, points everything at PROD_WEB_ORIGIN from
// shared/config.js (manifest.json can't read that file, so it's rewritten here), and refuses to
// build while the domain is still the placeholder or anything still mentions localhost.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'extension');
const SHIPPED = ['manifest.json', 'background', 'content', 'shared', 'popup', 'icons', 'fonts'];

const config = fs.readFileSync(path.join(ROOT, 'shared/config.js'), 'utf8');
const prod = (config.match(/PROD_WEB_ORIGIN = '([^']+)'/) || [])[1];
const dev = (config.match(/DEV_WEB_ORIGIN = '([^']+)'/) || [])[1];
if (!prod || /DOMAIN-NOT-SET/.test(prod)) {
  console.error('Set PROD_WEB_ORIGIN in shared/config.js to the real domain first.');
  process.exit(1);
}
if (!/^https:\/\/[^/]+$/.test(prod)) {
  console.error(`PROD_WEB_ORIGIN must be https://host with no path or trailing slash, got ${prod}`);
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const entry of SHIPPED) fs.cpSync(path.join(ROOT, entry), path.join(STAGE, entry), { recursive: true });

// The shipped extension talks to the production web app, and doesn't even contain the dev address.
const configOut = path.join(STAGE, 'shared/config.js');
fs.writeFileSync(
  configOut,
  fs
    .readFileSync(configOut, 'utf8')
    .replace(/DEV_WEB_ORIGIN = '[^']+'/, "DEV_WEB_ORIGIN = ''")
    .replace('WEB_ORIGIN = window.Crosscart.DEV_WEB_ORIGIN;', 'WEB_ORIGIN = window.Crosscart.PROD_WEB_ORIGIN;')
);

// Bridge and exclusion patterns: the web app's pages on the production origin, never localhost.
const manifestPath = path.join(STAGE, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const devPattern = `${new URL(dev).protocol}//${new URL(dev).hostname}/web/*`;
const prodPattern = `${prod}/web/*`;
for (const script of manifest.content_scripts) {
  for (const key of ['matches', 'exclude_matches']) {
    if (script[key]) script[key] = script[key].map((m) => (m === devPattern ? prodPattern : m));
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Nothing shipped may still trust or point at the development server.
const problems = [];
(function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (name.startsWith('_')) problems.push(`${path.relative(STAGE, file)}: Chrome rejects names starting with "_"`);
    if (fs.statSync(file).isDirectory()) scan(file);
    else if (/\.(js|json|html|css)$/.test(name) && /localhost|127\.0\.0\.1/.test(fs.readFileSync(file, 'utf8'))) {
      problems.push(`${path.relative(STAGE, file)}: still mentions localhost`);
    }
  }
})(STAGE);
if (problems.length) {
  console.error(`Not building:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const zip = path.join(DIST, `crosscart-${manifest.version}.zip`);
execFileSync('zip', ['-qr', zip, '.'], { cwd: STAGE });
console.log(`Built ${path.relative(ROOT, zip)} for ${prod}`);
console.log(`Also set in Supabase → Authentication → URL Configuration: Site URL ${prod}/web/ and redirect URL ${prod}/web/**`);
