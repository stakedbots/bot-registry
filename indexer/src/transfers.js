/**
 * Trade indexer — captures every ERC20 Transfer event that touches a linked
 * trading wallet, in either direction. Pairing in/out within the same tx
 * gives swap reconstruction without needing per-DEX adapters.
 *
 * Pricing (USD value, PnL) is deliberately out of scope here — that needs an
 * oracle and per-token decimals. This module stays at "raw chain truth".
 */

import { parseAbi, getAddress } from "viem";

const TRANSFER = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** Get all currently-linked wallets for a chain. */
async function getLinkedWallets(pool, chain) {
  const r = await pool.query(
    `select bot_id, wallet_address, linked_block
       from bot_registry.bot_wallets
       where chain = $1 and unlinked_at is null`,
    [chain]
  );
  return r.rows.map((row) => ({
    botId: row.bot_id,
    address: getAddress(row.wallet_address),
    linkedBlock: BigInt(row.linked_block),
  }));
}

async function getCursor(pool, name) {
  const r = await pool.query(
    "select last_block from bot_registry.indexer_cursors where name = $1",
    [name]
  );
  return r.rows[0] ? BigInt(r.rows[0].last_block) : null;
}

async function setCursor(pool, name, chain, lastBlock) {
  await pool.query(
    `insert into bot_registry.indexer_cursors (name, chain, last_block, last_processed_at)
     values ($1, $2, $3, now())
     on conflict (name) do update
       set last_block = excluded.last_block,
           last_processed_at = excluded.last_processed_at`,
    [name, chain, lastBlock.toString()]
  );
}

async function insertTransfer(client, t) {
  await client.query(
    `insert into bot_registry.wallet_transfers
       (bot_id, wallet_address, chain, token_address, direction,
        amount_raw, counterparty,
        block_number, block_timestamp, tx_hash, log_index)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (chain, tx_hash, log_index, direction) do nothing`,
    [
      t.botId.toString(),
      t.wallet.toLowerCase(),
      t.chain,
      t.token.toLowerCase(),
      t.direction,
      t.amount.toString(),
      t.counterparty ? t.counterparty.toLowerCase() : null,
      t.blockNumber.toString(),
      t.blockTimestamp,
      t.txHash,
      t.logIndex,
    ]
  );
}

/**
 * Run one indexing pass: scan from cursor to chain head for Transfer events
 * touching any linked wallet. Splits into chunks of `cfg.batchSize` blocks.
 *
 * @returns {{processed: number, head: bigint}}
 */
export async function indexTransfers({ client, pool, viemClient, cfg, dry = false, log = console.log }) {
  const cursorName = `${cfg.cursorName.replace("_registry_v1", "")}_transfers_v1`;
  const wallets = await getLinkedWallets(pool, cfg.chainName);
  if (wallets.length === 0) {
    log("[transfers] no linked wallets, skipping");
    return { processed: 0, head: 0n };
  }
  const head = await viemClient.getBlockNumber();
  let cursor = await getCursor(pool, cursorName);
  if (cursor === null) {
    // Start from the earliest link block.
    cursor = wallets.reduce((min, w) => (w.linkedBlock < min ? w.linkedBlock : min), wallets[0].linkedBlock);
    cursor -= 1n; // we'll start from cursor + 1
  }
  let from = cursor + 1n;
  log(`[transfers] head=${head} cursor=${cursor} start=${from} wallets=${wallets.length}`);

  if (from > head) {
    log("[transfers] up to date.");
    return { processed: 0, head };
  }

  // checksum-cased addresses for topic filter
  const addrs = wallets.map((w) => w.address);
  const byAddr = new Map(addrs.map((a) => [a.toLowerCase(), wallets.find((w) => w.address === a)]));
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

    // 2 calls: from ∈ wallets, then to ∈ wallets. Each combines OR semantic
    // via the array arg on the indexed param.
    const outgoing = await viemClient.getLogs({
      event: TRANSFER[0],
      args: { from: addrs },
      fromBlock: cur,
      toBlock: to,
    });
    const incoming = await viemClient.getLogs({
      event: TRANSFER[0],
      args: { to: addrs },
      fromBlock: cur,
      toBlock: to,
    });
    log(`[transfers] ${cur}-${to}: out=${outgoing.length} in=${incoming.length}`);

    const records = [];
    for (const ev of outgoing) {
      const w = byAddr.get(ev.args.from.toLowerCase());
      if (!w) continue;
      records.push({
        botId: w.botId,
        wallet: w.address,
        chain: cfg.chainName,
        token: ev.address,
        direction: "out",
        amount: ev.args.value,
        counterparty: ev.args.to,
        blockNumber: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.logIndex,
      });
    }
    for (const ev of incoming) {
      const w = byAddr.get(ev.args.to.toLowerCase());
      if (!w) continue;
      records.push({
        botId: w.botId,
        wallet: w.address,
        chain: cfg.chainName,
        token: ev.address,
        direction: "in",
        amount: ev.args.value,
        counterparty: ev.args.from,
        blockNumber: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.logIndex,
      });
    }

    for (const r of records) {
      r.blockTimestamp = await blockTs(r.blockNumber);
      if (dry) {
        log(`  [dry] ${r.direction} ${r.amount} ${r.token} tx=${r.txHash}`);
      } else {
        await client.query("BEGIN");
        try {
          await insertTransfer(client, r);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
      processed++;
    }

    if (!dry) await setCursor(pool, cursorName, cfg.chainName, to);
    cur = to + 1n;
  }
  return { processed, head };
}
