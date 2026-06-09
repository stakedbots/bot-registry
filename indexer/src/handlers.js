/**
 * Per-event handlers. Each receives (client, ctx, args) where:
 *   client = pg client (inside a tx)
 *   ctx    = { chain, blockNumber, blockTimestamp, txHash }
 *   args   = decoded event args
 *
 * Handlers are idempotent — they may re-run if the indexer restarts mid-batch.
 *
 * Since migration 003, `bots.bot_id` is a DB-side autoincrementing PK and
 * `bots.on_chain_bot_id` is the chain-emitted id. Foreign keys still target
 * `bot_id`, so each handler that uses an FK must resolve DB id first.
 */

async function resolveBotId(client, chain, onChainBotId) {
  const r = await client.query(
    `select bot_id from bot_registry.bots
       where chain = $1 and on_chain_bot_id = $2`,
    [chain, onChainBotId.toString()]
  );
  return r.rows[0]?.bot_id ?? null;
}

export const HANDLERS = {
  async BotRegistered(client, ctx, a) {
    await client.query(
      `insert into bot_registry.bots
         (on_chain_bot_id, operator_address, manifest_uri, manifest_hash,
          chain, stake_amount_raw, status,
          registered_at, registered_block, registered_tx)
       values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
       on conflict (chain, on_chain_bot_id) do nothing`,
      [
        a.botId.toString(),
        a.operator.toLowerCase(),
        a.manifestURI,
        Buffer.from(a.manifestHash.slice(2), "hex"),
        ctx.chain,
        a.stake.toString(),
        ctx.blockTimestamp,
        ctx.blockNumber.toString(),
        ctx.txHash,
      ]
    );
  },

  async WalletLinked(client, ctx, a) {
    const botId = await resolveBotId(client, ctx.chain, a.botId);
    if (!botId) return; // bot not yet seen — should never happen since events are ordered
    await client.query(
      `insert into bot_registry.bot_wallets
         (bot_id, wallet_address, chain, linked_at, linked_block, linked_tx)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (chain, wallet_address) do update set
         bot_id      = excluded.bot_id,
         linked_at   = excluded.linked_at,
         linked_block = excluded.linked_block,
         linked_tx   = excluded.linked_tx,
         unlinked_at = null,
         unlinked_tx = null`,
      [
        botId,
        a.wallet.toLowerCase(),
        ctx.chain,
        ctx.blockTimestamp,
        ctx.blockNumber.toString(),
        ctx.txHash,
      ]
    );
  },

  async WalletUnlinked(client, ctx, a) {
    await client.query(
      `update bot_registry.bot_wallets
         set unlinked_at = $1, unlinked_tx = $2
       where chain = $3 and wallet_address = $4`,
      [ctx.blockTimestamp, ctx.txHash, ctx.chain, a.wallet.toLowerCase()]
    );
  },

  async MissionAttested(client, ctx, a) {
    const botId = await resolveBotId(client, ctx.chain, a.botId);
    if (!botId) return;
    await client.query(
      `insert into bot_registry.missions
         (bot_id, epoch_id, benchmark, strategy_hash, manifest_uri,
          attested_at, attested_block, attested_tx)
       values ($1, $2, '', $3, $4, $5, $6, $7)
       on conflict (bot_id, epoch_id) do nothing`,
      [
        botId,
        a.epochId,
        Buffer.from(a.strategyHash.slice(2), "hex"),
        a.manifestURI,
        ctx.blockTimestamp,
        ctx.blockNumber.toString(),
        ctx.txHash,
      ]
    );
  },

  async StakeIncreased(client, ctx, a) {
    await client.query(
      `update bot_registry.bots
         set stake_amount_raw = $1
       where chain = $2 and on_chain_bot_id = $3`,
      [a.newTotal.toString(), ctx.chain, a.botId.toString()]
    );
  },

  async StakeWithdrawn(client, ctx, a) {
    await client.query(
      `update bot_registry.bots
         set stake_amount_raw = 0, status = 'withdrawn'
       where chain = $1 and on_chain_bot_id = $2`,
      [ctx.chain, a.botId.toString()]
    );
  },

  async ManifestUpdated(client, ctx, a) {
    await client.query(
      `update bot_registry.bots
         set manifest_uri = $1, manifest_hash = $2
       where chain = $3 and on_chain_bot_id = $4`,
      [
        a.manifestURI,
        Buffer.from(a.manifestHash.slice(2), "hex"),
        ctx.chain,
        a.botId.toString(),
      ]
    );
  },

  async EpochCommitted(client, ctx, a) {
    const botId = await resolveBotId(client, ctx.chain, a.botId);
    if (!botId) return;
    await client.query(
      `insert into bot_registry.epoch_performance
         (bot_id, epoch_id, starts_at, ends_at,
          starting_nav_usd, ending_nav_usd, pnl_abs_usd, pnl_pct,
          merkle_root, committed_at, committed_tx)
       values ($1, $2, $3, $3, 0, 0, 0, 0, $4, $5, $6)
       on conflict (bot_id, epoch_id) do update set
         merkle_root = excluded.merkle_root,
         committed_at = excluded.committed_at,
         committed_tx = excluded.committed_tx`,
      [
        botId,
        a.epochId,
        ctx.blockTimestamp,
        Buffer.from(a.merkleRoot.slice(2), "hex"),
        ctx.blockTimestamp,
        ctx.txHash,
      ]
    );
  },

  async ChallengeOpened(client, ctx, a) {
    const botId = await resolveBotId(client, ctx.chain, a.botId);
    if (!botId) return;
    const reason = ["wash_trade","hidden_wallet","mission_violation","manifest_mismatch","fake_volume"].includes(a.reason)
      ? a.reason
      : "other";
    await client.query(
      `insert into bot_registry.challenges
         (challenge_id, bot_id, challenger_address, challenger_stake,
          reason, evidence_uri, status,
          created_at, created_block, created_tx)
       values ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9)
       on conflict (challenge_id) do nothing`,
      [
        a.challengeId.toString(),
        botId,
        a.challenger.toLowerCase(),
        a.stake.toString(),
        reason,
        a.evidenceURI,
        ctx.blockTimestamp,
        ctx.blockNumber.toString(),
        ctx.txHash,
      ]
    );
  },

  async ChallengeResolved(client, ctx, a) {
    await client.query(
      `update bot_registry.challenges
         set status = $1, resolved_at = $2, resolved_tx = $3
       where challenge_id = $4`,
      [a.upheld ? "upheld" : "rejected", ctx.blockTimestamp, ctx.txHash, a.challengeId.toString()]
    );
  },

  async BotSlashed(client, ctx, a) {
    await client.query(
      `update bot_registry.bots
         set stake_amount_raw = 0, status = 'slashed'
       where chain = $1 and on_chain_bot_id = $2`,
      [ctx.chain, a.botId.toString()]
    );
  },

  async OwnerTransferred(_client, _ctx, _a) {
    // No derived state. The raw row in contract_events captures it.
  },
};
