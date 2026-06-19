/**
 * Telegram notifier for new API revenue.
 *
 * After each revenue pass, push a message for every not-yet-notified payment to
 * the *dedicated* revenue wallet (we don't ping for the legacy personal ENS).
 * External payments (third-party agents) are the signal; self payments (our own
 * keep-alive) are labelled but still surfaced — they're weekly, not noise.
 *
 * No-op (and logs) if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set, so the
 * code can ship before the bot exists.
 */

// The dedicated revenue wallet (PAY_TO of api.stakedbots.com). Lowercase.
const DEDICATED = "0x21b077b26bfda6d2b8fdf0130977362d61e18912";

const ENDPOINT_LABEL = { events: "/bots/:id/events", detail: "/bots/:id/detail" };

async function sendTelegram(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`telegram ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

function formatMessage(rows, totals) {
  const ext = rows.filter((r) => r.classification === "external");
  const self = rows.filter((r) => r.classification === "self");
  const lines = [];

  if (ext.length) {
    const sum = ext.reduce((s, r) => s + Number(r.amount_usdc), 0);
    lines.push(`🤖 <b>Pago x402 EXTERNO</b> — un agente pagó por inspeccionar tus bots`);
    lines.push(`💵 <b>$${sum.toFixed(2)}</b> (${ext.length} ${ext.length === 1 ? "request" : "requests"})`);
    for (const r of ext) {
      lines.push(`   • $${Number(r.amount_usdc).toFixed(2)} ${ENDPOINT_LABEL[r.endpoint] ?? r.endpoint ?? ""}`);
    }
    const payer = ext[0].from_address;
    lines.push(`👤 <code>${payer.slice(0, 6)}…${payer.slice(-4)}</code>`);
  }

  if (self.length) {
    const sum = self.reduce((s, r) => s + Number(r.amount_usdc), 0);
    lines.push(`🔁 Keep-alive propio — $${sum.toFixed(2)} (${self.length})`);
  }

  if (totals) {
    lines.push("");
    lines.push(
      `📊 Acumulado externo: <b>$${Number(totals.externalUsdc).toFixed(2)}</b> de ${totals.externalPayers} agente(s)`
    );
  }

  const tx = rows[0].tx_hash;
  lines.push(`🔗 https://basescan.org/tx/${tx}`);
  return lines.join("\n");
}

/**
 * Send notifications for unnotified payments to the dedicated revenue wallet.
 * Groups all pending rows from this pass into a single message, then marks them
 * notified. Failures are non-fatal — rows stay unnotified and retry next pass.
 *
 * @returns {{notified: number}}
 */
export async function notifyNewRevenue({ pool, dry = false, log = console.log }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log("[notify] TELEGRAM_BOT_TOKEN/CHAT_ID not set, skipping");
    return { notified: 0 };
  }

  const { rows } = await pool.query(
    `select id, from_address, amount_usdc, endpoint, classification, tx_hash, block_timestamp
       from bot_registry.api_revenue
      where notified_at is null and pay_to = $1
      order by block_timestamp asc`,
    [DEDICATED]
  );
  if (rows.length === 0) {
    log("[notify] nothing new");
    return { notified: 0 };
  }

  // Running external totals for context in the message.
  const t = await pool.query(
    `select coalesce(sum(amount_usdc),0) usd, count(distinct from_address) payers
       from bot_registry.api_revenue where classification = 'external'`
  );
  const totals = { externalUsdc: t.rows[0].usd, externalPayers: t.rows[0].payers };

  const text = formatMessage(rows, totals);
  if (dry) {
    log(`[notify] (dry) would send:\n${text}`);
    return { notified: 0 };
  }

  try {
    await sendTelegram(token, chatId, text);
  } catch (e) {
    log(`[notify] send failed (will retry next pass): ${e?.message ?? e}`);
    return { notified: 0 };
  }

  const ids = rows.map((r) => r.id);
  await pool.query(
    `update bot_registry.api_revenue set notified_at = now() where id = any($1::bigint[])`,
    [ids]
  );
  log(`[notify] sent 1 message for ${rows.length} payment(s)`);
  return { notified: rows.length };
}
