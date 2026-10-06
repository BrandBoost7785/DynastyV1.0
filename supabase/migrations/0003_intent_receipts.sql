-- Dynasty — idempotent command receipts
--
-- Why this table exists
-- ---------------------
-- A browser retries: double clicks, reconnects, and responses that time out after
-- the server already committed the write. Without a receipt, a retry of
-- `trade.buy` buys the goods twice.
--
-- The primary key is (game_id, request_id), where `request_id` is the client's
-- idempotency key. Before dispatching a state-changing command the service looks
-- for a receipt:
--
--   • absent   → execute normally, then record the receipt with the sanitised result
--   • present  → return the recorded result and DO NOT touch the simulation again
--
-- `intent_hash` detects a key reused for a different payload, which is rejected
-- rather than replayed. `state_version` records the save version the command
-- produced, so a receipt can be correlated with the compare-and-set write that
-- created it.
--
-- Deliberately a sibling of `games` rather than a column inside it: the JSONB save
-- document stays free of transport concerns, and the compare-and-set on
-- `games.version` remains the single concurrency primitive. Receipts are pruned by
-- the application to a bounded number per game; they are an operational table, not
-- a permanent ledger (that is what `action_audit` is for).
create table if not exists public.intent_receipts (
  game_id      text not null,
  user_id      text not null references public.profiles (id) on delete cascade,
  request_id   text not null,
  intent_type  text not null,
  intent_hash  text not null,
  state_version integer,
  day          integer not null default 0,
  turn         integer not null default 0,
  response     text not null,
  created_at   timestamptz not null default now(),
  primary key (game_id, request_id),
  constraint intent_receipts_request_id_length check (char_length(request_id) between 1 and 128),
  constraint intent_receipts_response_size check (octet_length(response) <= 1048576)
);

create index if not exists intent_receipts_prune_idx on public.intent_receipts (game_id, created_at desc);

-- Defence in depth, following 0002: receipts are written and read only by the
-- server's privileged connection. No policy is created, so the publishable key
-- cannot read or forge a receipt even if it is used directly from a browser.
alter table public.intent_receipts enable row level security;
