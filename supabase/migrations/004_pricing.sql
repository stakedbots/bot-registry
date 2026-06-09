-- Pricing: per-token decimals + per-transfer USD value at time of trade.
-- Source for prices = DefiLlama historical API (free). Decimals are fetched
-- on-chain once and cached in bot_registry.tokens.

create table if not exists bot_registry.tokens (
  chain      text not null,
  address    text not null,
  decimals   smallint not null,
  symbol     text,
  name       text,
  updated_at timestamptz not null default now(),
  primary key (chain, address)
);

grant select on bot_registry.tokens to anon, authenticated, service_role;

alter table bot_registry.wallet_transfers
  add column if not exists amount_usd numeric(20, 6),
  add column if not exists token_decimals smallint,
  add column if not exists token_symbol text;

create index if not exists wallet_transfers_bot_usd_idx
  on bot_registry.wallet_transfers (bot_id, block_timestamp desc)
  where amount_usd is not null;
