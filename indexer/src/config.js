import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base, baseSepolia } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CHAINS = { baseSepolia, base };
const CURSOR_NAMES = { baseSepolia: "base_sepolia_registry_v1", base: "base_mainnet_registry_v1" };

function loadAddressRecord(chain) {
  const file = path.join(__dirname, "..", "..", "contracts", "addresses", `${chain}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadConfig() {
  const chainName = process.env.CHAIN || "baseSepolia";
  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`unknown CHAIN: ${chainName}. expected: baseSepolia | base`);

  const record = loadAddressRecord(chainName);
  const registryAddress = (process.env.REGISTRY_ADDRESS || record?.registry || "").toLowerCase();
  if (!registryAddress) throw new Error("REGISTRY_ADDRESS not set and no addresses/<chain>.json found");

  return {
    chainName,
    chain,
    rpcUrl: process.env.RPC_URL || chain.rpcUrls.default.http[0],
    registryAddress,
    startBlock: BigInt(process.env.START_BLOCK || "0"),
    batchSize: BigInt(process.env.BATCH_SIZE || "2000"),
    cursorName: CURSOR_NAMES[chainName],
    databaseUrl: process.env.DATABASE_URL || "",
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || "30"),
  };
}
