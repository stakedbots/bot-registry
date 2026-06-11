import { supabase } from "./db.js";

const USDC_DECIMALS = 6;

// Which chains the public leaderboard surfaces. Defaults to mainnet only so
// testnet placeholders don't dilute the "real money" pitch. Set PUBLIC_LIST_CHAINS
// to a comma-separated list (e.g. "base,baseSepolia") to widen it.
const PUBLIC_LIST_CHAINS = (process.env.PUBLIC_LIST_CHAINS || "base")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

// bot_stats rows are derived state written by the indexer; absent or partial
// rows (e.g. before the first stats pass) must degrade to nulls, not errors.
function statsFields(row) {
  return {
    pnl_usd: row?.total_pnl_usd != null ? Number(row.total_pnl_usd) : null,
    pnl_pct: row?.total_pnl_pct != null ? Number(row.total_pnl_pct) : null,
    equity_usd: row?.equity_usd != null ? Number(row.equity_usd) : null,
    net_flows_usd: row?.net_flows_usd != null ? Number(row.net_flows_usd) : null,
    trades_count: row?.total_trades != null ? Number(row.total_trades) : null,
    // Alpha vs HODL 50/50 cbBTC/WETH from each deposit, chain-derived.
    benchmark_usd: row?.benchmark_usd != null ? Number(row.benchmark_usd) : null,
    alpha_pct: row?.vs_benchmark_pct != null ? Number(row.vs_benchmark_pct) : null,
  };
}

export async function listBots() {
  // Free endpoint — light summary including activity counts. The full detail
  // (recent transfers, events) stays paywalled.
  const [bots, wallets, missions, transfers, stats] = await Promise.all([
    supabase
      .from("bots")
      .select("bot_id, on_chain_bot_id, operator_address, manifest_uri, stake_amount_raw, status, chain, registered_at, registered_block")
      .in("status", ["active", "paused"]) // hide withdrawn + slashed from main view
      .in("chain", PUBLIC_LIST_CHAINS) // mainnet-only by default; testnet placeholders stay hidden
      .order("chain", { ascending: true }) // 'base' sorts before 'baseSepolia'
      .order("registered_at", { ascending: false })
      .limit(200),
    supabase.from("bot_wallets").select("bot_id").is("unlinked_at", null),
    supabase.from("missions").select("bot_id"),
    supabase.from("wallet_transfers").select("bot_id, amount_usd, block_timestamp"),
    supabase.from("bot_stats").select("*"),
  ]);
  if (bots.error) await fail("listBots:bots", bots.error);
  if (wallets.error) await fail("listBots:wallets", wallets.error);
  if (missions.error) await fail("listBots:missions", missions.error);
  if (transfers.error) await fail("listBots:transfers", transfers.error);
  if (stats.error) await fail("listBots:stats", stats.error);

  const sByBot = new Map();
  for (const s of stats.data) sByBot.set(String(s.bot_id), s);

  const wCount = new Map();
  for (const w of wallets.data) wCount.set(String(w.bot_id), (wCount.get(String(w.bot_id)) || 0) + 1);
  const mCount = new Map();
  for (const m of missions.data) mCount.set(String(m.bot_id), (mCount.get(String(m.bot_id)) || 0) + 1);

  // Aggregate transfer activity per bot in a single pass.
  const tStats = new Map(); // bot_id → { count, volumeUsd, lastAt }
  for (const t of transfers.data) {
    const key = String(t.bot_id);
    const cur = tStats.get(key) || { count: 0, volumeUsd: 0, lastAt: null };
    cur.count += 1;
    cur.volumeUsd += Math.abs(Number(t.amount_usd ?? 0));
    if (!cur.lastAt || t.block_timestamp > cur.lastAt) cur.lastAt = t.block_timestamp;
    tStats.set(key, cur);
  }

  return bots.data.map((b) => {
    const ts = tStats.get(String(b.bot_id)) || { count: 0, volumeUsd: 0, lastAt: null };
    return {
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
      transfers_count: ts.count,
      volume_usd: Number(ts.volumeUsd.toFixed(2)),
      last_transfer_at: ts.lastAt,
      ...statsFields(sByBot.get(String(b.bot_id))),
    };
  });
}

export async function getBot(botId) {
  const [main, tStats, stats, wCount, mCount] = await Promise.all([
    supabase
      .from("bots")
      .select("bot_id, on_chain_bot_id, operator_address, manifest_uri, manifest_hash, stake_amount_raw, status, chain, registered_at, registered_block, registered_tx")
      .eq("bot_id", botId)
      .maybeSingle(),
    getBotTransfersStats(botId),
    getBotStats(botId),
    supabase
      .from("bot_wallets")
      .select("*", { count: "exact", head: true })
      .eq("bot_id", botId)
      .is("unlinked_at", null),
    supabase
      .from("missions")
      .select("*", { count: "exact", head: true })
      .eq("bot_id", botId),
  ]);
  if (main.error) await fail("getBot", main.error);
  if (wCount.error) await fail("getBot:wallets", wCount.error);
  if (mCount.error) await fail("getBot:missions", mCount.error);
  if (!main.data) return null;
  const data = main.data;
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
    wallets_count: wCount.count ?? 0,
    missions_count: mCount.count ?? 0,
    transfers_count: tStats.transfers_count,
    volume_usd: tStats.volume_usd,
    last_transfer_at: tStats.last_transfer_at,
    ...statsFields(stats),
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
    .select("amount_usd, direction, block_timestamp")
    .eq("bot_id", botId);
  if (error) await fail("getBotTransfersStats", error);
  const rows = data || [];
  let volumeUsd = 0;
  let lastAt = null;
  for (const r of rows) {
    volumeUsd += Math.abs(Number(r.amount_usd ?? 0));
    if (!lastAt || r.block_timestamp > lastAt) lastAt = r.block_timestamp;
  }
  return {
    transfers_count: rows.length,
    volume_usd: Number(volumeUsd.toFixed(2)),
    last_transfer_at: lastAt,
  };
}
