import { supabase } from "./db.js";

const USDC_DECIMALS = 6;

function toUsdc(raw) {
  if (raw === null || raw === undefined) return null;
  return Number(raw) / 10 ** USDC_DECIMALS;
}

// PostgREST returns bytea as "\xDEADBEEF" — normalize to "0xdeadbeef" hex.
function byteaToHex(v) {
  if (!v) return null;
  if (typeof v === "string" && v.startsWith("\\x")) return "0x" + v.slice(2);
  return v;
}

async function fail(op, error) {
  console.error(`[query] ${op} failed:`, error);
  throw new Error(`${op}: ${error?.message ?? error}`);
}

export async function listBots() {
  // 3 round-trips: bots + active wallets + missions. Acceptable for MVP scale.
  const [bots, wallets, missions] = await Promise.all([
    supabase
      .from("bots")
      .select("bot_id, on_chain_bot_id, operator_address, manifest_uri, stake_amount_raw, status, chain, registered_at, registered_block")
      .order("chain", { ascending: true }) // 'base' sorts before 'baseSepolia'
      .order("registered_at", { ascending: false })
      .limit(200),
    supabase.from("bot_wallets").select("bot_id").is("unlinked_at", null),
    supabase.from("missions").select("bot_id"),
  ]);
  if (bots.error) await fail("listBots:bots", bots.error);
  if (wallets.error) await fail("listBots:wallets", wallets.error);
  if (missions.error) await fail("listBots:missions", missions.error);

  const wCount = new Map();
  for (const w of wallets.data) wCount.set(String(w.bot_id), (wCount.get(String(w.bot_id)) || 0) + 1);
  const mCount = new Map();
  for (const m of missions.data) mCount.set(String(m.bot_id), (mCount.get(String(m.bot_id)) || 0) + 1);

  return bots.data.map((b) => ({
    bot_id: String(b.bot_id),
    on_chain_bot_id: String(b.on_chain_bot_id),
    operator_address: b.operator_address,
    manifest_uri: b.manifest_uri,
    stake_amount_raw: b.stake_amount_raw,
    stake_amount_usdc: toUsdc(b.stake_amount_raw),
    status: b.status,
    chain: b.chain,
    registered_at: b.registered_at,
    registered_block: Number(b.registered_block),
    wallets_count: wCount.get(String(b.bot_id)) || 0,
    missions_count: mCount.get(String(b.bot_id)) || 0,
  }));
}

export async function getBot(botId) {
  const { data, error } = await supabase
    .from("bots")
    .select("bot_id, on_chain_bot_id, operator_address, manifest_uri, manifest_hash, stake_amount_raw, status, chain, registered_at, registered_block, registered_tx")
    .eq("bot_id", botId)
    .maybeSingle();
  if (error) await fail("getBot", error);
  if (!data) return null;
  return {
    bot_id: String(data.bot_id),
    on_chain_bot_id: String(data.on_chain_bot_id),
    operator_address: data.operator_address,
    manifest_uri: data.manifest_uri,
    manifest_hash: byteaToHex(data.manifest_hash),
    stake_amount_raw: data.stake_amount_raw,
    stake_amount_usdc: toUsdc(data.stake_amount_raw),
    status: data.status,
    chain: data.chain,
    registered_at: data.registered_at,
    registered_block: Number(data.registered_block),
    registered_tx: data.registered_tx,
  };
}

export async function getBotWallets(botId) {
  const { data, error } = await supabase
    .from("bot_wallets")
    .select("wallet_address, chain, linked_at, linked_block, linked_tx, unlinked_at, unlinked_tx")
    .eq("bot_id", botId)
    .order("linked_at", { ascending: true });
  if (error) await fail("getBotWallets", error);
  return (data || []).map((row) => ({ ...row, linked_block: Number(row.linked_block) }));
}

export async function getBotMissions(botId) {
  const { data, error } = await supabase
    .from("missions")
    .select("epoch_id, strategy_hash, manifest_uri, attested_at, attested_block, attested_tx")
    .eq("bot_id", botId)
    .order("attested_at", { ascending: false });
  if (error) await fail("getBotMissions", error);
  return (data || []).map((row) => ({
    epoch_id: row.epoch_id,
    strategy_hash: byteaToHex(row.strategy_hash),
    manifest_uri: row.manifest_uri,
    attested_at: row.attested_at,
    attested_block: Number(row.attested_block),
    attested_tx: row.attested_tx,
  }));
}

/**
 * Returns the (chain, on_chain_bot_id) pair so callers can filter on
 * contract_events / wallet_transfers etc. (those tables hold the on-chain id
 * inside event_data, not the DB autoincrement id).
 */
async function resolveOnChainBotId(botId) {
  const { data, error } = await supabase
    .from("bots")
    .select("chain, on_chain_bot_id")
    .eq("bot_id", botId)
    .maybeSingle();
  if (error) await fail("resolveOnChainBotId", error);
  return data; // null if not found
}

export async function getBotEventsCount(botId) {
  const ref = await resolveOnChainBotId(botId);
  if (!ref) return 0;
  const { count, error } = await supabase
    .from("contract_events")
    .select("*", { count: "exact", head: true })
    .eq("chain", ref.chain)
    .eq("event_data->>botId", String(ref.on_chain_bot_id));
  if (error) await fail("getBotEventsCount", error);
  return count ?? 0;
}

export async function getBotStats(botId) {
  const { data, error } = await supabase
    .from("bot_stats")
    .select("*")
    .eq("bot_id", botId)
    .maybeSingle();
  if (error) await fail("getBotStats", error);
  return data || null;
}

export async function getBotEvents(botId, { limit = 100, offset = 0 } = {}) {
  const ref = await resolveOnChainBotId(botId);
  if (!ref) return [];
  const { data, error } = await supabase
    .from("contract_events")
    .select("event_name, block_number, block_timestamp, tx_hash, log_index, event_data")
    .eq("chain", ref.chain)
    .eq("event_data->>botId", String(ref.on_chain_bot_id))
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) await fail("getBotEvents", error);
  return (data || []).map((row) => ({
    event_name: row.event_name,
    block_number: Number(row.block_number),
    block_timestamp: row.block_timestamp,
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    args: row.event_data,
  }));
}

export async function getBotTransfers(botId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("wallet_transfers")
    .select("wallet_address, chain, token_address, direction, amount_raw, counterparty, block_number, block_timestamp, tx_hash, log_index")
    .eq("bot_id", botId)
    .order("block_timestamp", { ascending: false })
    .limit(limit);
  if (error) await fail("getBotTransfers", error);
  return (data || []).map((r) => ({ ...r, block_number: Number(r.block_number) }));
}

export async function getBotTransfersStats(botId) {
  const { data, error } = await supabase
    .from("wallet_transfers")
    .select("amount_raw, direction, block_timestamp")
    .eq("bot_id", botId);
  if (error) await fail("getBotTransfersStats", error);
  const rows = data || [];
  return {
    transfers_count: rows.length,
    last_transfer_at: rows.length
      ? rows.reduce((acc, r) => (r.block_timestamp > acc ? r.block_timestamp : acc), rows[0].block_timestamp)
      : null,
  };
}
