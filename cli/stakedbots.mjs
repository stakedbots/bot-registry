#!/usr/bin/env node
// stakedbots CLI — self-registration for autonomous bot operators.
//
// The bot's own trading wallet registers itself: operator = trading wallet.
// No intermediary, no signup. You need ≥ 10 USDC + a little ETH for gas on
// Base mainnet in the bot's wallet.
//
//   node stakedbots.mjs status              what the registry knows about this wallet
//   node stakedbots.mjs register            approve → register → linkWallet → attestMission
//   node stakedbots.mjs attest              attest today's mission (re-commit strategy)
//   node stakedbots.mjs unlink              unlink this wallet from a previous/withdrawn bot
//
// Config via env (or a .env file next to this script):
//   HOT_WALLET_PRIVATE_KEY   required. the bot's trading wallet key
//   BOT_NAME                 required for register/attest. e.g. "my-momentum-bot"
//   BOT_STRATEGY             short strategy description you commit to
//   BOT_BENCHMARK            what you measure yourself against, e.g. "HODL 50/50 USDC/ETH"
//   STAKE_USDC               optional, default = contract minStake (10 USDC)
//   MANIFEST_URI             optional, e.g. ipfs://… — defaults to inline:<name>-self-v1
//   ATTEST_EPOCH             optional, default = today UTC (YYYY-MM-DD)
//   BOT_ID                   optional, for attest/unlink when auto-detection isn't enough
//
import "dotenv/config";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseUnits,
  keccak256, stringToHex, formatUnits, decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY = "0x86c1934e05d8bE878D012bd121553802BA8FE0D8";
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const REG_ABI = parseAbi([
  "function minStake() view returns (uint256)",
  "function walletToBotId(address) view returns (uint256)",
  "function bots(uint256) view returns (address operator, string manifestURI, bytes32 manifestHash, uint256 stake, uint64 registeredAt, bool active)",
  "function register(string manifestURI, bytes32 manifestHash, uint256 stake) returns (uint256)",
  "function linkWallet(uint256 botId, address wallet)",
  "function unlinkWallet(uint256 botId, address wallet)",
  "function attestMission(uint256 botId, string epochId, bytes32 strategyHash, string manifestURI)",
  "event BotRegistered(uint256 indexed botId, address indexed operator, string manifestURI, bytes32 manifestHash, uint256 stake)",
]);
const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const cmd = process.argv[2];
if (!["status", "register", "attest", "unlink"].includes(cmd ?? "")) {
  console.log("usage: node stakedbots.mjs <status|register|attest|unlink>");
  process.exit(1);
}

const PK = process.env.HOT_WALLET_PRIVATE_KEY;
if (!PK) die("HOT_WALLET_PRIVATE_KEY missing (env or .env)");
const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const rpc = process.env.RPC_URL ? http(process.env.RPC_URL) : http();
const pub = createPublicClient({ chain: base, transport: rpc });
const wlt = createWalletClient({ account, chain: base, transport: rpc });

const NAME      = process.env.BOT_NAME;
const STRATEGY  = process.env.BOT_STRATEGY  || "(unspecified)";
const BENCHMARK = process.env.BOT_BENCHMARK || "(unspecified)";
const EPOCH     = process.env.ATTEST_EPOCH  || new Date().toISOString().slice(0, 10);

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

async function send(label, params) {
  console.log(`→ ${label}…`);
  const hash = await wlt.writeContract(params);
  console.log(`  tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`${label} reverted (tx ${hash})`);
  return receipt;
}

async function readSelf() {
  const [minStake, usdcBal, ethBal, linkedBotId] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: REG_ABI, functionName: "minStake" }),
    pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [account.address] }),
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: REGISTRY, abi: REG_ABI, functionName: "walletToBotId", args: [account.address] }),
  ]);
  return { minStake, usdcBal, ethBal, linkedBotId };
}

async function readBot(botId) {
  const [operator, manifestURI, manifestHash, stake, registeredAt, active] =
    await pub.readContract({ address: REGISTRY, abi: REG_ABI, functionName: "bots", args: [botId] });
  return { operator, manifestURI, manifestHash, stake, registeredAt, active };
}

function buildManifest() {
  const manifest = {
    name: NAME,
    strategy: STRATEGY,
    benchmark: BENCHMARK,
    chain: "base",
    operator: account.address,
    trading_wallet: account.address,
    version: 1,
  };
  const json = JSON.stringify(manifest);
  return {
    manifest,
    json,
    hash: keccak256(stringToHex(json)),
    uri: process.env.MANIFEST_URI || `inline:${NAME}-self-v1`,
  };
}

// ─── status ────────────────────────────────────────────────────────────────

if (cmd === "status") {
  const s = await readSelf();
  console.log("wallet:   ", account.address);
  console.log("ETH:      ", formatUnits(s.ethBal, 18));
  console.log("USDC:     ", formatUnits(s.usdcBal, 6));
  console.log("minStake: ", formatUnits(s.minStake, 6), "USDC");
  if (s.linkedBotId === 0n) {
    console.log("linked:    no — this wallet is not linked to any bot");
  } else {
    const bot = await readBot(s.linkedBotId);
    console.log("linked:    bot #" + s.linkedBotId.toString());
    console.log("  operator:", bot.operator, bot.operator.toLowerCase() === account.address.toLowerCase() ? "(self)" : "");
    console.log("  stake:   ", formatUnits(bot.stake, 6), "USDC");
    console.log("  active:  ", bot.active);
    console.log("  manifest:", bot.manifestURI);
    console.log("  https://stakedbots.com — leaderboard refreshes ~5 min after on-chain events");
  }
  process.exit(0);
}

// ─── unlink ────────────────────────────────────────────────────────────────

if (cmd === "unlink") {
  const s = await readSelf();
  const botId = process.env.BOT_ID ? BigInt(process.env.BOT_ID) : s.linkedBotId;
  if (botId === 0n) die("wallet is not linked to any bot (nothing to unlink)");
  const bot = await readBot(botId);
  if (bot.operator.toLowerCase() !== account.address.toLowerCase()) {
    die(`bot #${botId} is operated by ${bot.operator} — only the operator can unlink. ` +
        `Run this from the operator wallet with BOT_ID=${botId}.`);
  }
  await send(`unlinkWallet(bot #${botId}, self)`, {
    address: REGISTRY, abi: REG_ABI, functionName: "unlinkWallet",
    args: [botId, account.address],
  });
  console.log("✓ unlinked — the wallet can now be linked to a new bot");
  process.exit(0);
}

// ─── attest ────────────────────────────────────────────────────────────────

if (cmd === "attest") {
  if (!NAME) die("BOT_NAME required");
  const s = await readSelf();
  const botId = process.env.BOT_ID ? BigInt(process.env.BOT_ID) : s.linkedBotId;
  if (botId === 0n) die("wallet not linked to a bot — run `register` first, or set BOT_ID");
  const bot = await readBot(botId);
  if (!bot.active) die(`bot #${botId} is not active`);
  if (bot.operator.toLowerCase() !== account.address.toLowerCase()) {
    die(`bot #${botId} is operated by ${bot.operator}, not this wallet`);
  }
  const m = buildManifest();
  const strategyHash = keccak256(stringToHex(`${NAME}:${STRATEGY}:${EPOCH}`));
  await send(`attestMission(bot #${botId}, epoch ${EPOCH})`, {
    address: REGISTRY, abi: REG_ABI, functionName: "attestMission",
    args: [botId, EPOCH, strategyHash, m.uri],
  });
  console.log(`✓ mission attested for epoch ${EPOCH}`);
  process.exit(0);
}

// ─── register ──────────────────────────────────────────────────────────────

if (!NAME) die("BOT_NAME required (short slug, e.g. my-momentum-bot)");
const s = await readSelf();
const stake = process.env.STAKE_USDC ? parseUnits(process.env.STAKE_USDC, 6) : s.minStake;

console.log("wallet:   ", account.address);
console.log("USDC:     ", formatUnits(s.usdcBal, 6));
console.log("stake:    ", formatUnits(stake, 6), "USDC (min", formatUnits(s.minStake, 6) + ")");

if (stake < s.minStake) die(`stake below minStake (${formatUnits(s.minStake, 6)} USDC)`);
if (s.usdcBal < stake) die(`insufficient USDC — need ${formatUnits(stake, 6)}, have ${formatUnits(s.usdcBal, 6)}`);
if (s.ethBal === 0n) die("no ETH for gas on Base — send a little (~0.0005 ETH) to the wallet");

// A wallet can only be linked to one bot at a time. If it's still linked to an
// old (e.g. withdrawn) bot, linkWallet would revert with WalletAlreadyLinked.
if (s.linkedBotId !== 0n) {
  const bot = await readBot(s.linkedBotId);
  if (bot.active && bot.operator.toLowerCase() === account.address.toLowerCase()) {
    console.log(`\n✓ already registered as bot #${s.linkedBotId} (active, self-operated)`);
    console.log("  use `node stakedbots.mjs attest` to commit today's mission");
    process.exit(0);
  }
  die(`this wallet is still linked to bot #${s.linkedBotId} (active=${bot.active}, operator=${bot.operator}).\n` +
      `  Unlink it first — from the operator wallet: BOT_ID=${s.linkedBotId} node stakedbots.mjs unlink`);
}

const m = buildManifest();
console.log("\nmanifest (keep a copy — its keccak256 hash goes on-chain):");
console.log(" ", m.json);
console.log("  uri: ", m.uri);
console.log("  hash:", m.hash);
console.log("");

// 1. approve
const allowance = await pub.readContract({
  address: USDC, abi: USDC_ABI, functionName: "allowance",
  args: [account.address, REGISTRY],
});
if (allowance < stake) {
  await send(`[1/4] approve ${formatUnits(stake, 6)} USDC`, {
    address: USDC, abi: USDC_ABI, functionName: "approve",
    args: [REGISTRY, stake],
  });
} else {
  console.log("[1/4] allowance ok, skipping approve");
}

// 2. register
const r = await send("[2/4] register", {
  address: REGISTRY, abi: REG_ABI, functionName: "register",
  args: [m.uri, m.hash, stake],
});
let botId = null;
for (const log of r.logs) {
  try {
    const ev = decodeEventLog({ abi: REG_ABI, ...log });
    if (ev.eventName === "BotRegistered") { botId = ev.args.botId; break; }
  } catch {}
}
if (botId === null) die("BotRegistered event not found in receipt");
console.log("  on-chain bot id:", botId.toString());

// 3. link own wallet
await send("[3/4] linkWallet (self)", {
  address: REGISTRY, abi: REG_ABI, functionName: "linkWallet",
  args: [botId, account.address],
});

// 4. attest first mission
const strategyHash = keccak256(stringToHex(`${NAME}:${STRATEGY}:${EPOCH}`));
await send(`[4/4] attestMission (epoch ${EPOCH})`, {
  address: REGISTRY, abi: REG_ABI, functionName: "attestMission",
  args: [botId, EPOCH, strategyHash, m.uri],
});

console.log("\n✓ registered & live");
console.log("  bot id:  ", botId.toString());
console.log("  operator = trading wallet =", account.address);
console.log("  contract: https://basescan.org/address/" + REGISTRY);
console.log("  the indexer picks you up within ~5 minutes → https://stakedbots.com");
console.log("  re-attest your mission per epoch: node stakedbots.mjs attest");
