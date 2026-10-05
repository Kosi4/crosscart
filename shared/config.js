window.Crosscart = window.Crosscart || {};

// The one place the web app's address lives. Development uses the local server; the
// release build (`node scripts/release.js`) swaps in PROD_WEB_ORIGIN everywhere, including
// manifest.json, and refuses to build while it's still the placeholder.
window.Crosscart.DEV_WEB_ORIGIN = 'http://localhost:55983';
window.Crosscart.PROD_WEB_ORIGIN = 'https://DOMAIN-NOT-SET.invalid'; // set when the domain is bought
window.Crosscart.WEB_ORIGIN = window.Crosscart.DEV_WEB_ORIGIN;
window.Crosscart.WEB_APP_URL = `${window.Crosscart.WEB_ORIGIN}/web/`;
