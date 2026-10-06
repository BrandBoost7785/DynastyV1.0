-- Dynasty — initial schema
--
-- Production persistence target: PostgreSQL (Supabase). Applied by
-- `npm run db:migrate` and by the Supabase migration pipeline.
--
-- Shape of the data model:
--   • Identity, sessions, save metadata, version history and audit are fully
--     normalized relational tables with foreign keys and indexes.
--   • The simulation state itself is a versioned JSONB document sealed with an
--     integrity hash, alongside extracted columns for everything the server
--     queries (day, net worth, level, score, status). A live 25-system simulation
--     graph is not a set of flat tables, and pretending otherwise would turn every
--     balance change into a schema migration; but it does need queryable structure,
--     which the extracted columns provide.
--   • Writes are conflict-safe: `games.version` is monotonic and the application
--     layer performs a compare-and-set against the version the client read.

create table if not exists public.schema_migrations (
  id          text primary key,
  applied_at  timestamptz not null default now(),
  checksum    text not null
);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
-- In production Supabase Auth owns credentials and `profiles.id` is the auth
-- user's uuid. `password_hash` exists only for the local development
-- authenticator and stays null for every Supabase-authenticated account.
create table if not exists public.profiles (
  id            text primary key,
  email         text not null unique,
  display_name  text not null,
  auth_provider text not null default 'supabase' check (auth_provider in ('local', 'supabase')),
  password_hash text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc nulls last);

-- Server-issued sessions for the development authenticator. Supabase sessions
-- live in Supabase's own schema; this table is unused when auth_provider is
-- 'supabase' but is kept in the same migration so both modes share one schema.
create table if not exists public.sessions (
  id          text primary key,
  user_id     text not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  user_agent  text
);

create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists sessions_expiry_idx on public.sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Saves
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  game_id        text primary key,
  user_id        text not null references public.profiles (id) on delete cascade,
  name           text not null,
  status         text not null default 'active',
  schema_version integer not null,
  version        integer not null default 0,
  day            integer not null default 0,
  turn           integer not null default 0,
  level          integer not null default 1,
  title          text not null default '',
  net_worth      numeric(20, 2) not null default 0,
  empire_score   numeric(20, 2) not null default 0,
  world_seed     text not null,
  difficulty     text not null default 'standard',
  location_id    text not null,
  incarcerated   boolean not null default false,
  ending_kind    text,
  state          jsonb not null,
  integrity_hash text not null,
  size_bytes     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- A save is only ever written by the compare-and-set in the application layer,
  -- but the database enforces the invariants that make it safe as well.
  constraint games_version_non_negative check (version >= 0),
  constraint games_day_non_negative check (day >= 0),
  constraint games_size_within_ceiling check (size_bytes >= 0 and size_bytes <= 12000000)
);

create index if not exists games_user_updated_idx on public.games (user_id, updated_at desc);
create index if not exists games_user_status_idx on public.games (user_id, status);
-- Leaderboard: the top empires, without touching a single state document.
create index if not exists games_leaderboard_idx on public.games (empire_score desc, net_worth desc);
create index if not exists games_net_worth_idx on public.games (net_worth desc);

-- ---------------------------------------------------------------------------
-- Version history (cloud saves with rollback)
-- ---------------------------------------------------------------------------
create table if not exists public.game_versions (
  game_id        text not null references public.games (game_id) on delete cascade,
  version        integer not null,
  day            integer not null,
  net_worth      numeric(20, 2) not null default 0,
  empire_score   numeric(20, 2) not null default 0,
  state          jsonb not null,
  integrity_hash text not null,
  size_bytes     integer not null default 0,
  reason         text,
  saved_at       timestamptz not null default now(),
  primary key (game_id, version)
);

create index if not exists game_versions_saved_idx on public.game_versions (game_id, saved_at desc);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.action_audit (
  id          bigserial primary key,
  user_id     text references public.profiles (id) on delete set null,
  game_id     text,
  action      text not null,
  ok          boolean not null,
  code        text,
  day         integer not null default 0,
  turn        integer not null default 0,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists action_audit_user_idx on public.action_audit (user_id, created_at desc);
create index if not exists action_audit_game_idx on public.action_audit (game_id, created_at desc);
create index if not exists action_audit_action_idx on public.action_audit (action, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists games_touch_updated_at on public.games;
create trigger games_touch_updated_at
  before update on public.games
  for each row execute function public.touch_updated_at();
