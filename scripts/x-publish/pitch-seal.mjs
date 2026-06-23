#!/usr/bin/env node
// One-off: tweet the Seal "Bot Scout" hack pitch at @heysealai from @stakedbots.
// Same Proton-Pass credential pattern as publish.mjs. Link-free on purpose
// (a URL would push the post from $0.015 to $0.20 on X pay-per-use).
//
// Usage:
//   node pitch-seal.mjs --dry-run   # validate creds + length, post nothing
//   node pitch-seal.mjs             # post it live
//
import { execFileSync } from "node:child_process";
import { TwitterApi } from "twitter-api-v2";
import twitterText from "twitter-text";

const DRY = process.argv.includes("--dry-run");
const SESSION_DIR = "/tmp/pass-agent-claude-main";
const ITEM = "X API stakedbots";

const TEXT =
  "Hey @heysealai — built you a hack: Bot Scout. A verifiable leaderboard of AI trading bots that stake USDC + attest strategy on-chain before trading, ranked by real alpha vs HODL. Already in the x402 Bazaar your discover_x402_services queries. Who do I send the spec to?";

function loadCreds() {
  const out = execFileSync(
    "pass-cli",
    ["item", "view", "--vault-name", "Claude", "--item-title", ITEM, "--output", "json"],
    {
      env: {
        ...process.env,
        PROTON_PASS_SESSION_DIR: SESSION_DIR,
        PROTON_PASS_AGENT_REASON: "tweet pitch del hack Bot Scout a @heysealai",
      },
      encoding: "utf8",
    }
  );
  const item = JSON.parse(out);
  const content = item?.item?.content ?? item?.content ?? {};
  const login = content?.content?.Login ?? {};
  const appKey = (login.username ?? "").trim();
  const appSecret = (login.password ?? "").trim();
  const note = content?.note ?? "";
  const get = (k) => {
    const m = note.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, "m"));
    return m ? m[1].trim() : "";
  };
  return {
    appKey,
    appSecret,
    accessToken: get("ACCESS_TOKEN"),
    accessSecret: get("ACCESS_TOKEN_SECRET"),
  };
}

async function main() {
  const parsed = twitterText.parseTweet(TEXT);
  console.log(`Length: ${parsed.weightedLength}/280 weighted (valid: ${parsed.valid})`);
  console.log(`Text:\n${TEXT}\n`);
  if (!parsed.valid) {
    console.error("✖ Tweet too long / invalid. Aborting.");
    process.exit(1);
  }

  const creds = loadCreds();
  for (const [k, v] of Object.entries(creds)) {
    if (!v) {
      console.error(`✖ Missing credential: ${k}`);
      process.exit(1);
    }
  }
  const client = new TwitterApi(creds);
  const me = await client.v2.me();
  console.log(`✓ Authenticated as @${me.data.username}`);

  if (DRY) {
    console.log("\nDRY RUN — credentials + length valid, nothing posted.");
    return;
  }
  const res = await client.v2.tweet({ text: TEXT });
  console.log(`✓ Posted: https://x.com/${me.data.username}/status/${res.data.id}`);
}

main().catch((e) => {
  console.error("✖", e?.message ?? e);
  process.exit(1);
});
