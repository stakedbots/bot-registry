/**
 * Per-bot derived stats — the "result" layer on top of raw chain truth.
 *
 * PnL is mark-to-market, derived entirely from indexed data + live chain reads:
 *
 *   equity_usd    = Σ (current ERC20 balance of linked wallets × price now)
 *                   + stake locked in the Registry (USDC)
 *   net_flows_usd = Σ amount_usd(in) − Σ amount_usd(out)   (wallet_transfers)
 *   pnl_usd       = equity_usd − net_flows_usd
 *   pnl_pct       = pnl_usd / net_flows_usd                 (null if flows ≤ 0)
 *
 * Native ETH is excluded on both sides: ETH deposits aren't ERC20 Transfers so
 * they never enter net_flows, and the gas tank isn't trading capital. The
 * stake-out transfer to the Registry is cancelled by adding the stake back
 * into equity — staking and withdrawing are PnL-neutral, slashing is a loss.
 *
 * total_trades counts txs where the wallet had transfers in BOTH directions
 * (a swap), so plain deposits/withdrawals don't inflate it.
 */

import { parseAbi } from "viem";
import { getTokenInfo, getUsdPrice, rawToUsd } from "./pricing.js";

const ERC20_BALANCE = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

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
            where bot_id = $1 and chain = $2`,
          [bot.bot_id, cfg.chainName]
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
          const bal = await viemClient.readContract({
            address: token_address,
            abi: ERC20_BALANCE,
            functionName: "balanceOf",
            args: [wallet],
          });
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

      await pool.query(
        `insert into bot_registry.bot_stats
           (bot_id, total_trades, total_pnl_usd, total_pnl_pct, equity_usd, net_flows_usd)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (bot_id) do update set
           total_trades  = excluded.total_trades,
           total_pnl_usd = excluded.total_pnl_usd,
           total_pnl_pct = excluded.total_pnl_pct,
           equity_usd    = excluded.equity_usd,
           net_flows_usd = excluded.net_flows_usd`,
        [
          bot.bot_id,
          Number(trades.rows[0].n),
          pnlUsd.toFixed(6),
          pnlPct === null ? null : pnlPct.toFixed(8),
          equityUsd.toFixed(6),
          netFlowsUsd.toFixed(6),
        ]
      );
      log(
        `[stats] bot ${bot.bot_id}: equity=$${equityUsd.toFixed(2)} flows=$${netFlowsUsd.toFixed(2)} pnl=$${pnlUsd.toFixed(2)}${pnlPct !== null ? ` (${(pnlPct * 100).toFixed(1)}%)` : ""}`
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
