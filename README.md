# Bot Reputation Registry

On-chain registry where autonomous trading bots commit their identity, declare
their strategy ahead of action, and stake USDC so fraud can be challenged.
Performance lives off-chain (replayed from on-chain trades); the trust layer
lives on-chain.

Consumed via **x402** — agents pay per query to inspect bots, no signup.

## Architecture

```
                            ┌──────────────────┐
   Bot operator  ──── tx ──▶│   Registry.sol    │  (Base mainnet)
                            │  - register       │
                            │  - linkWallet     │
                            │  - attestMission  │
                            │  - challenges     │
                            └────────┬─────────┘
                                     │  events
                                     ▼
                            ┌──────────────────┐
                            │     Indexer       │  (Node + viem, on Hetzner)
                            │  - reads events   │
                            │  - reads trades   │
                            │  - computes PnL   │
                            └────────┬─────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │ Supabase (self)   │  schema `bot_registry`
                            │  bots, trades,    │
                            │  missions, stats… │
                            └────────┬─────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │   x402 API        │  pay-per-query for agents
                            │  /bots /detail …  │
                            └────────┬─────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │   Public web      │  leaderboard / discovery
                            └──────────────────┘
```

## Layout

| Path                     | What                                                |
|--------------------------|-----------------------------------------------------|
| `contracts/src/Registry.sol`         | Core registry + challenges + slashing.  |
| `supabase/migrations/001_*.sql`      | Schema `bot_registry`.                  |
| `indexer/` (TBD)                     | Event + trade indexer (Node + viem).    |
| `api/` (TBD)                         | x402 endpoints.                         |
| `web/` (TBD)                         | Public leaderboard.                     |
| `docs/`                              | Notes, design decisions.                |

## Trust model in 30s

1. Operator registers a bot with a **stake** + **manifest** (IPFS, hashed on-chain).
2. Before each epoch, the bot **attests a mission** on-chain: which strategy +
   benchmark it commits to. This is the anti-rewrite primitive.
3. Indexer reads the bot's wallet trades from chain and computes PnL vs the
   benchmark the bot pre-committed to.
4. Anyone can **challenge** a bot (wash trade, hidden wallet, mission violation).
   Challenger stakes USDC. Owner (later: committee) resolves. Loser is slashed.

The system rewards bots that publish, follow what they said they'd do, and
keep stake on the table over time. It punishes fraudulent claims with funds,
not just warnings.

## Decisions taken

- **Chain**: Base mainnet. Cheap, USDC-native, where Jorge's bots already run.
- **Stake token**: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
- **Min stake**: 100 USDC (100e6). Min challenge: 50 USDC.
- **Contract framework**: Hardhat (npm-native, no extra installs). Swap to
  Foundry later is trivial — `Registry.sol` is plain Solidity.
- **DB**: existing self-hosted Supabase on Hetzner, new schema `bot_registry`,
  isolated from `public`, `trading`, `bloxyberry`.
- **Resolver of challenges (MVP)**: contract owner. v2 = multisig / committee.
- **No upgradeability proxy** in MVP. If we need to fork, we fork.

## Roadmap

- **M1 (now)**: contract + schema + indexer for events + register Jorge's two
  bots (thesis-llm, momentum-det) as the first entries.
- **M2**: indexer reads trades from linked wallets, computes per-epoch PnL,
  commits merkle roots, writes `bot_stats`.
- **M3**: x402 API + public web leaderboard.
- **M4**: challenge UI + first real challenges. Index public bots without opt-in.
