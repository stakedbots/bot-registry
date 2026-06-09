-- wallet_transfers: raw ERC20 Transfer events for every wallet linked to a bot.
-- One row per (chain, tx_hash, log_index, direction) — both sides of a swap end
-- up as two rows ("in" + "out") for the same tx, which makes pairing trivial.

create table if not exists bot_registry.wallet_transfers (
  id                bigserial primary key,
  bot_id            bigint not null references bot_registry.bots(bot_id),
  wallet_address    text   not null,
  chain             text   not null default 'base',
  token_address     text   not null,
  -- 'in'  = wallet RECEIVED the token (it's `to` in the Transfer event)
  -- 'out' = wallet SENT the token     (it's `from` in the Transfer event)
  direction         text   not null check (direction in ('in', 'out')),
  amount_raw        numeric(78, 0) not null,
  counterparty      text,                       -- the other side of the transfer
  block_number      bigint not null,
  block_timestamp   timestamptz not null,
  tx_hash           text not null,
  log_index         int  not null,
  unique (chain, tx_hash, log_index, direction)
);

create index if not exists wallet_transfers_bot_time_idx
  on bot_registry.wallet_transfers (bot_id, block_timestamp desc);
create index if not exists wallet_transfers_wallet_idx
  on bot_registry.wallet_transfers (chain, wallet_address, block_timestamp desc);

-- Grant read access consistent with the other tables in this schema.
grant select on bot_registry.wallet_transfers to anon, authenticated, service_role;
