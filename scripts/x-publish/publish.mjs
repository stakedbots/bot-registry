#!/usr/bin/env node
// Publish the launch thread to @stakedbots on X.
//
// Credentials are read at runtime from Proton Pass (item "X API stakedbots"):
//   username field  -> API Key (consumer key)
//   password field  -> API Secret (consumer secret)
//   note field      -> two lines:
//                        ACCESS_TOKEN=...
//                        ACCESS_TOKEN_SECRET=...
//
// Nothing secret is stored in this repo.
//
// Usage:
//   node publish.mjs --dry-run    # validate creds + content, post nothing
//   node publish.mjs              # post the full thread
//   node publish.mjs --first-only # post only tweet 1 (smoke test)
//
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TwitterApi } from "twitter-api-v2";
import twitterText from "twitter-text";
import { THREAD } from "./thread.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");
const FIRST_ONLY = process.argv.includes("--first-only");

const SESSION_DIR = "/tmp/pass-agent-claude-main";
const ITEM = "X API stakedbots";

function passItemJson() {
  const out = execFileSync(
    "pass-cli",
    ["item", "view", "--vault-name", "Claude", "--item-title", ITEM, "--output", "json"],
    {
      env: {
        ...process.env,
        PROTON_PASS_SESSION_DIR: SESSION_DIR,
        PROTON_PASS_AGENT_REASON: "publicar hilo de lanzamiento de stakedbots en X",
      },
      encoding: "utf8",
    }
  );
  return JSON.parse(out);
}

function loadCreds() {
  const item = passItemJson();
  const content = item?.item?.content ?? item?.content ?? {};
  const login = content?.content?.Login ?? {};
  const appKey = (login.username ?? "").trim();
  const appSecret = (login.password ?? "").trim();
  const note = content?.note ?? "";
  const get = (k) => {
    const m = note.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const accessToken = get("ACCESS_TOKEN");
  const accessSecret = get("ACCESS_TOKEN_SECRET");
  const missing = [];
  if (!appKey) missing.push("API Key (username field)");
  if (!appSecret) missing.push("API Secret (password field)");
  if (!accessToken) missing.push("ACCESS_TOKEN (note field)");
  if (!accessSecret) missing.push("ACCESS_TOKEN_SECRET (note field)");
  if (missing.length) {
    console.error("✖ Missing credentials in Proton item '" + ITEM + "':");
    for (const m of missing) console.error("   - " + m);
    process.exit(1);
  }
  return { appKey, appSecret, accessToken, accessSecret };
}

function validateContent() {
  let ok = true;
  THREAD.forEach((t, i) => {
    const parsed = twitterText.parseTweet(t.text); // X-accurate weighted length (URLs=23, etc.)
    const len = parsed.weightedLength;
    const tag = `tweet ${i + 1}`;
    if (!parsed.valid || len > 280) {
      console.error(`✖ ${tag}: ${len}/280 weighted (invalid)`);
      ok = false;
    } else {
      console.log(`  ${tag}: ${len}/280 weighted${t.image ? " + image " + t.image : ""}`);
    }
    if (t.image) {
      const p = resolve(__dir, t.image);
      if (!existsSync(p)) {
        console.error(`✖ ${tag}: image not found: ${p}`);
        ok = false;
      }
    }
  });
  return ok;
}

async function main() {
  console.log(`\nStakedBots X publisher — ${DRY ? "DRY RUN" : FIRST_ONLY ? "FIRST ONLY" : "LIVE"}\n`);

  console.log("Validating content…");
  if (!validateContent()) {
    console.error("\nContent validation failed. Aborting.");
    process.exit(1);
  }

  console.log("\nLoading credentials from Proton Pass…");
  const creds = loadCreds();
  const client = new TwitterApi({
    appKey: creds.appKey,
    appSecret: creds.appSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessSecret,
  });

  // Verify identity + that the token can write.
  const me = await client.v2.me();
  console.log(`✓ Authenticated as @${me.data.username} (${me.data.name})`);

  if (DRY) {
    console.log("\nDRY RUN complete — credentials valid, content valid, nothing posted.");
    return;
  }

  const items = FIRST_ONLY ? THREAD.slice(0, 1) : THREAD;
  let replyTo = null;
  const posted = [];

  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    let mediaIds;
    if (t.image) {
      const p = resolve(__dir, t.image);
      console.log(`Uploading image for tweet ${i + 1}: ${t.image}…`);
      const id = await client.v1.uploadMedia(p);
      mediaIds = [id];
    }
    const payload = { text: t.text };
    if (mediaIds) payload.media = { media_ids: mediaIds };
    if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };

    const res = await client.v2.tweet(payload);
    replyTo = res.data.id;
    posted.push(res.data.id);
    console.log(`✓ Posted tweet ${i + 1}/${items.length} → id ${res.data.id}`);
  }

  const first = posted[0];
  console.log(`\nDone. Thread live:`);
  console.log(`  https://x.com/${me.data.username}/status/${first}`);
}

main().catch((e) => {
  console.error("\n✖ Publish failed:", e?.data ?? e?.message ?? e);
  process.exit(1);
});
