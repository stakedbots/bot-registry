import { createPublicClient, http } from "viem";
import { REGISTRY_EVENTS } from "./abi.js";

export function makeClient(cfg) {
  return createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
}

/**
 * Fetch decoded Registry logs in [fromBlock, toBlock] (inclusive).
 * Returns logs sorted by (blockNumber, logIndex) ascending.
 */
export async function fetchLogs(client, cfg, fromBlock, toBlock) {
  const logs = await client.getLogs({
    address: cfg.registryAddress,
    events: REGISTRY_EVENTS,
    fromBlock,
    toBlock,
    strict: true,
  });
  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return Number(a.logIndex - b.logIndex);
  });
  return logs;
}

/**
 * Get block timestamps in batch — used so handlers can derive ISO dates without
 * an RPC call per log. Returns Map<bigint blockNumber, Date>.
 */
export async function getBlockTimestamps(client, blockNumbers) {
  const unique = [...new Set(blockNumbers)];
  const entries = await Promise.all(
    unique.map(async (bn) => {
      const block = await client.getBlock({ blockNumber: bn });
      return [bn, new Date(Number(block.timestamp) * 1000)];
    })
  );
  return new Map(entries);
}
