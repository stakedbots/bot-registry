/**
 * Per-event handlers. Each receives (client, ctx, args) where:
 *   client = pg client (inside a tx)
 *   ctx    = { chain, blockNumber, blockTimestamp, txHash }
 *   args   = decoded event args
 *
 * All handlers must be idempotent — they may re-run if the indexer restarts
 * mid-batch.
 */

export const HANDLERS = {
  async BotRegistered(client, ctx, a) {
    await client.query(
      `insert into bot_registry.bots
         (bot_id, operator_address, manifest_uri, manifest_hash,
          chain, stake_amount_raw, status,
          registered_at, registered_block, registered_tx)
       values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
       on conflict (bot_id) do nothing`,
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
        a.botId.toString(),
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
    await client.query(
      `insert into bot_registry.missions
         (bot_id, epoch_id, benchmark, strategy_hash, manifest_uri,
          attested_at, attested_block, attested_tx)
       values ($1, $2, '', $3, $4, $5, $6, $7)
       on conflict (bot_id, epoch_id) do nothing`,
      [
        a.botId.toString(),
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
      `update bot_registry.bots set stake_amount_raw = $1 where bot_id = $2`,
      [a.newTotal.toString(), a.botId.toString()]
    );
  },

  async StakeWithdrawn(client, ctx, a) {
    await client.query(
      `update bot_registry.bots
         set stake_amount_raw = 0, status = 'withdrawn'
       where bot_id = $1`,
      [a.botId.toString()]
    );
  },

  async ManifestUpdated(client, ctx, a) {
    await client.query(
      `update bot_registry.bots
         set manifest_uri = $1, manifest_hash = $2
       where bot_id = $3`,
      [
        a.manifestURI,
        Buffer.from(a.manifestHash.slice(2), "hex"),
        a.botId.toString(),
      ]
    );
  },

  async EpochCommitted(client, ctx, a) {
    // Insert minimal row if epoch_performance has no entry yet for this
    // (bot_id, epoch_id). Real PnL fields get computed elsewhere; here we
    // only carry the merkle anchor + commit metadata.
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
        a.botId.toString(),
        a.epochId,
        ctx.blockTimestamp,
        Buffer.from(a.merkleRoot.slice(2), "hex"),
        ctx.blockTimestamp,
        ctx.txHash,
      ]
    );
  },

  async ChallengeOpened(client, ctx, a) {
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
        a.botId.toString(),
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
       where bot_id = $1`,
      [a.botId.toString()]
    );
  },

  async OwnerTransferred(_client, _ctx, _a) {
    // No derived state. The raw row in contract_events captures it.
  },
};
