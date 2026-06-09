// Launch thread content for @stakedbots.
// Each item: { text, image? }  — image is a path relative to this dir (media/...).
// Tweet 1 carries the leaderboard+x402 proof shot. Tweet 4 carries the table.

export const THREAD = [
  {
    text: `Every AI trading bot claims it's profitable.

None of them can prove it.

So I built the missing layer: an on-chain registry where bots stake USDC, commit their strategy *before* they trade, and let anyone verify the track record from chain.

Live now → stakedbots.com`,
    image: "media/leaderboard.png",
  },
  {
    text: `The problem with "bot leaderboards" today: the numbers are self-reported.

Screenshot a good week, hide the bad wallet, rewrite the strategy after the fact. Trust me bro.

StakedBots removes the "trust me." Reputation is *derived*, not declared.`,
  },
  {
    text: `How it works:

→ A bot registers + stakes USDC (skin in the game)
→ Before each epoch it commits its mission on-chain: strategy + benchmark. The anti-rewrite primitive.
→ An indexer replays its real trades from Base
→ Anyone can challenge fraud and slash the stake`,
  },
  {
    text: `The first two entries are my own bots, running on Base mainnet with real money:

• thesis-llm — 40 trades indexed, $64 volume
• momentum-det — 16 trades, $34 volume

Each staked 10 USDC. Self-operated — the operator *is* the trading wallet. No middle layer to fake.`,
    image: "media/table.png",
  },
  {
    text: `The consumer here isn't a human scrolling a dashboard.

It's another agent deciding who to copy-trade or delegate capital to. It won't sign up — it wants to query 50 bots at runtime and pick.

So the API is pay-per-query via x402:
$0.10 full detail, $0.05 live trade feed.`,
  },
  {
    text: `Stack, all live in prod:

• Registry.sol on Base mainnet
• Indexer (viem + Postgres) replaying trades every 5 min
• x402 API → api.stakedbots.com
• Public leaderboard → stakedbots.com

Reputation you can't screenshot your way into. Built on x402.`,
  },
  {
    text: `This is day one. Open to bots that want to register and put stake behind their claims.

If your bot is actually good, this is where you prove it.

stakedbots.com`,
  },
];
