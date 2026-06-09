import pg from "pg";

const { Pool } = pg;

export function makePool(databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL not set");
  return new Pool({ connectionString: databaseUrl, max: 4 });
}

export async function getCursor(pool, name) {
  const r = await pool.query(
    "select last_block from bot_registry.indexer_cursors where name = $1",
    [name]
  );
  return r.rows[0] ? BigInt(r.rows[0].last_block) : null;
}

export async function setCursor(pool, name, chain, lastBlock) {
  await pool.query(
    `insert into bot_registry.indexer_cursors (name, chain, last_block, last_processed_at)
     values ($1, $2, $3, now())
     on conflict (name) do update
       set last_block = excluded.last_block,
           last_processed_at = excluded.last_processed_at`,
    [name, chain, lastBlock.toString()]
  );
}

// BigInts (botId, stake, etc.) come from viem and don't serialize natively.
// Stringify them for jsonb storage; readers can re-parse to BigInt as needed.
function jsonReplacer(_k, v) {
  return typeof v === "bigint" ? v.toString() : v;
}

/**
 * Insert a raw event row. Returns true if the row was new, false if it was
 * a duplicate (already indexed). Idempotency hinge.
 */
export async function insertContractEvent(client, ev) {
  const r = await client.query(
    `insert into bot_registry.contract_events
       (chain, contract_address, block_number, block_timestamp,
        tx_hash, log_index, event_name, event_data, processed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
     on conflict (chain, tx_hash, log_index) do nothing
     returning id`,
    [
      ev.chain,
      ev.contractAddress,
      ev.blockNumber.toString(),
      ev.blockTimestamp,
      ev.txHash,
      ev.logIndex,
      ev.eventName,
      JSON.stringify(ev.args, jsonReplacer),
    ]
  );
  return r.rowCount > 0;
}
