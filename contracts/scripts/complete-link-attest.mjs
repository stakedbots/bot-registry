// One-off: a wallet that's already registered as a bot operator finishes
// linking itself + attesting. Used when a previous register() succeeded but
// linkWallet reverted (e.g. wallet was still linked to a withdrawn bot).
//
//   cd /root/ai-trading-bot
//   BOT_ID=3 BOT_NAME=thesis-llm BOT_STRATEGY="…" \
//     node .complete-link-attest.mjs
//
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY = "0x86c1934e05d8bE878D012bd121553802BA8FE0D8";
const REG_ABI  = parseAbi([
  "function linkWallet(uint256 botId, address wallet)",
  "function attestMission(uint256 botId, string epochId, bytes32 strategyHash, string manifestURI)",
]);

const PK       = process.env.HOT_WALLET_PRIVATE_KEY;
const BOT_ID   = BigInt(process.env.BOT_ID || (() => { throw new Error("BOT_ID env required") })());
const NAME     = process.env.BOT_NAME || "(unspecified)";
const STRATEGY = process.env.BOT_STRATEGY || "(unspecified)";
const EPOCH    = process.env.ATTEST_EPOCH || new Date().toISOString().slice(0, 10);

const pk = PK.startsWith("0x") ? PK : `0x${PK}`;
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: base, transport: http() });
const wlt = createWalletClient({ account, chain: base, transport: http() });

console.log("wallet:", account.address);
console.log("bot id:", BOT_ID.toString());

console.log("\n[1/2] linkWallet…");
const h1 = await wlt.writeContract({
  address: REGISTRY, abi: REG_ABI, functionName: "linkWallet",
  args: [BOT_ID, account.address],
});
console.log("      tx:", h1);
await pub.waitForTransactionReceipt({ hash: h1 });

console.log(`\n[2/2] attestMission for epoch ${EPOCH}…`);
const strategyHash = keccak256(stringToHex(`${NAME}:${STRATEGY}:${EPOCH}`));
const manifestURI  = `inline:${NAME}-self-v1`;
const h2 = await wlt.writeContract({
  address: REGISTRY, abi: REG_ABI, functionName: "attestMission",
  args: [BOT_ID, EPOCH, strategyHash, manifestURI],
});
console.log("      tx:", h2);
await pub.waitForTransactionReceipt({ hash: h2 });

console.log("\n✓ complete");
