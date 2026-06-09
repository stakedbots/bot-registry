// One-shot: send a small amount of Base Sepolia ETH from your MetaMask
// wallet to the bot-registry deployer. Privkey is read ONLY from the
// TMP_PK env var, never written to disk.
//
//   TMP_PK=0xYourMetaMaskPrivateKey node scripts/send-to-deployer.js
//
// Optional env vars:
//   AMOUNT_ETH   default: 0.01
//   TO           default: process.env.DEPLOYER_ADDRESS
//   RPC          default: process.env.BASE_SEPOLIA_RPC
//
// After running, clear shell history if you care (`history -c`) — the
// privkey was in your shell's invocation. The script never writes it.

require("dotenv").config();
const { Wallet, JsonRpcProvider, parseEther, formatEther } = require("ethers");

const pk     = process.env.TMP_PK;
const to     = process.env.TO     || process.env.DEPLOYER_ADDRESS;
const amount = process.env.AMOUNT_ETH || "0.01";
const rpc    = process.env.RPC || process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

if (!pk)  { console.error("TMP_PK env var required (your MetaMask privkey, 0x...)"); process.exit(1); }
if (!to)  { console.error("TO env var or DEPLOYER_ADDRESS in .env required"); process.exit(1); }

(async () => {
  const provider = new JsonRpcProvider(rpc);
  const wallet   = new Wallet(pk, provider);

  const balBefore = await provider.getBalance(wallet.address);
  console.log("from:   ", wallet.address);
  console.log("balance:", formatEther(balBefore), "ETH");
  console.log("to:     ", to);
  console.log("amount: ", amount, "ETH");

  if (balBefore < parseEther(amount)) {
    console.error("\ninsufficient balance");
    process.exit(1);
  }

  const tx = await wallet.sendTransaction({ to, value: parseEther(amount) });
  console.log("\ntx sent:", tx.hash);
  console.log("waiting for confirmation…");
  const receipt = await tx.wait();
  console.log("confirmed in block:", receipt.blockNumber);

  const deployerBal = await provider.getBalance(to);
  console.log("\ndeployer balance now:", formatEther(deployerBal), "ETH");
})().catch(e => { console.error(e); process.exit(1); });
