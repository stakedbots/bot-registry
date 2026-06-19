/**
 * Bot Registry indexer — main entrypoint.
 *
 * Usage:
 *   node src/index.js              # daemon (loops every POLL_INTERVAL_SECONDS)
 *   node src/index.js --once       # run a single batch then exit
 *   node src/index.js --dry-run    # read chain only, print events, no DB writes
 */

import { loadConfig } from "./config.js";
import { makeClient, fetchLogs, getBlockTimestamps } from "./chain.js";
import { makePool, getCursor, setCursor, insertContractEvent } from "./db.js";
import { HANDLERS } from "./handlers.js";
import { indexTransfers } from "./transfers.js";
import { indexRevenue } from "./revenue.js";
import { computeStats } from "./stats.js";

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const DRY  = args.has("--dry-run");

function jsonReplacer(_k, v) {
  if (typeof v === "bigint") return v.toString();
  return v;
}

async function indexBatch(client, pool, cfg, fromBlock, toBlock, viemClient) {
  const logs = await fetchLogs(viemClient, cfg, fromBlock, toBlock);
  if (logs.length === 0) {
    console.log(`[${cfg.chainName}] ${fromBlock}–${toBlock}: 0 logs`);
    return;
  }
  const blocks = logs.map((l) => l.blockNumber);
  const timestamps = await getBlockTimestamps(viemClient, blocks);

  console.log(`[${cfg.chainName}] ${fromBlock}–${toBlock}: ${logs.length} logs`);

  for (const log of logs) {
    const ctx = {
      chain: cfg.chainName,
      contractAddress: cfg.registryAddress,
      blockNumber: log.blockNumber,
      blockTimestamp: timestamps.get(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      eventName: log.eventName,
      args: log.args,
    };

    if (DRY) {
      console.log(
        `  block=${log.blockNumber} idx=${log.logIndex} ${log.eventName}`,
        JSON.stringify(log.args, jsonReplacer)
      );
      continue;
    }

    await client.query("BEGIN");
    try {
      const isNew = await insertContractEvent(client, ctx);
      if (isNew) {
        const handler = HANDLERS[log.eventName];
        if (handler) {
          await handler(client, ctx, log.args);
        } else {
          console.warn(`  no handler for ${log.eventName}, raw event kept`);
        }
      }
      await client.query("COMMIT");
      console.log(`  ✓ block=${log.blockNumber} idx=${log.logIndex} ${log.eventName} ${isNew ? "applied" : "dup-skip"}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
}

async function runOnce(pool, viemClient, cfg) {
  const head = await viemClient.getBlockNumber();
  let cursor = DRY ? null : await getCursor(pool, cfg.cursorName);
  let from = cursor !== null ? cursor + 1n : cfg.startBlock;

  console.log(`head=${head} cursor=${cursor ?? "—"} start=${from}`);

  if (from > head) {
    console.log("up to date.");
    return head;
  }

  let client = null;
  if (!DRY) client = await pool.connect();
  try {
    let cur = from;
    while (cur <= head) {
      const to = cur + cfg.batchSize - 1n > head ? head : cur + cfg.batchSize - 1n;
      await indexBatch(client, pool, cfg, cur, to, viemClient);
      if (!DRY) await setCursor(pool, cfg.cursorName, cfg.chainName, to);
      cur = to + 1n;
    }

    // After registry events, sweep wallet transfers (independent cursor).
    const tr = await indexTransfers({ client, pool, viemClient, cfg, dry: DRY });
    console.log(`[transfers] processed ${tr.processed} records up to block ${tr.head}`);

    // Sweep API revenue: USDC paid to PAY_TO via x402 (independent cursor).
    const rev = await indexRevenue({ client, pool, viemClient, cfg, dry: DRY });
    console.log(`[revenue] processed ${rev.processed} payments up to block ${rev.head}`);

    // Refresh derived per-bot stats (mark-to-market PnL).
    if (!DRY) {
      const st = await computeStats({ client, pool, viemClient, cfg });
      console.log(`[stats] updated ${st.updated} bots`);
    }
  } finally {
    if (client) client.release();
  }
  return head;
}

async function main() {
  const cfg = loadConfig();
  console.log("indexer:", {
    chain: cfg.chainName,
    registry: cfg.registryAddress,
    startBlock: cfg.startBlock.toString(),
    batchSize: cfg.batchSize.toString(),
    dryRun: DRY,
  });

  const viemClient = makeClient(cfg);
  const pool = DRY ? null : makePool(cfg.databaseUrl);

  if (ONCE || DRY) {
    await runOnce(pool, viemClient, cfg);
    if (pool) await pool.end();
    return;
  }

  // daemon
  console.log(`daemon mode: polling every ${cfg.pollIntervalSeconds}s`);
  for (;;) {
    try {
      await runOnce(pool, viemClient, cfg);
    } catch (e) {
      console.error("batch error:", e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, cfg.pollIntervalSeconds * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
