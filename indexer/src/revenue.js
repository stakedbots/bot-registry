/**
 * API revenue indexer — captures USDC paid to the stakedbots API's PAY_TO
 * address(es) via x402. The ERC20 Transfer alone doesn't say which endpoint was
 * hit, but the x402 price list does: 0.05 USDC = /bots/:id/events, 0.10 USDC =
 * /bots/:id/detail. The payer (`from`) is classified self vs external so we can
 * separate our own keep-alive/test traffic from genuine third-party demand.
 *
 * Mainnet-only. USDC is a $1 stable so no oracle is needed — amount_usdc is just
 * amount_raw / 1e6.
 */

import { parseAbi, getAddress } from "viem";
import { getCursor, setCursor } from "./db.js";

const TRANSFER = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

// x402 price list (raw 6-decimal USDC) -> endpoint label.
const PRICE_TO_ENDPOINT = new Map([
  [50000n, "events"],   // 0.05 USDC  GET /bots/:id/events
  [100000n, "detail"],  // 0.10 USDC  GET /bots/:id/detail
]);

// Our own wallets — any payment from these is keep-alive / testing, not demand.
const SELF = new Set(
  [
    "0xec87485Cc0949E50a13e8Ad5eE371f1De12281B2", // x402 treasury
    "0xfBaa47A6A4463Fc7D1dD1e3B20F07e1DD76B3dDD", // deployer
    "0xd2dEa3cd70b66C13ba44C1D23860Ed50fFd32CF5", // bot thesis-llm
    "0xf556ff0f1afd935906e75d3911000c5fF91FB0D9", // bot momentum-det
    "0x21b077B26bFda6d2b8fdf0130977362D61e18912", // revenue wallet itself
  ].map((a) => a.toLowerCase())
);

// Receiving addresses to watch. The original PAY_TO was Jorge's personal ENS,
// so for it we only count transfers matching a known x402 price (otherwise we'd
// ingest unrelated payments to that wallet). The dedicated revenue wallet only
// ever receives x402 income, so everything to it counts.
const PAY_TO_WATCH = [
  { address: "0xdaBC8b82e3a3c637a14E7c2F9F35A7cE83bAaCab", dedicated: false }, // jorgemora.eth (historical)
  { address: "0x21b077B26bFda6d2b8fdf0130977362D61e18912", dedicated: true },  // dedicated revenue wallet
];

// Don't scan ancient history of the personal ENS — the API went mainnet ~06-10.
const REVENUE_START_BLOCK = 46900000n;
const CURSOR_NAME = "base_mainnet_revenue_v1";

async function insertRevenue(client, r) {
  await client.query(
    `insert into bot_registry.api_revenue
       (chain, pay_to, from_address, token_address, amount_raw, amount_usdc,
        endpoint, classification, block_number, block_timestamp, tx_hash, log_index)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (chain, tx_hash, log_index) do nothing`,
    [
      r.chain,
      r.payTo.toLowerCase(),
      r.from.toLowerCase(),
      r.token.toLowerCase(),
      r.amountRaw.toString(),
      r.amountUsdc,
      r.endpoint,
      r.classification,
      r.blockNumber.toString(),
      r.blockTimestamp,
      r.txHash,
      r.logIndex,
    ]
  );
}

/**
 * Run one revenue indexing pass: scan USDC Transfer events whose `to` is one of
 * the watched PAY_TO addresses, from the cursor to chain head.
 *
 * @returns {{processed: number, head: bigint}}
 */
export async function indexRevenue({ client, pool, viemClient, cfg, dry = false, log = console.log }) {
  if (cfg.chainName !== "base") {
    log("[revenue] not mainnet, skipping");
    return { processed: 0, head: 0n };
  }

  const watchByAddr = new Map(PAY_TO_WATCH.map((w) => [w.address.toLowerCase(), w]));
  const addrs = PAY_TO_WATCH.map((w) => getAddress(w.address)); // checksum for topic filter

  const head = await viemClient.getBlockNumber();
  let cursor = await getCursor(pool, CURSOR_NAME);
  if (cursor === null) cursor = REVENUE_START_BLOCK - 1n;
  let from = cursor + 1n;
  log(`[revenue] head=${head} cursor=${cursor} start=${from} watching=${addrs.length}`);

  if (from > head) {
    log("[revenue] up to date.");
    return { processed: 0, head };
  }

  const blockTsCache = new Map();
  async function blockTs(bn) {
    if (blockTsCache.has(bn)) return blockTsCache.get(bn);
    const block = await viemClient.getBlock({ blockNumber: bn });
    const d = new Date(Number(block.timestamp) * 1000);
    blockTsCache.set(bn, d);
    return d;
  }

  let processed = 0;
  let cur = from;
  while (cur <= head) {
    const to = cur + cfg.batchSize - 1n > head ? head : cur + cfg.batchSize - 1n;

    const logs = await viemClient.getLogs({
      address: USDC_BASE,
      event: TRANSFER[0],
      args: { to: addrs },
      fromBlock: cur,
      toBlock: to,
    });
    log(`[revenue] ${cur}-${to}: ${logs.length} inbound USDC`);

    for (const ev of logs) {
      const watch = watchByAddr.get(ev.args.to.toLowerCase());
      if (!watch) continue;
      const amountRaw = ev.args.value;
      const endpoint = PRICE_TO_ENDPOINT.get(amountRaw) ?? null;

      // For the personal ENS, only count transfers that match a known x402
      // price — otherwise unrelated payments would pollute revenue.
      if (!watch.dedicated && endpoint === null) continue;

      const from = ev.args.from.toLowerCase();
      const classification = SELF.has(from) ? "self" : "external";
      const blockTimestamp = await blockTs(ev.blockNumber);
      const rec = {
        chain: cfg.chainName,
        payTo: ev.args.to,
        from: ev.args.from,
        token: ev.address,
        amountRaw,
        amountUsdc: Number(amountRaw) / 1e6,
        endpoint,
        classification,
        blockNumber: ev.blockNumber,
        blockTimestamp,
        txHash: ev.transactionHash,
        logIndex: ev.logIndex,
      };

      if (dry) {
        log(`  [dry] ${rec.amountUsdc} USDC ${endpoint ?? "?"} ${classification} from ${from} tx=${rec.txHash}`);
      } else {
        await client.query("BEGIN");
        try {
          await insertRevenue(client, rec);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
      processed++;
    }

    if (!dry) await setCursor(pool, CURSOR_NAME, cfg.chainName, to);
    cur = to + 1n;
  }
  return { processed, head };
}
