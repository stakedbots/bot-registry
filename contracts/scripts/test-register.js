// End-to-end test against the deployed Registry on Base Sepolia.
//   approve → register → linkWallet → attestMission
//
//   npx hardhat run scripts/test-register.js --network baseSepolia
//
// Requires the deployer to hold at least minStake of Sepolia USDC.
// Faucet: https://faucet.circle.com  (Base Sepolia → paste deployer address)

const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const RECORD_PATH = path.join(__dirname, "..", "addresses", "baseSepolia.json");
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

async function main() {
  const { ethers } = hre;
  const record = JSON.parse(fs.readFileSync(RECORD_PATH, "utf8"));
  const REGISTRY = record.registry;
  const USDC = record.stakeToken;

  const [signer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("Registry", REGISTRY, signer);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);

  const minStake = await registry.minStake();
  const usdcBal = await usdc.balanceOf(signer.address);
  console.log("signer:        ", signer.address);
  console.log("registry:      ", REGISTRY);
  console.log("usdc:          ", USDC);
  console.log("minStake:      ", `${Number(minStake) / 1e6} USDC`);
  console.log("usdc balance:  ", `${Number(usdcBal) / 1e6} USDC`);

  if (usdcBal < minStake) {
    console.error(`\nInsufficient USDC. Need ${Number(minStake)/1e6}, have ${Number(usdcBal)/1e6}.`);
    console.error("Faucet: https://faucet.circle.com  (Base Sepolia, paste:", signer.address, ")");
    process.exit(1);
  }

  // Manifest — dummy for the test. Real manifests get published to IPFS.
  const manifest = {
    name: "test-bot-sepolia-e2e",
    strategy: "dummy — end-to-end deploy validation, no real trading",
    benchmark: "none",
    chain: "base-sepolia",
    operator: signer.address,
    version: 1,
    created_at: "test-run",
  };
  const manifestJson = JSON.stringify(manifest, null, 0);
  const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(manifestJson));
  const manifestURI  = "ipfs://test-manifest-placeholder";

  // 1. Approve
  const allowance = await usdc.allowance(signer.address, REGISTRY);
  if (allowance < minStake) {
    console.log("\n[1/4] approving USDC (MaxUint256)…");
    const tx = await usdc.approve(REGISTRY, ethers.MaxUint256);
    console.log("      tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("\n[1/4] allowance already sufficient, skipping approve.");
  }

  // 2. Register
  console.log("\n[2/4] registering bot…");
  const tx2 = await registry.register(manifestURI, manifestHash, minStake);
  console.log("      tx:", tx2.hash);
  const r2 = await tx2.wait();
  let botId;
  for (const log of r2.logs) {
    try {
      const parsed = registry.interface.parseLog(log);
      if (parsed.name === "BotRegistered") { botId = parsed.args.botId; break; }
    } catch {}
  }
  if (!botId) throw new Error("BotRegistered event not found");
  console.log("      bot id:", botId.toString());

  // 3. Link a dummy trading wallet
  const dummyWallet = ethers.Wallet.createRandom().address;
  console.log("\n[3/4] linking dummy wallet", dummyWallet, "…");
  const tx3 = await registry.linkWallet(botId, dummyWallet);
  console.log("      tx:", tx3.hash);
  await tx3.wait();

  // 4. Attest a mission for today's epoch
  const epoch = new Date().toISOString().slice(0, 10);
  const strategyHash = ethers.keccak256(ethers.toUtf8Bytes(`${manifest.name}-strategy-${epoch}`));
  const missionURI = "ipfs://test-mission-placeholder";
  console.log("\n[4/4] attesting mission for epoch", epoch, "…");
  const tx4 = await registry.attestMission(botId, epoch, strategyHash, missionURI);
  console.log("      tx:", tx4.hash);
  await tx4.wait();

  // Final sanity read
  const bot = await registry.bots(botId);
  const linked = await registry.getWallets(botId);
  console.log("\n✓ end-to-end OK");
  console.log("  bot.operator:    ", bot.operator);
  console.log("  bot.stake:       ", `${Number(bot.stake)/1e6} USDC`);
  console.log("  bot.active:      ", bot.active);
  console.log("  bot.manifestURI: ", bot.manifestURI);
  console.log("  linked wallets:  ", linked);
  console.log("\nevents:");
  console.log(`  https://sepolia.basescan.org/address/${REGISTRY}#events`);
}

main().catch(e => { console.error(e); process.exit(1); });
