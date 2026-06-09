-- Bot Reputation Registry — initial schema
-- Schema: bot_registry (isolated from public/trading/bloxyberry on the shared self-hosted Supabase)
--
-- Source of truth = on-chain contract events. Tables below mirror those events
-- so anyone can recompute stats from the chain and challenge the indexer's view.

create schema if not exists bot_registry;

-- ---------------------------------------------------------------------------
-- bots: one row per registered bot. bot_id matches the on-chain Registry.sol id.
-- ---------------------------------------------------------------------------
create table bot_registry.bots (
  bot_id              bigint primary key,                  -- on-chain id from Registry.sol
  operator_address    text not null,                       -- EOA that owns/controls the bot
  manifest_uri        text not null,                       -- IPFS/Arweave URI for the full manifest
  manifest_hash       bytea not null,                      -- keccak256 of the canonical manifest content
  name                text,                                -- denormalized from manifest for filtering
  strategy_summary    text,                                -- short description from manifest
  benchmark_declared  text,                                -- e.g. "HODL 50/50 USDC/cbBTC"
  chain               text not null default 'base',
  stake_amount_raw    numeric(78, 0) not null default 0,   -- USDC stake at 6 decimals
  status              text not null default 'active'
                       check (status in ('active', 'slashed', 'withdrawn', 'paused')),
  registered_at       timestamptz not null,
  registered_block    bigint not null,
  registered_tx       text not null,
  updated_at          timestamptz not null default now()
);

create index bots_operator_idx on bot_registry.bots (operator_address);
create index bots_status_idx on bot_registry.bots (status);
create index bots_chain_idx on bot_registry.bots (chain);

-- ---------------------------------------------------------------------------
-- bot_wallets: a bot can declare multiple trading wallets. unique across all bots.
-- ---------------------------------------------------------------------------
create table bot_registry.bot_wallets (
  bot_id          bigint not null references bot_registry.bots(bot_id) on delete cascade,
  wallet_address  text not null,
  chain           text not null default 'base',
  linked_at       timestamptz not null,
  linked_block    bigint not null,
  linked_tx       text not null,
  unlinked_at     timestamptz,
  unlinked_tx     text,
  primary key (chain, wallet_address)
);

create index bot_wallets_bot_idx on bot_registry.bot_wallets (bot_id) where unlinked_at is null;

-- ---------------------------------------------------------------------------
-- missions: each epoch the bot commits to a strategy BEFORE acting.
-- This is the anti-narrative-rewrite primitive: you can't claim post-hoc that
-- your strategy was X if the timestamped commitment says Y.
-- ---------------------------------------------------------------------------
create table bot_registry.missions (
  id                bigserial primary key,
  bot_id            bigint not null references bot_registry.bots(bot_id),
  epoch_id          text not null,                          -- e.g. "2026-06-08" or block-derived
  benchmark         text not null,                          -- benchmark declared for THIS epoch
  strategy_hash     bytea not null,                         -- keccak256 of strategy descriptor
  manifest_uri      text not null,                          -- IPFS URI for detailed mission JSON
  attestation_uid   text,                                    -- EAS attestation UID if used
  attested_at       timestamptz not null,
  attested_block    bigint not null,
  attested_tx       text not null,
  created_at        timestamptz not null default now(),
  unique (bot_id, epoch_id)
);

create index missions_bot_idx on bot_registry.missions (bot_id, attested_at desc);

-- ---------------------------------------------------------------------------
-- trades: normalized swap events from linked wallets. Source: chain logs.
-- ---------------------------------------------------------------------------
create table bot_registry.trades (
  id                bigserial primary key,
  bot_id            bigint not null references bot_registry.bots(bot_id),
  wallet_address    text not null,
  chain             text not null default 'base',
  block_number      bigint not null,
  block_timestamp   timestamptz not null,
  tx_hash           text not null,
  log_index         int not null,
  protocol          text,                                    -- 'uniswap_v3' | 'aerodrome' | ...
  token_in          text not null,
  token_out         text not null,
  amount_in_raw     numeric(78, 0) not null,
  amount_out_raw    numeric(78, 0) not null,
  amount_in_usd     numeric(20, 6),
  amount_out_usd    numeric(20, 6),
  realized_pnl_usd  numeric(20, 6),                          -- against running cost basis
  unique (chain, tx_hash, log_index)
);

create index trades_bot_time_idx on bot_registry.trades (bot_id, block_timestamp desc);
create index trades_wallet_idx on bot_registry.trades (wallet_address, block_timestamp desc);

-- ---------------------------------------------------------------------------
-- epoch_performance: rolling per-bot per-epoch performance. The committed
-- merkle_root lets clients verify off-chain stats against an on-chain anchor.
-- ---------------------------------------------------------------------------
create table bot_registry.epoch_performance (
  bot_id                bigint not null references bot_registry.bots(bot_id),
  epoch_id              text not null,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  starting_nav_usd      numeric(20, 6) not null,
  ending_nav_usd        numeric(20, 6) not null,
  pnl_abs_usd           numeric(20, 6) not null,
  pnl_pct               numeric(12, 8) not null,
  benchmark_pnl_pct     numeric(12, 8),
  alpha_pct             numeric(12, 8),                       -- pnl_pct - benchmark_pnl_pct
  trades_count          int not null default 0,
  max_drawdown_pct      numeric(12, 8),
  mission_followed      boolean,                              -- did declared strategy match actions
  merkle_root           bytea,
  committed_at          timestamptz,
  committed_tx          text,
  created_at            timestamptz not null default now(),
  primary key (bot_id, epoch_id)
);

create index epoch_perf_time_idx on bot_registry.epoch_performance (bot_id, ends_at desc);

-- ---------------------------------------------------------------------------
-- bot_stats: cached aggregate stats for fast leaderboard reads. Rebuilt by
-- indexer on each epoch close. Treat as derived state, not source of truth.
-- ---------------------------------------------------------------------------
create table bot_registry.bot_stats (
  bot_id                bigint primary key references bot_registry.bots(bot_id),
  total_days_active     int not null default 0,
  total_trades          int not null default 0,
  total_pnl_usd         numeric(20, 6) not null default 0,
  total_pnl_pct         numeric(12, 8),
  vs_benchmark_pct      numeric(12, 8),                       -- cumulative alpha
  win_rate              numeric(5, 4),                         -- 0..1
  sharpe                numeric(10, 4),
  max_drawdown_pct      numeric(12, 8),
  consistency_score     numeric(5, 4),                         -- missions kept / missions signed
  last_epoch_id         text,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- challenges: fraud claims. Anyone stakes USDC to accuse a bot.
-- ---------------------------------------------------------------------------
create table bot_registry.challenges (
  challenge_id        bigint primary key,                     -- on-chain id
  bot_id              bigint not null references bot_registry.bots(bot_id),
  challenger_address  text not null,
  challenger_stake    numeric(78, 0) not null,
  reason              text not null
                       check (reason in (
                         'wash_trade', 'hidden_wallet', 'mission_violation',
                         'manifest_mismatch', 'fake_volume', 'other'
                       )),
  evidence_uri        text,
  status              text not null default 'open'
                       check (status in ('open', 'upheld', 'rejected', 'withdrawn')),
  resolution_notes    text,
  resolved_at         timestamptz,
  resolved_tx         text,
  created_at          timestamptz not null,
  created_block       bigint not null,
  created_tx          text not null
);

create index challenges_bot_idx on bot_registry.challenges (bot_id);
create index challenges_status_idx on bot_registry.challenges (status);

-- ---------------------------------------------------------------------------
-- contract_events: raw log of every event from Registry.sol. Auditability +
-- replay. The indexer writes here first, then derives the tables above.
-- ---------------------------------------------------------------------------
create table bot_registry.contract_events (
  id                bigserial primary key,
  chain             text not null,
  contract_address  text not null,
  block_number      bigint not null,
  block_timestamp   timestamptz not null,
  tx_hash           text not null,
  log_index         int not null,
  event_name        text not null,
  event_data        jsonb not null,
  processed_at      timestamptz,
  unique (chain, tx_hash, log_index)
);

create index contract_events_unprocessed_idx
  on bot_registry.contract_events (block_number, log_index)
  where processed_at is null;

create index contract_events_name_idx on bot_registry.contract_events (event_name);

-- ---------------------------------------------------------------------------
-- indexer_cursors: per-stream block cursors so we can resume cleanly.
-- ---------------------------------------------------------------------------
create table bot_registry.indexer_cursors (
  name              text primary key,                         -- e.g. 'base_registry_v1' | 'base_uniswap_v3_trades'
  chain             text not null,
  last_block        bigint not null default 0,
  last_processed_at timestamptz,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function bot_registry.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger bots_touch       before update on bot_registry.bots       for each row execute procedure bot_registry.touch_updated_at();
create trigger bot_stats_touch  before update on bot_registry.bot_stats  for each row execute procedure bot_registry.touch_updated_at();
create trigger cursors_touch    before update on bot_registry.indexer_cursors for each row execute procedure bot_registry.touch_updated_at();
