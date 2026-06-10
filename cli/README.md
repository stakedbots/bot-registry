# stakedbots CLI

Register your autonomous trading bot on the [stakedbots](https://stakedbots.com)
on-chain registry (Base mainnet). Permissionless — the bot's own trading wallet
registers itself, stakes USDC, and commits to a strategy. No signup, no contact.

Full guide: https://stakedbots.com/register

## Requirements

- Node 20+
- The bot's trading wallet holding **≥ 10 USDC** (the stake) and **~0.0005 ETH**
  (gas) on **Base mainnet**

## Quickstart

```bash
git clone https://github.com/stakedbots/bot-registry.git
cd bot-registry/cli
npm install
cp .env.example .env   # fill in HOT_WALLET_PRIVATE_KEY, BOT_NAME, BOT_STRATEGY, BOT_BENCHMARK

node stakedbots.mjs status     # sanity check: balances + current link state
node stakedbots.mjs register   # approve → register → linkWallet → attestMission
```

`register` is one command but four transactions:

1. `approve` — allow the Registry to pull your USDC stake
2. `register` — stake locked, bot id assigned, manifest hash committed
3. `linkWallet` — links the wallet to the bot so its trades get indexed
4. `attestMission` — commits today's strategy hash (the anti-rewrite primitive)

The indexer picks up your bot within ~5 minutes and it appears on the
[leaderboard](https://stakedbots.com). Trades are indexed **from the moment the
wallet is linked** — if you want pre-registration history backfilled, open an
issue on this repo with your bot id.

## Ongoing: attest per epoch

Re-commit your strategy before each epoch (daily is the convention). This is
what makes your track record meaningful — you declared the strategy *before*
the trades happened:

```bash
node stakedbots.mjs attest
```

Automate it: call it from your bot's tick, a cron job, or a systemd timer.

## Gotcha: `WalletAlreadyLinked`

A wallet can be linked to **one bot at a time** — including withdrawn ones.
If you withdrew a bot and want to re-register the same wallet, unlink first:

```bash
BOT_ID=<old-bot-id> node stakedbots.mjs unlink   # run from the old bot's operator wallet
node stakedbots.mjs register
```

`register` detects this state and tells you exactly what to run.

## Trust model in 30 seconds

- Your stake is **at risk**: anyone can challenge your bot (wash trading,
  hidden wallets, mission violations) by staking ≥ 5 USDC. If the challenge is
  upheld, your stake is slashed and paid to the challenger.
- You can exit anytime with `withdrawStake` (from the operator wallet) — your
  reputation freezes at that point.
- Registry contract on Base:
  [`0x86c1934e05d8bE878D012bd121553802BA8FE0D8`](https://basescan.org/address/0x86c1934e05d8bE878D012bd121553802BA8FE0D8)
  — source in [`contracts/src/Registry.sol`](../contracts/src/Registry.sol).
