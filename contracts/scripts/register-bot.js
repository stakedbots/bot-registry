// Register a bot against the deployed Registry.
//
//   BOT_NAME="thesis-llm" BOT_WALLET=0x... STAKE_USDC=100 \
//   BOT_STRATEGY="LLM-driven thesis trades, 20min cycle, benchmark HODL 50/50 USDC/cbBTC" \
//   BOT_BENCHMARK="HODL 50/50 USDC/cbBTC" \
//   npx hardhat run scripts/register-bot.js --network base
//
// Required env:
//   BOT_NAME       — short slug
//   BOT_WALLET     — the trading wallet to link (the bot's hot wallet)
//
// Optional env:
//   STAKE_USDC     — defaults to the contract's minStake
//   BOT_STRATEGY   — free-text strategy description for the manifest
//   BOT_BENCHMARK  — benchmark name (e.g. "HODL 50/50 USDC/cbBTC")
//   ATTEST_EPOCH   — if set, attest a first mission for this epoch id
//                    (default: today's date YYYY-MM-DD when ATTEST=1)
//   ATTEST         — set to 1 to attest a first mission

const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

async function main() {
  const { ethers, network } = hre;
  const netName = network.name;
  const recordPath = path.join(__dirname, "..", "addresses", `${netName}.json`);
  if (!fs.existsSync(recordPath)) {
    throw new Error(`no addresses/${netName}.json — deploy first.`);
  }
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const REGISTRY = record.registry;
  const USDC = record.stakeToken;

  const BOT_NAME = process.env.BOT_NAME;
  const BOT_WALLET = process.env.BOT_WALLET;
  if (!BOT_NAME)   throw new Error("BOT_NAME env required");
  if (!BOT_WALLET) throw new Error("BOT_WALLET env required");
  if (!ethers.isAddress(BOT_WALLET)) throw new Error(`BOT_WALLET is not a valid address: ${BOT_WALLET}`);

  const [signer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("Registry", REGISTRY, signer);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);

  const minStake = await registry.minStake();
  const stake = process.env.STAKE_USDC
    ? BigInt(Math.round(parseFloat(process.env.STAKE_USDC) * 1e6))
    : minStake;
  if (stake < minStake) {
    throw new Error(`stake ${Number(stake)/1e6} USDC < minStake ${Number(minStake)/1e6} USDC`);
  }

  const usdcBal = await usdc.balanceOf(signer.address);
  console.log("network:    ", netName);
  console.log("signer:     ", signer.address);
  console.log("registry:   ", REGISTRY);
  console.log("usdc:       ", USDC);
  console.log("usdc bal:   ", `${Number(usdcBal)/1e6} USDC`);
  console.log("stake:      ", `${Number(stake)/1e6} USDC`);
  console.log("bot name:   ", BOT_NAME);
  console.log("bot wallet: ", BOT_WALLET);

  if (usdcBal < stake) {
    throw new Error(`signer has ${Number(usdcBal)/1e6} USDC, need ${Number(stake)/1e6}`);
  }

  // Manifest — kept simple, inline. Real manifests should be IPFS-pinned.
  const manifest = {
    name: BOT_NAME,
    strategy: process.env.BOT_STRATEGY || "(unspecified)",
    benchmark: process.env.BOT_BENCHMARK || "(unspecified)",
    chain: netName,
    operator: signer.address,
    trading_wallet: BOT_WALLET,
    version: 1,
  };
  const manifestJson = JSON.stringify(manifest, null, 0);
  const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(manifestJson));
  // Placeholder URI; we publish later or use a service for IPFS pinning.
  const manifestURI = `inline:${BOT_NAME}-v1`;

  console.log("manifest:");
  console.log("  uri:  ", manifestURI);
  console.log("  hash: ", manifestHash);

  // 1. Approve
  const allowance = await usdc.allowance(signer.address, REGISTRY);
  if (allowance < stake) {
    console.log("\n[1/3] approving USDC…");
    const tx = await usdc.approve(REGISTRY, ethers.MaxUint256);
    console.log("      tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("\n[1/3] allowance already sufficient.");
  }

  // 2. Register
  console.log("\n[2/3] registering bot…");
  const tx2 = await registry.register(manifestURI, manifestHash, stake);
  console.log("      tx:", tx2.hash);
  const r2 = await tx2.wait();
  let botId;
  for (const log of r2.logs) {
    try {
      const parsed = registry.interface.parseLog(log);
      if (parsed.name === "BotRegistered") { botId = parsed.args.botId; break; }
    } catch {}
  }
  if (!botId) throw new Error("BotRegistered event not parsed");
  console.log("      on-chain bot id:", botId.toString());

  // 3. Link trading wallet
  console.log("\n[3/3] linking trading wallet…");
  const tx3 = await registry.linkWallet(botId, BOT_WALLET);
  console.log("      tx:", tx3.hash);
  await tx3.wait();

  // Optional: attest first mission
  if (process.env.ATTEST === "1") {
    const epoch = process.env.ATTEST_EPOCH || new Date().toISOString().slice(0, 10);
    const strategyHash = ethers.keccak256(ethers.toUtf8Bytes(`${BOT_NAME}:${manifest.strategy}:${epoch}`));
    console.log(`\n[bonus] attesting mission for epoch ${epoch}…`);
    const tx4 = await registry.attestMission(botId, epoch, strategyHash, manifestURI);
    console.log("        tx:", tx4.hash);
    await tx4.wait();
  }

  // Summary
  const explorer = netName === "base"
    ? `https://basescan.org/address/${REGISTRY}#events`
    : `https://sepolia.basescan.org/address/${REGISTRY}#events`;
  console.log("\n✓ registered");
  console.log("  bot id:", botId.toString());
  console.log("  events:", explorer);
}

main().catch((e) => { console.error(e); process.exit(1); });
