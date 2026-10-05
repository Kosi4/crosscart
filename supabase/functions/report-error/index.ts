// Error-report tunnel: the web app, popup and service worker post Sentry envelopes here and this
// forwards them to Sentry. Ad-blockers block sentry.io directly, which would hide most errors.
// It only forwards to CrossCart's own Sentry project, so it can't be used as an open relay.
const SENTRY_HOST = 'o4511999091736576.ingest.de.sentry.io';
const SENTRY_PROJECT = '4512205002834000';
const SENTRY_KEY = '651821ef4c85d9fb5c42fec7f0b3ff9b';
const MAX_BYTES = 64 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!body || body.length > MAX_BYTES) return new Response('Bad size', { status: 413, headers: corsHeaders });

  const res = await fetch(
    `https://${SENTRY_HOST}/api/${SENTRY_PROJECT}/envelope/?sentry_key=${SENTRY_KEY}&sentry_version=7`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-sentry-envelope' } }
  );
  return new Response(null, { status: res.ok ? 204 : 502, headers: corsHeaders });
});
