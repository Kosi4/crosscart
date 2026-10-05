// Mints a single-use sign-in token so the extension can open its OWN session for the signed-in
// user. Sharing the web app's session instead would break: Supabase refresh tokens are single-use,
// and two clients refreshing the same one looks like token theft and revokes the session.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await asUser.auth.getUser();
  if (userError || !user || !user.email) return json({ error: 'Not signed in' }, 401);

  // generateLink creates the token without sending any email.
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  if (error || !data?.properties?.hashed_token) return json({ error: 'Could not create a sign-in token' }, 500);

  return json({ token_hash: data.properties.hashed_token, user_id: user.id });
});
