// Test client: pays for an endpoint using the deployer wallet.
//
//   node scripts/test-pay.js [URL]
//
// Reads DEPLOYER_PRIVATE_KEY from ../../contracts/.env by default.
// Default URL: http://localhost:3000/bots/1/detail

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { createPublicClient, createWalletClient, http, formatUnits, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.join(__dirname, "..", "..", "contracts", ".env") });

const URL = process.argv[2] || "http://localhost:3000/bots/1/detail";
const PK  = process.env.DEPLOYER_PRIVATE_KEY;
const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

if (!PK) { console.error("DEPLOYER_PRIVATE_KEY not found in contracts/.env"); process.exit(1); }

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const account = privateKeyToAccount(PK);
const wallet  = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const pub     = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const usdcBal = (addr) =>
  pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [addr] });

const balBefore = await usdcBal(account.address);
console.log("client wallet: ", account.address);
console.log("USDC balance:  ", formatUnits(balBefore, 6), "USDC");
console.log("target URL:    ", URL);
console.log("\n→ fetch with x402 payment…\n");

const fetchWithPay = wrapFetchWithPayment(fetch, wallet);
const res = await fetchWithPay(URL);
const body = await res.json();

console.log("status:", res.status);
console.log("\nbody:\n", JSON.stringify(body, null, 2));

const paymentHeader = res.headers.get("x-payment-response");
if (paymentHeader) {
  console.log("\npayment response:", JSON.stringify(decodeXPaymentResponse(paymentHeader), null, 2));
}

// Wait a couple seconds for the on-chain settlement to land.
await new Promise((r) => setTimeout(r, 4000));
const balAfter = await usdcBal(account.address);
console.log("\nUSDC balance after:", formatUnits(balAfter, 6), "USDC");
console.log("paid:              ", formatUnits(balBefore - balAfter, 6), "USDC");
