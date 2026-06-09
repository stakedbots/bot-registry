// Deploy Registry.sol to the current --network.
//
//   npx hardhat run scripts/deploy.js --network baseSepolia
//   npx hardhat run scripts/deploy.js --network base
//
// Writes a deployment record to addresses/<network>.json with the address, tx,
// block, and constructor args. Safe to re-run: refuses to overwrite if a record
// already exists for that network unless DEPLOY_OVERWRITE=1.

const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

// USDC per chain. Source of truth: Circle docs.
const USDC = {
  base:        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // mainnet
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // testnet
};

// Defaults: 100 USDC stake, 50 USDC challenge (6 decimals).
// Override per deploy with MIN_STAKE / MIN_CHALLENGE env vars (raw units).
const MIN_STAKE     = BigInt(process.env.MIN_STAKE     || "100000000");
const MIN_CHALLENGE = BigInt(process.env.MIN_CHALLENGE || "50000000");

async function main() {
  const { ethers, network } = hre;
  const netName = network.name;

  const stakeToken = USDC[netName];
  if (!stakeToken) {
    throw new Error(`no USDC address configured for network "${netName}". add to USDC map in deploy.js.`);
  }

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("network: ", netName, `(chainId ${network.config.chainId})`);
  console.log("deployer:", deployer.address);
  console.log("balance: ", ethers.formatEther(bal), "ETH");
  console.log("stake token (USDC):", stakeToken);
  console.log("minStake:    ", MIN_STAKE.toString(), `(${Number(MIN_STAKE) / 1e6} USDC)`);
  console.log("minChallenge:", MIN_CHALLENGE.toString(), `(${Number(MIN_CHALLENGE) / 1e6} USDC)`);

  if (bal === 0n) {
    throw new Error("deployer has 0 ETH on this network. fund the address first.");
  }

  // Refuse to clobber a previous deployment record unless explicitly asked.
  const addrDir = path.join(__dirname, "..", "addresses");
  const recordPath = path.join(addrDir, `${netName}.json`);
  if (fs.existsSync(recordPath) && process.env.DEPLOY_OVERWRITE !== "1") {
    const prev = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    throw new Error(
      `a deployment record already exists at ${recordPath}\n` +
      `  previous Registry: ${prev.registry}\n` +
      `set DEPLOY_OVERWRITE=1 to deploy a new one.`
    );
  }
  fs.mkdirSync(addrDir, { recursive: true });

  console.log("\ndeploying Registry…");
  const Registry = await ethers.getContractFactory("Registry");
  const registry = await Registry.deploy(stakeToken, MIN_STAKE, MIN_CHALLENGE);
  const tx = registry.deploymentTransaction();
  console.log("  tx:", tx.hash);
  const receipt = await tx.wait();
  const address = await registry.getAddress();
  console.log("  address:", address);
  console.log("  block:  ", receipt.blockNumber);
  console.log("  gas used:", receipt.gasUsed.toString());

  const record = {
    network: netName,
    chainId: network.config.chainId,
    registry: address,
    deployer: deployer.address,
    stakeToken,
    minStake: MIN_STAKE.toString(),
    minChallenge: MIN_CHALLENGE.toString(),
    tx: tx.hash,
    block: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  console.log("\nrecord written:", recordPath);
  console.log("\nverify on basescan with:");
  console.log(
    `  npx hardhat verify --network ${netName} ${address} ${stakeToken} ${MIN_STAKE} ${MIN_CHALLENGE}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
