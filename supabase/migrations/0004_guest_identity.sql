-- Dynasty — guest identities
--
-- A guest is a server-issued, anonymous player: a profile with no email and no password,
-- whose only credential is the HttpOnly session cookie the server sets. It can be created
-- from the landing screen with no sign-up, and it is not recoverable from another device,
-- because nothing about it is addressable.
--
-- Two changes, both additive; no existing row is rewritten:
--   1. `profiles.email` may be null. The UNIQUE constraint stays, and PostgreSQL treats each
--      NULL as distinct, so every real address is still unique.
--   2. `auth_provider` accepts 'guest'. The existing values are kept, so older rows and the
--      migration history stay valid.
--
-- Account tables and earlier migrations are not removed or altered in any other way.

alter table public.profiles alter column email drop not null;

alter table public.profiles drop constraint if exists profiles_auth_provider_check;
alter table public.profiles
  add constraint profiles_auth_provider_check check (auth_provider in ('local', 'supabase', 'guest'));
