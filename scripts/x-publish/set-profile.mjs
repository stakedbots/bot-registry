#!/usr/bin/env node
// Update @stakedbots profile avatar + banner via the X API (OAuth 1.0a).
// Reads the same Proton Pass creds as publish.mjs.
//
// Usage:
//   node set-profile.mjs --avatar <path> --banner <path>
//   node set-profile.mjs --avatar media/avatar_400x400.png   # only avatar
//   node set-profile.mjs --banner media/banner_1500x500.png  # only banner
//
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TwitterApi } from "twitter-api-v2";

const __dir = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = "/tmp/pass-agent-claude-main";
const ITEM = "X API stakedbots";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function loadCreds() {
  const out = execFileSync(
    "pass-cli",
    ["item", "view", "--vault-name", "Claude", "--item-title", ITEM, "--output", "json"],
    {
      env: {
        ...process.env,
        PROTON_PASS_SESSION_DIR: SESSION_DIR,
        PROTON_PASS_AGENT_REASON: "actualizar avatar y banner del perfil @stakedbots",
      },
      encoding: "utf8",
    }
  );
  const item = JSON.parse(out);
  const content = item?.item?.content ?? item?.content ?? {};
  const login = content?.content?.Login ?? {};
  const note = content?.note ?? "";
  const get = (k) => (note.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, "m"))?.[1] ?? "").trim();
  return {
    appKey: (login.username ?? "").trim(),
    appSecret: (login.password ?? "").trim(),
    accessToken: get("ACCESS_TOKEN"),
    accessSecret: get("ACCESS_TOKEN_SECRET"),
  };
}

async function main() {
  const avatar = arg("--avatar");
  const banner = arg("--banner");
  const hasText = ["--bio", "--url", "--location", "--link-color"].some((f) => arg(f));
  if (!avatar && !banner && !hasText) {
    console.error("Nothing to do. Pass --avatar/--banner and/or --bio/--url/--location/--link-color.");
    process.exit(1);
  }
  for (const [label, p] of [["avatar", avatar], ["banner", banner]]) {
    if (p && !existsSync(resolve(__dir, p))) {
      console.error(`✖ ${label} file not found: ${p}`);
      process.exit(1);
    }
  }

  const client = new TwitterApi(loadCreds());
  const me = await client.v2.me();
  console.log(`✓ Authenticated as @${me.data.username}`);

  if (avatar) {
    console.log(`Uploading avatar: ${avatar}…`);
    await client.v1.updateAccountProfileImage(resolve(__dir, avatar));
    console.log("✓ Profile image updated");
  }
  if (banner) {
    console.log(`Uploading banner: ${banner}…`);
    await client.v1.updateAccountProfileBanner(resolve(__dir, banner));
    console.log("✓ Profile banner updated");
  }

  const bio = arg("--bio");
  const url = arg("--url");
  const location = arg("--location");
  const linkColor = arg("--link-color");
  const profile = {};
  if (bio) profile.description = bio;
  if (url) profile.url = url;
  if (location) profile.location = location;
  if (linkColor) profile.profile_link_color = linkColor;
  if (Object.keys(profile).length) {
    if (profile.description && [...profile.description].length > 160) {
      console.error(`✖ bio is ${[...profile.description].length} chars (>160)`);
      process.exit(1);
    }
    console.log("Updating profile text…");
    await client.v1.updateAccountProfile(profile);
    console.log("✓ Profile text updated (" + Object.keys(profile).join(", ") + ")");
  }

  console.log(`\nDone → https://x.com/${me.data.username}`);
}

main().catch((e) => {
  console.error("\n✖ Profile update failed:", e?.data ?? e?.message ?? e);
  process.exit(1);
});
