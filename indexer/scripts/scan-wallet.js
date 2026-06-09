// One-off: scan ERC20 Transfer events touching a given wallet on a range
// of blocks. Useful for verifying the indexer's chain-reading without
// touching the DB.
//
//   node scripts/scan-wallet.js <walletAddress> [fromBlock] [toBlock]
//
import "dotenv/config";
import { createPublicClient, http, parseAbi, getAddress, formatUnits } from "viem";
import { baseSepolia, base } from "viem/chains";

const [, , wallet, fromBlockArg, toBlockArg] = process.argv;
if (!wallet) {
  console.error("usage: node scripts/scan-wallet.js <wallet> [fromBlock] [toBlock]");
  process.exit(1);
}

const chain = process.env.CHAIN === "base" ? base : baseSepolia;
const client = createPublicClient({ chain, transport: http(process.env.RPC_URL) });
const TRANSFER = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const addr = getAddress(wallet);
const head = await client.getBlockNumber();
const fromBlock = fromBlockArg ? BigInt(fromBlockArg) : head - 5000n;
const toBlock = toBlockArg ? BigInt(toBlockArg) : head;

console.log(`chain:  ${chain.name}`);
console.log(`wallet: ${addr}`);
console.log(`range:  ${fromBlock} → ${toBlock} (${toBlock - fromBlock} blocks)`);

const BATCH = 1900n;
const out = [];
const inn = [];
let cur = fromBlock;
while (cur <= toBlock) {
  const to = cur + BATCH - 1n > toBlock ? toBlock : cur + BATCH - 1n;
  const [o, i] = await Promise.all([
    client.getLogs({ event: TRANSFER[0], args: { from: addr }, fromBlock: cur, toBlock: to }),
    client.getLogs({ event: TRANSFER[0], args: { to: addr }, fromBlock: cur, toBlock: to }),
  ]);
  out.push(...o);
  inn.push(...i);
  cur = to + 1n;
}

console.log(`\nfound ${out.length} outgoing, ${inn.length} incoming`);
for (const ev of [...out, ...inn].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1))) {
  const isOut = ev.args.from.toLowerCase() === addr.toLowerCase();
  const direction = isOut ? "OUT" : "IN ";
  const counterparty = isOut ? ev.args.to : ev.args.from;
  console.log(`  block=${ev.blockNumber} ${direction} token=${ev.address.slice(0,6)}… amount=${ev.args.value} ↔ ${counterparty.slice(0,6)}… tx=${ev.transactionHash.slice(0,10)}…`);
}
