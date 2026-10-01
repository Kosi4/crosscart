-- CrossCart Plus: the plan lives on the profile.
-- Only CrossCart's billing (the service role, e.g. a Stripe webhook) may change it.
-- The existing "own profile: update" policy lets a signed-in user update their own
-- row, so without the column grants below anyone could give themselves Plus.

alter table public.profiles
  add column plan text not null default 'free' check (plan in ('free', 'plus')),
  add column plan_renews_at timestamptz;

-- Users keep updating their own settings, but no longer plan or plan_renews_at.
revoke update on public.profiles from anon, authenticated;
grant update (preferred_currency, theme, country) on public.profiles to authenticated;
