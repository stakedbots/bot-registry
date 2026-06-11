/**
 * Per-bot derived stats — the "result" layer on top of raw chain truth.
 *
 * PnL is mark-to-market, derived entirely from indexed data + live chain reads:
 *
 *   equity_usd    = Σ (current ERC20 balance of linked wallets × price now)
 *                   + stake locked in the Registry (USDC)
 *   net_flows_usd = Σ amount_usd(in) − Σ amount_usd(out)   (wallet_transfers,
 *                   EXCLUDING legs whose counterparty is the Registry)
 *   pnl_usd       = equity_usd − net_flows_usd
 *   pnl_pct       = pnl_usd / net_flows_usd                 (null if flows ≤ 0)
 *
 * Registry legs must be excluded from flows because the stake stays in equity:
 * counting the stake-out as an outflow while also crediting the stake in
 * equity fabricates +stake of phantom PnL (deposit→stake nets to zero flows).
 * With the exclusion, staking and withdrawing are PnL-neutral and a slash is
 * a real loss (equity drops, flows unchanged).
 *
 * Native ETH is excluded on both sides: ETH deposits aren't ERC20 Transfers so
 * they never enter net_flows, and the gas tank isn't trading capital.
 * Swap legs (in+out within one tx) cancel each other, so net_flows reduces to
 * deposits − external spends — the bot's true cost basis.
 *
 * total_trades counts txs where the wallet had transfers in BOTH directions
 * (a swap), so plain deposits/withdrawals don't inflate it.
 *
 * Benchmark (alpha): each deposit (unpaired in-leg, non-Registry, priced) is
 * simulated as buying 50% cbBTC + 50% WETH at deposit-time prices — the same
 * "HODL 50/50 from T0, adjusted per capital injection" yardstick the house
 * bots attest in their missions, but derived from chain. benchmark_usd is
 * that phantom portfolio marked to market now; vs_benchmark_pct is the alpha.
 * Mainnet only (DefiLlama has no testnet prices) — null elsewhere or if any
 * deposit-time price is missing (no silently-wrong alpha).
 */

import { parseAbi } from "viem";
import { getTokenInfo, getUsdPrice, rawToUsd } from "./pricing.js";

const ERC20_BALANCE = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

// HODL 50/50 benchmark basket (Base mainnet).
const BENCH_BASKET = {
  base: [
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC
    "0x4200000000000000000000000000000000000006", // WETH
  ],
};

/**
 * Phantom HODL portfolio: every deposit buys the basket 50/50 at its own
 * timestamp; the result is marked to market at `now`.
 * @returns number|null  null when the chain has no basket or a price is missing.
 */
async function benchmarkValue({ pool, cfg, botId, now }) {
  const basket = BENCH_BASKET[cfg.chainName];
  if (!basket) return null;

  const deposits = await pool.query(
    `select t.amount_usd, t.block_timestamp
       from bot_registry.wallet_transfers t
       join (select wallet_address, tx_hash
               from bot_registry.wallet_transfers
              where bot_id = $1 and chain = $2
              group by wallet_address, tx_hash
             having count(distinct direction) = 1) solo
         on solo.wallet_address = t.wallet_address and solo.tx_hash = t.tx_hash
      where t.bot_id = $1 and t.chain = $2 and t.direction = 'in'
        and t.amount_usd is not null
        and (t.counterparty is null or lower(t.counterparty) <> lower($3))`,
    [botId, cfg.chainName, cfg.registryAddress]
  );
  if (deposits.rows.length === 0) return null;

  const units = new Array(basket.length).fill(0);
  for (const dep of deposits.rows) {
    const usd = Number(dep.amount_usd);
    const at = new Date(dep.block_timestamp);
    for (let i = 0; i < basket.length; i++) {
      const price = await getUsdPrice(cfg.chainName, basket[i], at);
      if (!price) return null; // missing history → no alpha, never a wrong one
      units[i] += usd / basket.length / price;
    }
  }

  let value = 0;
  for (let i = 0; i < basket.length; i++) {
    const price = await getUsdPrice(cfg.chainName, basket[i], now);
    if (!price) return null;
    value += units[i] * price;
  }
  return value;
}

export async function computeStats({ client, pool, viemClient, cfg, log = console.log }) {
  const bots = await pool.query(
    `select b.bot_id, b.stake_amount_raw,
            array_agg(distinct w.wallet_address) as wallets
       from bot_registry.bots b
       join bot_registry.bot_wallets w
         on w.bot_id = b.bot_id and w.unlinked_at is null
      where b.chain = $1 and b.status in ('active', 'paused')
      group by b.bot_id, b.stake_amount_raw`,
    [cfg.chainName]
  );

  let updated = 0;
  for (const bot of bots.rows) {
    try {
      const [flows, trades, tokens] = await Promise.all([
        pool.query(
          `select coalesce(sum(case when direction = 'in'
                                    then coalesce(amount_usd, 0)
                                    else -coalesce(amount_usd, 0) end), 0) as net_flows
             from bot_registry.wallet_transfers
            where bot_id = $1 and chain = $2
              and (counterparty is null or lower(counterparty) <> lower($3))`,
          [bot.bot_id, cfg.chainName, cfg.registryAddress]
        ),
        pool.query(
          `select count(*) as n from (
             select tx_hash
               from bot_registry.wallet_transfers
              where bot_id = $1 and chain = $2
              group by tx_hash
             having count(distinct direction) = 2
           ) swaps`,
          [bot.bot_id, cfg.chainName]
        ),
        pool.query(
          `select distinct token_address
             from bot_registry.wallet_transfers
            where bot_id = $1 and chain = $2`,
          [bot.bot_id, cfg.chainName]
        ),
      ]);

      let holdingsUsd = 0;
      const now = new Date();
      for (const { token_address } of tokens.rows) {
        for (const wallet of bot.wallets) {
          // Public RPCs rate-limit aggressively right after the getLogs sweep —
          // retry with backoff instead of dropping the bot's stats for 5 min.
          let bal = null;
          for (let attempt = 0; ; attempt++) {
            try {
              bal = await viemClient.readContract({
                address: token_address,
                abi: ERC20_BALANCE,
                functionName: "balanceOf",
                args: [wallet],
              });
              break;
            } catch (e) {
              if (attempt >= 4) throw e;
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
          if (bal === 0n) continue;
          const info = await getTokenInfo(client, viemClient, cfg.chainName, token_address);
          const price = await getUsdPrice(cfg.chainName, token_address, now);
          const usd = rawToUsd(bal, info.decimals, price);
          if (usd !== null) holdingsUsd += usd;
        }
      }

      const stakeUsd = Number(bot.stake_amount_raw) / 1e6; // stake token is USDC
      const equityUsd = holdingsUsd + stakeUsd;
      const netFlowsUsd = Number(flows.rows[0].net_flows);
      const pnlUsd = equityUsd - netFlowsUsd;
      const pnlPct = netFlowsUsd > 0 ? pnlUsd / netFlowsUsd : null;

      const benchmarkUsd = await benchmarkValue({ pool, cfg, botId: bot.bot_id, now });
      const alphaPct =
        benchmarkUsd !== null && benchmarkUsd > 0
          ? (equityUsd - benchmarkUsd) / benchmarkUsd
          : null;

      await pool.query(
        `insert into bot_registry.bot_stats
           (bot_id, total_trades, total_pnl_usd, total_pnl_pct, equity_usd, net_flows_usd,
            benchmark_usd, vs_benchmark_pct)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (bot_id) do update set
           total_trades     = excluded.total_trades,
           total_pnl_usd    = excluded.total_pnl_usd,
           total_pnl_pct    = excluded.total_pnl_pct,
           equity_usd       = excluded.equity_usd,
           net_flows_usd    = excluded.net_flows_usd,
           benchmark_usd    = excluded.benchmark_usd,
           vs_benchmark_pct = excluded.vs_benchmark_pct`,
        [
          bot.bot_id,
          Number(trades.rows[0].n),
          pnlUsd.toFixed(6),
          pnlPct === null ? null : pnlPct.toFixed(8),
          equityUsd.toFixed(6),
          netFlowsUsd.toFixed(6),
          benchmarkUsd === null ? null : benchmarkUsd.toFixed(6),
          alphaPct === null ? null : alphaPct.toFixed(8),
        ]
      );
      log(
        `[stats] bot ${bot.bot_id}: equity=$${equityUsd.toFixed(2)} flows=$${netFlowsUsd.toFixed(2)} pnl=$${pnlUsd.toFixed(2)}${pnlPct !== null ? ` (${(pnlPct * 100).toFixed(1)}%)` : ""}${benchmarkUsd !== null ? ` | bench=$${benchmarkUsd.toFixed(2)} alpha=${(alphaPct * 100).toFixed(1)}%` : ""}`
      );
      updated++;
    } catch (e) {
      // Stats are derived state — a pricing/RPC hiccup on one bot must not
      // fail the whole indexing pass.
      log(`[stats] bot ${bot.bot_id} failed: ${e?.message ?? e}`);
    }
  }
  return { updated };
}
