// Builds the store zip from a throwaway copy with a test domain and checks nothing points at localhost.
// Usage: node tests/release.check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crosscart-release-'));
for (const entry of ['manifest.json', 'background', 'content', 'shared', 'popup', 'icons', 'fonts', 'scripts']) {
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
const config = path.join(tmp, 'shared/config.js');
fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('https://DOMAIN-NOT-SET.invalid', 'https://crosscart.example'));

execFileSync('node', [path.join(tmp, 'scripts/release.js')], { stdio: 'pipe' });
const out = path.join(tmp, 'dist/extension');
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
assert.ok(manifest.content_scripts.some((c) => c.matches.includes('https://crosscart.example/web/*')));
assert.ok(fs.readFileSync(path.join(out, 'shared/config.js'), 'utf8').includes('WEB_ORIGIN = window.Crosscart.PROD_WEB_ORIGIN'));
assert.ok(fs.existsSync(path.join(tmp, `dist/crosscart-${manifest.version}.zip`)));
assert.ok(!fs.existsSync(path.join(out, 'tests')) && !fs.existsSync(path.join(out, 'web')));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('release: ok');
