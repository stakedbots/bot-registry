-- 005: mark-to-market equity + net flows on bot_stats.
--
-- PnL derivation (computed by indexer/src/stats.js after each pass):
--   equity_usd     = current ERC20 holdings of linked wallets (priced now)
--                    + stake locked in the Registry (USDC, $1)
--   net_flows_usd  = Σ amount_usd(in) − Σ amount_usd(out) over wallet_transfers,
--                    excluding legs whose counterparty is the Registry itself
--   total_pnl_usd  = equity_usd − net_flows_usd
--
-- Native ETH is deliberately excluded on both sides (gas tank, not capital:
-- ETH deposits aren't ERC20 Transfer events so they never enter net_flows).
-- Registry legs are excluded from flows because the stake already lives in
-- equity — counting the stake-out as an outflow too would fabricate +stake of
-- phantom PnL. Staking/withdrawing is PnL-neutral; slashing is a loss.

alter table bot_registry.bot_stats
  add column if not exists equity_usd    numeric(20, 6),
  add column if not exists net_flows_usd numeric(20, 6);
