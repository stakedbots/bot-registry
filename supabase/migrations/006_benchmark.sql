-- 006: HODL benchmark value alongside the existing vs_benchmark_pct.
--
-- benchmark_usd = what the bot's deposits would be worth today if each one
-- had been held 50/50 cbBTC/WETH from the moment it arrived (prices via
-- DefiLlama historical). vs_benchmark_pct = (equity − benchmark) / benchmark.
-- Computed by indexer/src/stats.js; ERC20 perimeter (native ETH excluded),
-- same as the PnL columns from 005.

alter table bot_registry.bot_stats
  add column if not exists benchmark_usd numeric(20, 6);
