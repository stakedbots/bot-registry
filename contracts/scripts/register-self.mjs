// Self-register: the bot's hot wallet registers itself into the Registry
// and links itself as its own trading wallet. Designed to be run from the
// bot's existing working directory (so dotenv picks up its .env with the
// HOT_WALLET_PRIVATE_KEY).
//
//   cd /root/ai-trading-bot
//   BOT_NAME="thesis-llm" BOT_STRATEGY="..." BOT_BENCHMARK="..." \
//   node /tmp/register-self.mjs
//
import "dotenv/config";
import {
  JsonRpcProvider, Wallet, Contract,
  keccak256, toUtf8Bytes, MaxUint256, formatUnits,
} from "ethers";

const REGISTRY = "0x86c1934e05d8bE878D012bd121553802BA8FE0D8";
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC      = "https://mainnet.base.org";

const ABI_REG = [
  "function minStake() view returns (uint256)",
  "function register(string,bytes32,uint256) returns (uint256)",
  "function linkWallet(uint256,address) external",
  "function attestMission(uint256,string,bytes32,string) external",
  "event BotRegistered(uint256 indexed botId, address indexed operator, string manifestURI, bytes32 manifestHash, uint256 stake)",
];
const ABI_USDC = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const PK        = process.env.HOT_WALLET_PRIVATE_KEY;
const NAME      = process.env.BOT_NAME;
const STRATEGY  = process.env.BOT_STRATEGY || "(unspecified)";
const BENCHMARK = process.env.BOT_BENCHMARK || "(unspecified)";
const EPOCH     = process.env.ATTEST_EPOCH || new Date().toISOString().slice(0, 10);

if (!PK)   throw new Error("HOT_WALLET_PRIVATE_KEY not found in env / .env");
if (!NAME) throw new Error("BOT_NAME env required");

const provider = new JsonRpcProvider(RPC);
const wallet   = new Wallet(PK, provider);
const registry = new Contract(REGISTRY, ABI_REG, wallet);
const usdc     = new Contract(USDC, ABI_USDC, wallet);

console.log("self:    ", wallet.address);
const minStake = await registry.minStake();
const usdcBal  = await usdc.balanceOf(wallet.address);
console.log("USDC:    ", formatUnits(usdcBal, 6));
console.log("minStake:", formatUnits(minStake, 6), "USDC");
if (usdcBal < minStake) throw new Error(`insufficient USDC (have ${formatUnits(usdcBal,6)}, need ${formatUnits(minStake,6)})`);

const manifest = {
  name: NAME,
  strategy: STRATEGY,
  benchmark: BENCHMARK,
  chain: "base",
  operator: wallet.address,
  trading_wallet: wallet.address,
  version: 1,
};
const manifestJson = JSON.stringify(manifest);
const manifestHash = keccak256(toUtf8Bytes(manifestJson));
const manifestURI  = `inline:${NAME}-self-v1`;

console.log("\nmanifest:");
console.log("  uri: ", manifestURI);
console.log("  hash:", manifestHash);

const allowance = await usdc.allowance(wallet.address, REGISTRY);
if (allowance < minStake) {
  console.log("\n[1/4] approve USDC…");
  const tx = await usdc.approve(REGISTRY, MaxUint256);
  console.log("      tx:", tx.hash);
  await tx.wait();
} else {
  console.log("\n[1/4] allowance ok, skip approve");
}

console.log("\n[2/4] register…");
const tx2 = await registry.register(manifestURI, manifestHash, minStake);
console.log("      tx:", tx2.hash);
const r2 = await tx2.wait();
let botId = null;
for (const log of r2.logs) {
  try {
    const parsed = registry.interface.parseLog(log);
    if (parsed?.name === "BotRegistered") { botId = parsed.args.botId; break; }
  } catch {}
}
if (!botId) throw new Error("BotRegistered event not parsed");
console.log("      on-chain bot id:", botId.toString());

console.log("\n[3/4] linkWallet (self)…");
const tx3 = await registry.linkWallet(botId, wallet.address);
console.log("      tx:", tx3.hash);
await tx3.wait();

console.log(`\n[4/4] attestMission for epoch ${EPOCH}…`);
const strategyHash = keccak256(toUtf8Bytes(`${NAME}:${STRATEGY}:${EPOCH}`));
const tx4 = await registry.attestMission(botId, EPOCH, strategyHash, manifestURI);
console.log("      tx:", tx4.hash);
await tx4.wait();

console.log("\n✓ self-registered");
console.log("  bot id:", botId.toString());
console.log("  operator = trading wallet =", wallet.address);
console.log("  events: https://basescan.org/address/" + REGISTRY + "#events");
