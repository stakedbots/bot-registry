// Self-register: bot's hot wallet registers itself into stakedbots Registry.
// Uses viem (matches the bot's existing stack). Designed to be dropped INTO
// the bot's working dir so node_modules resolves cleanly.
//
//   cp register-self-viem.mjs /root/ai-trading-bot/
//   cd /root/ai-trading-bot
//   BOT_NAME="thesis-llm" BOT_STRATEGY="..." BOT_BENCHMARK="..." \
//     node register-self-viem.mjs
//
import "dotenv/config";
import {
  createPublicClient, createWalletClient, http, parseAbi,
  keccak256, toHex, stringToHex, maxUint256, formatUnits, getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY = "0x86c1934e05d8bE878D012bd121553802BA8FE0D8";
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const REG_ABI = parseAbi([
  "function minStake() view returns (uint256)",
  "function register(string manifestURI, bytes32 manifestHash, uint256 stake) returns (uint256)",
  "function linkWallet(uint256 botId, address wallet)",
  "function attestMission(uint256 botId, string epochId, bytes32 strategyHash, string manifestURI)",
  "event BotRegistered(uint256 indexed botId, address indexed operator, string manifestURI, bytes32 manifestHash, uint256 stake)",
]);
const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const PK        = process.env.HOT_WALLET_PRIVATE_KEY;
const NAME      = process.env.BOT_NAME;
const STRATEGY  = process.env.BOT_STRATEGY  || "(unspecified)";
const BENCHMARK = process.env.BOT_BENCHMARK || "(unspecified)";
const EPOCH     = process.env.ATTEST_EPOCH  || new Date().toISOString().slice(0, 10);

if (!PK)   throw new Error("HOT_WALLET_PRIVATE_KEY missing");
if (!NAME) throw new Error("BOT_NAME env required");

const pk = PK.startsWith("0x") ? PK : `0x${PK}`;
const account = privateKeyToAccount(pk);
const pub  = createPublicClient({ chain: base, transport: http() });
const wlt  = createWalletClient({ account, chain: base, transport: http() });

console.log("self:    ", account.address);
const [minStake, usdcBal] = await Promise.all([
  pub.readContract({ address: REGISTRY, abi: REG_ABI, functionName: "minStake" }),
  pub.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [account.address] }),
]);
console.log("USDC:    ", formatUnits(usdcBal, 6));
console.log("minStake:", formatUnits(minStake, 6), "USDC");
if (usdcBal < minStake) throw new Error("insufficient USDC");

const manifest = {
  name: NAME,
  strategy: STRATEGY,
  benchmark: BENCHMARK,
  chain: "base",
  operator: account.address,
  trading_wallet: account.address,
  version: 1,
};
const manifestJson = JSON.stringify(manifest);
const manifestHash = keccak256(stringToHex(manifestJson));
const manifestURI  = `inline:${NAME}-self-v1`;

console.log("\nmanifest:");
console.log("  uri: ", manifestURI);
console.log("  hash:", manifestHash);

// 1. Approve
const allowance = await pub.readContract({
  address: USDC, abi: USDC_ABI, functionName: "allowance",
  args: [account.address, REGISTRY],
});
if (allowance < minStake) {
  console.log("\n[1/4] approve USDC…");
  const hash = await wlt.writeContract({
    address: USDC, abi: USDC_ABI, functionName: "approve",
    args: [REGISTRY, maxUint256],
  });
  console.log("      tx:", hash);
  await pub.waitForTransactionReceipt({ hash });
} else {
  console.log("\n[1/4] allowance ok, skip approve");
}

// 2. Register
console.log("\n[2/4] register…");
const hash2 = await wlt.writeContract({
  address: REGISTRY, abi: REG_ABI, functionName: "register",
  args: [manifestURI, manifestHash, minStake],
});
console.log("      tx:", hash2);
const r2 = await pub.waitForTransactionReceipt({ hash: hash2 });
let botId = null;
for (const log of r2.logs) {
  try {
    const ev = await import("viem").then(m => m.decodeEventLog({ abi: REG_ABI, ...log }));
    if (ev?.eventName === "BotRegistered") { botId = ev.args.botId; break; }
  } catch {}
}
if (botId === null) throw new Error("BotRegistered event not parsed");
console.log("      on-chain bot id:", botId.toString());

// 3. Link self
console.log("\n[3/4] linkWallet (self)…");
const hash3 = await wlt.writeContract({
  address: REGISTRY, abi: REG_ABI, functionName: "linkWallet",
  args: [botId, account.address],
});
console.log("      tx:", hash3);
await pub.waitForTransactionReceipt({ hash: hash3 });

// 4. Attest mission
console.log(`\n[4/4] attestMission for epoch ${EPOCH}…`);
const strategyHash = keccak256(stringToHex(`${NAME}:${STRATEGY}:${EPOCH}`));
const hash4 = await wlt.writeContract({
  address: REGISTRY, abi: REG_ABI, functionName: "attestMission",
  args: [botId, EPOCH, strategyHash, manifestURI],
});
console.log("      tx:", hash4);
await pub.waitForTransactionReceipt({ hash: hash4 });

console.log("\n✓ self-registered");
console.log("  bot id:", botId.toString());
console.log("  operator = trading wallet =", account.address);
console.log("  https://basescan.org/address/" + REGISTRY + "#events");
