import { pool } from "./db.js";

const USDC_DECIMALS = 6;

function toUsdc(raw) {
  if (raw === null || raw === undefined) return null;
  return Number(raw) / 10 ** USDC_DECIMALS;
}

export async function listBots() {
  const r = await pool.query(`
    select b.bot_id, b.operator_address, b.manifest_uri, b.stake_amount_raw,
           b.status, b.chain, b.registered_at, b.registered_block,
           (select count(*) from bot_registry.bot_wallets w
             where w.bot_id = b.bot_id and w.unlinked_at is null) as wallets_count,
           (select count(*) from bot_registry.missions m
             where m.bot_id = b.bot_id) as missions_count
    from bot_registry.bots b
    order by b.registered_at desc
    limit 200
  `);
  return r.rows.map((row) => ({
    bot_id: String(row.bot_id),
    operator_address: row.operator_address,
    manifest_uri: row.manifest_uri,
    stake_amount_raw: row.stake_amount_raw,
    stake_amount_usdc: toUsdc(row.stake_amount_raw),
    status: row.status,
    chain: row.chain,
    registered_at: row.registered_at,
    registered_block: Number(row.registered_block),
    wallets_count: Number(row.wallets_count),
    missions_count: Number(row.missions_count),
  }));
}

export async function getBot(botId) {
  const r = await pool.query(
    `select bot_id, operator_address, manifest_uri,
            encode(manifest_hash, 'hex') as manifest_hash,
            stake_amount_raw, status, chain,
            registered_at, registered_block, registered_tx
     from bot_registry.bots where bot_id = $1`,
    [botId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    bot_id: String(row.bot_id),
    operator_address: row.operator_address,
    manifest_uri: row.manifest_uri,
    manifest_hash: "0x" + row.manifest_hash,
    stake_amount_raw: row.stake_amount_raw,
    stake_amount_usdc: toUsdc(row.stake_amount_raw),
    status: row.status,
    chain: row.chain,
    registered_at: row.registered_at,
    registered_block: Number(row.registered_block),
    registered_tx: row.registered_tx,
  };
}

export async function getBotWallets(botId) {
  const r = await pool.query(
    `select wallet_address, chain, linked_at, linked_block, linked_tx,
            unlinked_at, unlinked_tx
     from bot_registry.bot_wallets
     where bot_id = $1
     order by linked_at asc`,
    [botId]
  );
  return r.rows.map((row) => ({
    ...row,
    linked_block: Number(row.linked_block),
  }));
}

export async function getBotMissions(botId) {
  const r = await pool.query(
    `select epoch_id, encode(strategy_hash, 'hex') as strategy_hash,
            manifest_uri, attested_at, attested_block, attested_tx
     from bot_registry.missions
     where bot_id = $1
     order by attested_at desc`,
    [botId]
  );
  return r.rows.map((row) => ({
    epoch_id: row.epoch_id,
    strategy_hash: "0x" + row.strategy_hash,
    manifest_uri: row.manifest_uri,
    attested_at: row.attested_at,
    attested_block: Number(row.attested_block),
    attested_tx: row.attested_tx,
  }));
}

export async function getBotEventsCount(botId) {
  const r = await pool.query(
    `select count(*) as c
     from bot_registry.contract_events
     where event_data->>'botId' = $1`,
    [String(botId)]
  );
  return Number(r.rows[0].c);
}

export async function getBotStats(botId) {
  const r = await pool.query(
    `select * from bot_registry.bot_stats where bot_id = $1`,
    [botId]
  );
  return r.rows[0] || null;
}

export async function getBotEvents(botId, { limit = 100, offset = 0 } = {}) {
  const r = await pool.query(
    `select event_name, block_number, block_timestamp, tx_hash, log_index, event_data
     from bot_registry.contract_events
     where event_data->>'botId' = $1
     order by block_number, log_index
     limit $2 offset $3`,
    [String(botId), limit, offset]
  );
  return r.rows.map((row) => ({
    event_name: row.event_name,
    block_number: Number(row.block_number),
    block_timestamp: row.block_timestamp,
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    args: row.event_data,
  }));
}
