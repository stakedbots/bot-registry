-- api_revenue: USDC received by the API's PAY_TO address(es) from x402 payments.
-- Each row is one inbound USDC Transfer to a watched receiving address. The
-- endpoint is inferred from the amount (the x402 price list); the payer is
-- classified as 'self' (our own treasury/deployer/bots paying for keep-alive or
-- testing) vs 'external' (real third-party agents — the demand signal we care
-- about).

create table if not exists bot_registry.api_revenue (
  id                bigserial primary key,
  chain             text   not null default 'base',
  pay_to            text   not null,                 -- which receiving address got paid
  from_address      text   not null,                 -- the payer (x402 EIP-3009 `from`)
  token_address     text   not null,
  amount_raw        numeric(78, 0) not null,
  amount_usdc       numeric not null,                -- amount_raw / 1e6, for convenience
  endpoint          text,                            -- inferred: 'events' | 'detail' | null
  classification    text   not null check (classification in ('self', 'external')),
  block_number      bigint not null,
  block_timestamp   timestamptz not null,
  tx_hash           text not null,
  log_index         int  not null,
  unique (chain, tx_hash, log_index)
);

create index if not exists api_revenue_time_idx
  on bot_registry.api_revenue (block_timestamp desc);
create index if not exists api_revenue_class_idx
  on bot_registry.api_revenue (classification, block_timestamp desc);

grant select on bot_registry.api_revenue to anon, authenticated, service_role;

-- Aggregate view: revenue split by classification, plus external payer count.
create or replace view bot_registry.api_revenue_summary as
select
  classification,
  count(*)                         as payments,
  count(distinct from_address)     as distinct_payers,
  sum(amount_usdc)                 as total_usdc,
  max(block_timestamp)             as last_payment_at
from bot_registry.api_revenue
group by classification;

grant select on bot_registry.api_revenue_summary to anon, authenticated, service_role;
