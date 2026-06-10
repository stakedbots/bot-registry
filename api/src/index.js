import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware } from "x402-hono";
import { createFacilitatorConfig } from "@coinbase/x402";
import {
  listBots,
  getBot,
  getBotWallets,
  getBotMissions,
  getBotStats,
  getBotEventsCount,
  getBotEvents,
  getBotTransfers,
  getBotTransfersStats,
} from "./queries.js";

const PAY_TO = process.env.PAY_TO;
const NETWORK = process.env.NETWORK || "base-sepolia";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "";
const PORT = Number(process.env.PORT || 3000);

if (!PAY_TO) {
  console.error("PAY_TO env var required (the USDC receiving address).");
  process.exit(1);
}

const app = new Hono();

// Facilitator priority: CDP (auths via CDP_API_KEY_ID/SECRET, required on
// mainnet + enables Bazaar discovery) > explicit FACILITATOR_URL > x402.org default.
const facilitator =
  process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
    ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
    : FACILITATOR_URL
      ? { url: FACILITATOR_URL }
      : undefined;

app.use(
  paymentMiddleware(
    PAY_TO,
    {
      "GET /bots/*/detail": {
        price: "$0.10",
        network: NETWORK,
        config: {
          description:
            "Full detail for a registered trading bot: linked wallets, attested missions, performance stats, on-chain activity summary",
          mimeType: "application/json",
          discoverable: true,
          outputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Bot id in the registry" },
              name: { type: "string" },
              strategy: { type: "string" },
              stake_usdc: { type: "string", description: "USDC staked by the operator" },
              wallets: { type: "array", description: "Linked on-chain wallets" },
              missions: { type: "array", description: "Pre-committed strategy attestations" },
              stats: { type: "object", description: "Per-epoch PnL vs declared benchmark" },
              events_count: { type: "number" },
              transfers_count: { type: "number" },
              last_transfer_at: { type: "string" },
              recent_transfers: { type: "array" },
            },
          },
        },
      },
      "GET /bots/*/events": {
        price: "$0.05",
        network: NETWORK,
        config: {
          description:
            "Raw on-chain registry event log for a bot (registrations, wallet links, mission attestations, challenges)",
          mimeType: "application/json",
          discoverable: true,
          outputSchema: {
            type: "object",
            properties: {
              bot_id: { type: "string" },
              events: { type: "array" },
              total: { type: "number" },
              limit: { type: "number" },
              offset: { type: "number" },
            },
          },
        },
      },
    },
    facilitator
  )
);

// ─── Health / discovery ────────────────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    name: "bot-registry-api",
    version: "0.1.0",
    network: NETWORK,
    payTo: PAY_TO,
    endpoints: {
      "GET /bots":                "free — list of bots with basic stats",
      "GET /bots/:id":            "free — overview of a single bot",
      "GET /bots/:id/detail":     "$0.10 — wallets, missions, stats",
      "GET /bots/:id/events":     "$0.05 — raw on-chain events",
    },
  })
);

// OpenAPI doc at the root — modern x402 discovery (x402scan and friends probe
// /openapi.json, then validate the 402s of the paid routes it declares).
app.get("/openapi.json", (c) =>
  c.json({
    openapi: "3.0.3",
    info: {
      title: "stakedbots — Bot Reputation Registry",
      version: "0.1.0",
      description:
        "On-chain registry of autonomous trading bots: staked USDC, pre-committed missions, verifiable performance. Paid endpoints settle via x402 (USDC on Base).",
    },
    servers: [{ url: "https://api.stakedbots.com" }],
    paths: {
      "/bots": {
        get: {
          summary: "List registered bots with basic stats (free)",
          responses: { 200: { description: "Array of bots" } },
        },
      },
      "/bots/{id}": {
        get: {
          summary: "Overview of a single bot (free)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Bot overview" }, 404: { description: "Not found" } },
        },
      },
      "/bots/{id}/detail": {
        get: {
          summary: "Full bot detail: wallets, missions, stats ($0.10 via x402)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Full detail" }, 402: { description: "Payment required (x402)" } },
        },
      },
      "/bots/{id}/events": {
        get: {
          summary: "Raw on-chain registry event log ($0.05 via x402)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
            { name: "offset", in: "query", schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Event log" }, 402: { description: "Payment required (x402)" } },
        },
      },
    },
  })
);

// ─── Free ──────────────────────────────────────────────────────────────────
app.get("/bots", async (c) => c.json({ bots: await listBots() }));

app.get("/bots/:id", async (c) => {
  const bot = await getBot(c.req.param("id"));
  if (!bot) return c.json({ error: "not_found" }, 404);
  return c.json(bot);
});

// ─── Paywalled ─────────────────────────────────────────────────────────────
app.get("/bots/:id/detail", async (c) => {
  const id = c.req.param("id");
  const bot = await getBot(id);
  if (!bot) return c.json({ error: "not_found" }, 404);
  const [wallets, missions, eventsCount, stats, transfers, transferStats] = await Promise.all([
    getBotWallets(id),
    getBotMissions(id),
    getBotEventsCount(id),
    getBotStats(id),
    getBotTransfers(id, { limit: 50 }),
    getBotTransfersStats(id),
  ]);
  return c.json({
    ...bot,
    wallets,
    missions,
    stats,
    events_count: eventsCount,
    transfers_count: transferStats.transfers_count,
    last_transfer_at: transferStats.last_transfer_at,
    recent_transfers: transfers,
  });
});

app.get("/bots/:id/events", async (c) => {
  const id = c.req.param("id");
  const limit  = Math.min(Number(c.req.query("limit")  || 100), 500);
  const offset = Math.max(Number(c.req.query("offset") || 0),   0);
  const events = await getBotEvents(id, { limit, offset });
  const total  = await getBotEventsCount(id);
  return c.json({ bot_id: id, events, total, limit, offset });
});

console.log(`bot-registry-api listening on :${PORT}`);
console.log(`  network: ${NETWORK}`);
console.log(`  payTo:   ${PAY_TO}`);
console.log(
  `  facilitator: ${
    process.env.CDP_API_KEY_ID ? "CDP (Bazaar discovery on)" : FACILITATOR_URL || "x402.org (default)"
  }`
);
serve({ fetch: app.fetch, port: PORT });
