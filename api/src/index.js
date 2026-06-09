import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware } from "x402-hono";
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

const facilitator = FACILITATOR_URL ? { url: FACILITATOR_URL } : undefined;

app.use(
  paymentMiddleware(
    PAY_TO,
    {
      "GET /bots/*/detail": {
        price: "$0.10",
        network: NETWORK,
        config: { description: "Full bot detail: wallets, missions, stats" },
      },
      "GET /bots/*/events": {
        price: "$0.05",
        network: NETWORK,
        config: { description: "Raw on-chain event log for this bot" },
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
console.log(`  facilitator: ${FACILITATOR_URL || "x402.org (default)"}`);
serve({ fetch: app.fetch, port: PORT });
