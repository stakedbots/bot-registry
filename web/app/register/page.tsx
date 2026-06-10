import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Register your bot — stakedbots",
  description:
    "Get your autonomous trading bot listed on the on-chain registry. Stake 10 USDC on Base, attest your strategy, earn a verifiable track record. Permissionless — no signup, no approval.",
};

const REGISTRY = "0x86c1934e05d8bE878D012bd121553802BA8FE0D8";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      {/* ─── Hero ──────────────────────────────────────────────────── */}
      <section className="mb-14">
        <h1 className="text-4xl font-semibold tracking-tight">
          Register your <span className="text-emerald-400">bot</span>
        </h1>
        <p className="mt-4 text-lg text-zinc-400 leading-relaxed max-w-2xl">
          Anyone can list a bot. There is no signup, no review queue, and
          nobody to ask — your bot&apos;s wallet registers itself on-chain with
          four transactions on Base mainnet. Five minutes, 10 USDC stake.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <a
            href="#quickstart"
            className="px-4 py-2 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 transition-colors"
          >
            Quickstart ↓
          </a>
          <a
            href="https://github.com/stakedbots/bot-registry/tree/main/cli"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-zinc-500 transition-colors font-mono"
          >
            cli on GitHub
          </a>
        </div>
      </section>

      {/* ─── What you need ─────────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-semibold mb-4">What you need</h2>
        <ul className="space-y-3 text-sm text-zinc-300">
          {[
            <>
              Your bot&apos;s <strong>trading wallet</strong> holding at least{" "}
              <span className="font-mono text-emerald-300">10 USDC</span> (the
              stake) and{" "}
              <span className="font-mono text-emerald-300">~0.0005 ETH</span>{" "}
              for gas, on <strong>Base mainnet</strong>.
            </>,
            <>
              A one-line <strong>strategy description</strong> and a{" "}
              <strong>benchmark</strong>{" "}
              you commit to measure yourself against (e.g. &quot;HODL 50/50
              USDC/ETH&quot;).
            </>,
            <>Node 20+ if you use the CLI. That&apos;s it.</>,
          ].map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-emerald-400 mt-0.5">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-zinc-500">
          The convention is <strong>self-operated</strong>: the bot&apos;s own
          trading wallet is the operator. No service wallets, no intermediaries
          — each bot is sovereign.
        </p>
      </section>

      {/* ─── Trust model ───────────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-semibold mb-2">
          The deal: stake on the table
        </h2>
        <p className="text-sm text-zinc-400 mb-6 max-w-2xl">
          Listing here means putting funds behind your claims. That&apos;s the
          whole point — it&apos;s what makes your track record worth paying
          for.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              title: "Your stake is at risk",
              body: "The 10 USDC isn't a listing fee — it's collateral. It stays locked while your bot is active and is what gets slashed if you cheat.",
            },
            {
              title: "Attest before acting",
              body: "Each epoch you commit a strategy hash on-chain before the trades happen. You can't retroactively reframe what your bot was doing.",
            },
            {
              title: "Anyone can challenge you",
              body: "Wash trading, hidden wallets, mission violations — anyone can open a challenge by staking ≥ 5 USDC. Upheld: your stake is slashed and paid to the challenger. Rejected: you keep their stake.",
            },
            {
              title: "Exit anytime",
              body: "withdrawStake returns your USDC and marks the bot inactive. Your track record freezes at that block — it doesn't disappear.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-5"
            >
              <div className="text-sm font-medium text-emerald-400">
                {card.title}
              </div>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── The four transactions ─────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-semibold mb-2">The four transactions</h2>
        <p className="text-sm text-zinc-400 mb-6 max-w-2xl">
          Registration is four contract calls from your bot&apos;s wallet. The
          CLI below runs them all in one command, but there is no magic — you
          can send them with any tooling you like.
        </p>
        <ol className="space-y-4">
          {[
            {
              step: "1",
              sig: "USDC.approve(registry, stake)",
              body: "Allow the Registry to pull your stake.",
            },
            {
              step: "2",
              sig: "register(manifestURI, manifestHash, stake)",
              body: "Stake is locked, your bot gets an id, and the keccak256 hash of your manifest (name, strategy, benchmark, wallet) is committed on-chain.",
            },
            {
              step: "3",
              sig: "linkWallet(botId, wallet)",
              body: "Link the trading wallet so the indexer starts tracking its trades. Self-operated bots link their own address.",
            },
            {
              step: "4",
              sig: "attestMission(botId, epochId, strategyHash, manifestURI)",
              body: "Commit your first mission: the strategy you'll run this epoch. Repeat per epoch — this is what makes the track record verifiable.",
            },
          ].map((s) => (
            <li
              key={s.step}
              className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-5 flex gap-4"
            >
              <span className="font-mono text-emerald-400 text-lg">
                {s.step}
              </span>
              <div className="min-w-0">
                <code className="text-sm font-mono text-zinc-200 break-all">
                  {s.sig}
                </code>
                <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── Quickstart ────────────────────────────────────────────── */}
      <section id="quickstart" className="mb-14 scroll-mt-8">
        <h2 className="text-2xl font-semibold mb-2">Quickstart with the CLI</h2>
        <p className="text-sm text-zinc-400 mb-4 max-w-2xl">
          The open-source CLI runs the whole flow from your bot&apos;s
          environment. Your private key never leaves your machine.
        </p>
        <pre className="text-xs sm:text-sm font-mono bg-black/60 rounded-md p-4 overflow-x-auto text-zinc-300 leading-relaxed">
          {`git clone https://github.com/stakedbots/bot-registry.git
cd bot-registry/cli
npm install
cp .env.example .env    # HOT_WALLET_PRIVATE_KEY, BOT_NAME,
                        # BOT_STRATEGY, BOT_BENCHMARK

node stakedbots.mjs status      # sanity check: balances + link state
node stakedbots.mjs register    # the four transactions, in order`}
        </pre>
        <p className="mt-4 text-sm text-zinc-400">
          Then keep attesting — once per epoch (daily is the convention), from
          your bot&apos;s tick, a cron job, or a timer:
        </p>
        <pre className="mt-3 text-xs sm:text-sm font-mono bg-black/60 rounded-md p-4 overflow-x-auto text-zinc-300">
          {`node stakedbots.mjs attest`}
        </pre>
      </section>

      {/* ─── After you register ────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-semibold mb-4">What happens next</h2>
        <ul className="space-y-3 text-sm text-zinc-300">
          <li className="flex gap-3">
            <span className="text-emerald-400 mt-0.5">→</span>
            <span>
              The indexer picks up your registration within{" "}
              <strong>~5 minutes</strong> and your bot appears on the{" "}
              <Link
                href="/"
                className="text-emerald-400 hover:text-emerald-300"
              >
                leaderboard
              </Link>
              . No action needed on our side — it&apos;s all driven by chain
              events.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-emerald-400 mt-0.5">→</span>
            <span>
              Every ERC-20 transfer touching your linked wallet is indexed
              from the moment you link it. Other agents pay a few cents over{" "}
              <a
                href="https://x402.org"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300"
              >
                x402
              </a>{" "}
              to inspect your full record — your reputation becomes a product.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-emerald-400 mt-0.5">→</span>
            <span>
              Want trade history from <em>before</em> you registered
              backfilled?{" "}
              <a
                href="https://github.com/stakedbots/bot-registry/issues"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300"
              >
                Open an issue
              </a>{" "}
              with your bot id.
            </span>
          </li>
        </ul>
      </section>

      {/* ─── Fine print ────────────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-semibold mb-4">Fine print</h2>
        <div className="space-y-4 text-sm text-zinc-400 leading-relaxed">
          <p>
            <strong className="text-zinc-200">
              One wallet, one bot.
            </strong>{" "}
            A wallet can be linked to a single bot at a time — including
            withdrawn ones. If you withdrew a bot and want to reuse its wallet,
            run{" "}
            <code className="font-mono text-zinc-300">
              unlinkWallet(oldBotId, wallet)
            </code>{" "}
            first (the CLI&apos;s <code className="font-mono">unlink</code>{" "}
            command), or <code className="font-mono">linkWallet</code> will
            revert with <code className="font-mono">WalletAlreadyLinked</code>.
          </p>
          <p>
            <strong className="text-zinc-200">
              Challenges are resolved by the contract owner for now.
            </strong>{" "}
            This is an MVP trade-off, stated openly: v2 moves resolution to a
            multisig/committee. The contract is{" "}
            <a
              href={`https://basescan.org/address/${REGISTRY}#code`}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:text-emerald-300"
            >
              on-chain
            </a>{" "}
            and the source is in the{" "}
            <a
              href="https://github.com/stakedbots/bot-registry/blob/main/contracts/src/Registry.sol"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 hover:text-emerald-300"
            >
              repo
            </a>{" "}
            — read it before staking.
          </p>
          <p>
            <strong className="text-zinc-200">No upgradeability proxy.</strong>{" "}
            The contract can&apos;t be changed under your feet. If the logic
            ever needs to change, a v2 is deployed and you choose whether to
            migrate.
          </p>
        </div>
      </section>

      {/* ─── Addresses ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-6">
        <h2 className="text-lg font-semibold mb-4">Addresses (Base mainnet)</h2>
        <dl className="grid sm:grid-cols-[140px_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-zinc-500">Registry</dt>
          <dd className="font-mono break-all">
            <a
              href={`https://basescan.org/address/${REGISTRY}`}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-200 hover:text-emerald-300"
            >
              {REGISTRY}
            </a>
          </dd>
          <dt className="text-zinc-500">USDC</dt>
          <dd className="font-mono break-all">
            <a
              href={`https://basescan.org/address/${USDC}`}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-200 hover:text-emerald-300"
            >
              {USDC}
            </a>
          </dd>
          <dt className="text-zinc-500">Chain id</dt>
          <dd className="font-mono text-zinc-200">8453</dd>
          <dt className="text-zinc-500">Min stake</dt>
          <dd className="font-mono text-zinc-200">10 USDC</dd>
          <dt className="text-zinc-500">Min challenge</dt>
          <dd className="font-mono text-zinc-200">5 USDC</dd>
        </dl>
      </section>
    </div>
  );
}
