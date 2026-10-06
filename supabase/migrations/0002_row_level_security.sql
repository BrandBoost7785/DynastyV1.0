-- Dynasty — row level security (Supabase)
--
-- Defence in depth. The application only ever reaches the database through server
-- route handlers using a privileged connection, so these policies are the second
-- lock: if the publishable key is ever used directly from a browser, a player can
-- still only see their own rows.
--
-- Deliberately restrictive defaults:
--   • `sessions` and `action_audit` inserts are server-only. A client that could
--     write its own session or edit the audit trail would own the game.
--   • Every policy compares against `auth.uid()`, so identity comes from the token,
--     never from a request body.
--
-- This migration is Supabase-specific (`auth.uid()`); the base schema in 0001 is
-- portable to any PostgreSQL instance.

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.games enable row level security;
alter table public.game_versions enable row level security;
alter table public.action_audit enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: you may read and edit your own profile only
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid()::text);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()::text)
  with check (id = auth.uid()::text);

-- No insert policy: accounts are created by the server (signup flow), which
-- connects with privileges that bypass RLS. A browser cannot mint a profile.

-- ---------------------------------------------------------------------------
-- sessions: server-only, no client access at all
-- ---------------------------------------------------------------------------
-- Enabled with no policies, which denies every client operation.

-- ---------------------------------------------------------------------------
-- games: full control of your own saves, nothing else
-- ---------------------------------------------------------------------------
drop policy if exists games_select_own on public.games;
create policy games_select_own on public.games
  for select to authenticated
  using (user_id = auth.uid()::text);

drop policy if exists games_insert_own on public.games;
create policy games_insert_own on public.games
  for insert to authenticated
  with check (user_id = auth.uid()::text);

drop policy if exists games_update_own on public.games;
create policy games_update_own on public.games
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

drop policy if exists games_delete_own on public.games;
create policy games_delete_own on public.games
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- game_versions: readable through the parent save, never writable
-- ---------------------------------------------------------------------------
drop policy if exists game_versions_select_own on public.game_versions;
create policy game_versions_select_own on public.game_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.games g
      where g.game_id = game_versions.game_id
        and g.user_id = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------------
-- action_audit: readable for your own games, insert is server-only
-- ---------------------------------------------------------------------------
drop policy if exists action_audit_select_own on public.action_audit;
create policy action_audit_select_own on public.action_audit
  for select to authenticated
  using (user_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------
-- The public leaderboard is served by the API from `games` metadata columns, so no
-- anonymous read policy is needed here: the server aggregates and publishes only
-- the display name, title, level, net worth and score.
