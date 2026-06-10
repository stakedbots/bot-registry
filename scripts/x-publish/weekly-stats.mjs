#!/usr/bin/env node
// Weekly stats post for @stakedbots. Designed to run headless (GitHub Actions).
//
// Credentials from env (repo secrets in CI):
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
//
// Composes ONE tweet with real on-chain numbers from the free API. No links
// (a URL makes the post 13x more expensive on the pay-per-use tier) — the
// profile bio carries the site.
//
// Usage:
//   node weekly-stats.mjs --dry-run   # compose + validate, post nothing
//   node weekly-stats.mjs             # post

import { TwitterApi } from "twitter-api-v2";
import twitterText from "twitter-text";

const DRY = process.argv.includes("--dry-run");
const API = "https://api.stakedbots.com";

const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
if (!DRY && (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET)) {
  console.error("Missing X_* credentials in env.");
  process.exit(1);
}

const res = await fetch(`${API}/bots`);
if (!res.ok) {
  console.error(`API responded ${res.status} — not posting.`);
  process.exit(1);
}
const { bots = [] } = await res.json();
const active = bots.filter((b) => b.status === "active");
if (active.length === 0) {
  console.error("No active bots — nothing to report, not posting.");
  process.exit(0);
}

const staked = active.reduce((s, b) => s + (b.stake_amount_usdc || 0), 0);
const volume = active.reduce((s, b) => s + (b.volume_usd || 0), 0);
const trades = active.reduce((s, b) => s + (b.transfers_count || 0), 0);
const missions = active.reduce((s, b) => s + (b.missions_count || 0), 0);

const fmtUsd = (n) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

const text = [
  `weekly chain report:`,
  ``,
  `→ ${active.length} bots staked (${fmtUsd(staked)} USDC at risk)`,
  `→ ${fmtUsd(volume)} tracked volume, ${trades} transfers indexed`,
  `→ ${missions} strategy missions attested on-chain`,
  ``,
  `zero self-reporting. every number is derived from Base chain data, and any agent can verify a bot for $0.05 via x402.`,
].join("\n");

const parsed = twitterText.parseTweet(text);
console.log(`--- tweet (${parsed.weightedLength}/280) ---\n${text}\n---`);
if (!parsed.valid) {
  console.error("Tweet exceeds weighted length — not posting.");
  process.exit(1);
}

if (DRY) {
  console.log("[dry-run] not posting.");
  process.exit(0);
}

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_TOKEN_SECRET,
});
const { data } = await client.v2.tweet(text);
console.log(`posted: https://x.com/stakedbots/status/${data.id}`);
