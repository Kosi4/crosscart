window.Crosscart = window.Crosscart || {};

// Sends uncaught errors to Sentry (through supabase/functions/report-error) without its SDK (MV3 extensions can't load remote code, and
// the whole job is ~one request). Loaded only on CrossCart's own pages (web app, popup, service
// worker), never on store pages, so other websites' errors can't leak in. Page addresses are
// sent without query strings or #fragments, and no account details are attached.
// ponytail: no breadcrumbs/source maps; the Sentry SDK if we ever need them.
(function () {
  const C = window.Crosscart;
  const endpoint = C.ERROR_REPORT_URL;
  if (!endpoint) return;
  const MAX_PER_PAGE = 10;
  let sent = 0;

  const clean = (url) => String(url || '').replace(/[?#].*$/, '');

  function frames(stack) {
    return String(stack || '')
      .split('\n')
      .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
      .filter(Boolean)
      .map(([, fn, file, line, col]) => ({ function: fn || '?', filename: clean(file), lineno: +line, colno: +col }))
      .reverse(); // Sentry wants the oldest call first
  }

  function report(error, surface) {
    if (sent >= MAX_PER_PAGE) return;
    sent++;
    const err = error instanceof Error ? error : new Error(String(error && error.message ? error.message : error));
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const version = globalThis.chrome && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : 'web';
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      environment: C.WEB_ORIGIN === C.DEV_WEB_ORIGIN ? 'development' : 'production',
      release: `crosscart@${version}`,
      tags: { surface },
      request: { url: clean(globalThis.location && location.href) },
      exception: { values: [{ type: err.name || 'Error', value: String(err.message).slice(0, 500), stacktrace: { frames: frames(err.stack) } }] },
    };
    const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    try {
      fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => {});
    } catch (e) {}
  }

  function install(surface) {
    if (typeof globalThis.addEventListener !== 'function') return;
    globalThis.addEventListener('error', (e) => report(e.error || e.message, surface));
    globalThis.addEventListener('unhandledrejection', (e) => report(e.reason, surface));
  }

  C.monitor = { install, report };
})();
