/**
 * Pricing helpers — token metadata (cached in bot_registry.tokens) and
 * historical USD prices via DefiLlama's free API.
 *
 * DefiLlama returns the closest available price at or before the requested
 * timestamp, so we don't need to bracket. Coin ids look like:
 *   base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 * for the USDC contract on Base mainnet. DefiLlama does NOT index Base Sepolia
 * tokens (testnet), so for sepolia chain we hardcode known stables.
 */

import { parseAbi, getContract } from "viem";

const ERC20 = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

// Known mainnet stables on Base; price = $1.
const KNOWN_STABLE_PRICE_USD = new Map([
  ["base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 1.0], // USDC
  ["base:0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", 1.0], // USDbC (legacy)
  // Sepolia mocks (no real market)
  ["basesepolia:0x036cbd53842c5426634e7929541ec2318f3dcf7e", 1.0],
]);

const TOKEN_CACHE = new Map(); // chain:addr → { decimals, symbol }
const PRICE_CACHE = new Map(); // chain:addr:ts(minute) → number|null

function k(chain, addr) {
  return `${chain.toLowerCase()}:${addr.toLowerCase()}`;
}

function llamaChain(chain) {
  // DefiLlama uses lowercase chain ids; base mainnet is "base". Sepolia is
  // not indexed — caller should not look up prices for it.
  if (chain === "base") return "base";
  return null;
}

/**
 * Get token metadata, cached. Reads bot_registry.tokens first, then queries
 * the ERC20 contract on-chain if missing, then persists.
 */
export async function getTokenInfo(pgClient, viemClient, chain, address) {
  const key = k(chain, address);
  if (TOKEN_CACHE.has(key)) return TOKEN_CACHE.get(key);

  const cached = await pgClient.query(
    "select decimals, symbol from bot_registry.tokens where chain = $1 and address = $2",
    [chain, address.toLowerCase()]
  );
  if (cached.rows[0]) {
    TOKEN_CACHE.set(key, cached.rows[0]);
    return cached.rows[0];
  }

  const erc20 = getContract({ address, abi: ERC20, client: viemClient });
  let decimals = 18, symbol = null, name = null;
  try {
    decimals = await erc20.read.decimals();
  } catch { /* keep default 18 */ }
  try { symbol = await erc20.read.symbol(); } catch {}
  try { name = await erc20.read.name(); } catch {}

  const info = { decimals: Number(decimals), symbol, name };
  await pgClient.query(
    `insert into bot_registry.tokens (chain, address, decimals, symbol, name)
       values ($1, $2, $3, $4, $5)
       on conflict (chain, address) do nothing`,
    [chain, address.toLowerCase(), info.decimals, info.symbol, info.name]
  );
  TOKEN_CACHE.set(key, info);
  return info;
}

/**
 * USD price of the token at the given block timestamp.
 *
 * @returns number|null  null if the token has no DefiLlama coverage.
 */
export async function getUsdPrice(chain, address, blockTimestamp) {
  const stable = KNOWN_STABLE_PRICE_USD.get(k(chain, address));
  if (stable !== undefined) return stable;

  const lc = llamaChain(chain);
  if (!lc) return null;

  const tsSec = Math.floor(blockTimestamp.getTime() / 1000);
  const minuteBucket = Math.floor(tsSec / 60) * 60;
  const cacheKey = `${k(chain, address)}:${minuteBucket}`;
  if (PRICE_CACHE.has(cacheKey)) return PRICE_CACHE.get(cacheKey);

  const coin = `${lc}:${address.toLowerCase()}`;
  const url = `https://coins.llama.fi/prices/historical/${minuteBucket}/${coin}`;
  let price = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      price = data?.coins?.[coin]?.price ?? null;
    }
  } catch (e) {
    console.warn(`[pricing] DefiLlama fetch failed for ${coin}:`, e?.message ?? e);
  }
  PRICE_CACHE.set(cacheKey, price);
  return price;
}

/**
 * Compute amount_usd given a raw transfer amount, token decimals, and price.
 */
export function rawToUsd(amountRaw, decimals, priceUsd) {
  if (priceUsd === null || priceUsd === undefined) return null;
  // amountRaw is a BigInt; need to scale and multiply without losing precision.
  // For reasonable transfer sizes this fits in Number range when normalized.
  const normalized = Number(amountRaw) / 10 ** decimals;
  return Number((normalized * priceUsd).toFixed(6));
}
