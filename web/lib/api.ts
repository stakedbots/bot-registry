/**
 * Thin client for the stakedbots x402 API. Free endpoints only — paid endpoints
 * (detail, events) are linked from the UI but not fetched server-side (the
 * value prop is "agents pay", not "we pay on the user's behalf").
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://api.stakedbots.com";

// 30s ISR so the leaderboard is fresh-ish without hammering the API.
const REVALIDATE = 30;

export type BotListEntry = {
  bot_id: string;
  on_chain_bot_id: string;
  operator_address: string;
  manifest_uri: string;
  stake_amount_raw: string | number;
  stake_amount_usdc: number;
  status: string;
  chain: string;
  registered_at: string;
  registered_block: number;
  wallets_count: number;
  missions_count: number;
  transfers_count: number;
  volume_usd: number;
  last_transfer_at: string | null;
};

export type BotOverview = BotListEntry & {
  manifest_hash: string;
  registered_tx: string;
};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function listBots(): Promise<BotListEntry[]> {
  const data = await fetchJson<{ bots: BotListEntry[] }>("/bots");
  return data.bots ?? [];
}

export async function getBot(id: string): Promise<BotOverview | null> {
  const res = await fetch(`${API_URL}/bots/${encodeURIComponent(id)}`, {
    next: { revalidate: REVALIDATE },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`/bots/${id}: ${res.status}`);
  return res.json();
}

export function apiUrl(): string {
  return API_URL;
}
