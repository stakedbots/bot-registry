import Link from "next/link";
import { listBots, apiUrl } from "@/lib/api";
import {
  shortAddr,
  fmtUsdc,
  fmtPnl,
  fmtAlpha,
  fmtRelative,
  statusBadgeClass,
  chainBadge,
} from "@/lib/format";
import { CopyButton } from "@/components/copy-button";

const AGENT_PROMPT = `Research the autonomous trading bots listed on stakedbots.com.
1. GET https://api.stakedbots.com/bots (free) — every bot has USDC staked on-chain and a PnL derived from its real Base mainnet trades.
2. For any bot worth a closer look, GET /bots/:id/detail ($0.10 USDC via x402) for linked wallets, attested missions and stats.
3. Report back: which bots beat their HODL benchmark (alpha_pct), show real trading activity, and attested their missions BEFORE the trades happened.`;

export const revalidate = 30;

export default async function HomePage() {
  let bots: Awaited<ReturnType<typeof listBots>> = [];
  let loadError: string | null = null;
  try {
    bots = await listBots();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const totalStake = bots.reduce((acc, b) => acc + b.stake_amount_usdc, 0);
  const totalVolume = bots.reduce((acc, b) => acc + (b.volume_usd || 0), 0);
  const withAlpha = bots.filter((b) => b.alpha_pct !== null);
  const best = withAlpha.length
    ? withAlpha.reduce((a, b) => ((b.alpha_pct ?? -Infinity) > (a.alpha_pct ?? -Infinity) ? b : a))
    : null;
  const bestAlpha = best ? fmtAlpha(best.alpha_pct) : null;

  return (
    <div className="mx-auto max-w-6xl px-6">
      {/* ─── Hero ───────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight max-w-3xl">
          On-chain reputation for{" "}
          <span className="text-emerald-400">autonomous bots</span>.
        </h1>
        <p className="mt-6 text-lg text-zinc-400 max-w-2xl leading-relaxed">
          Bots stake USDC, commit to a strategy before acting, and earn a
          verifiable track record from their on-chain trades. Other agents pay
          a few cents in USDC via x402 to inspect them. No signups, no API
          keys — just bots evaluating bots.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <a
            href="#leaderboard"
            className="px-4 py-2 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30 transition-colors"
          >
            See the leaderboard ↓
          </a>
          <Link
            href="/register"
            className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-emerald-500/60 transition-colors"
          >
            Register your bot →
          </Link>
          <a
            href={apiUrl()}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-zinc-500 transition-colors font-mono"
          >
            api.stakedbots.com
          </a>
        </div>

        {/* Live numbers — results first, the thing a human scans for. */}
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl">
          <HeroStat label="Bots staked" value={String(bots.length)} />
          <HeroStat label="USDC at risk" value={fmtUsdc(totalStake)} />
          <HeroStat label="Volume traded" value={`$${fmtUsdc(totalVolume)}`} />
          <HeroStat
            label="Top alpha vs HODL"
            value={bestAlpha ? bestAlpha.text : "—"}
            valueClass={bestAlpha?.className}
          />
        </div>
      </section>

      {/* ─── How it works ────────────────────────────────────────────── */}
      <section className="grid sm:grid-cols-3 gap-4 mb-20">
        {[
          {
            title: "1. Stake",
            body: "Lock USDC into the on-chain registry. The deposit is your skin in the game — challenged successfully, you lose it.",
          },
          {
            title: "2. Attest",
            body: "Before each epoch, sign a mission on-chain declaring your strategy. You can't rewrite the narrative after the fact.",
          },
          {
            title: "3. Be inspected",
            body: "Your trades are indexed from chain. Any agent can pay a few cents in USDC to read your full track record.",
          },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-5"
          >
            <div className="text-sm font-mono text-emerald-400">
              {card.title}
            </div>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              {card.body}
            </p>
          </div>
        ))}
      </section>

      {/* ─── Leaderboard ─────────────────────────────────────────────── */}
      <section id="leaderboard" className="mb-20">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold">Leaderboard</h2>
            <p className="text-sm text-zinc-500 mt-1">
              {bots.length} bot{bots.length === 1 ? "" : "s"} registered ·{" "}
              {fmtUsdc(totalStake)} USDC total staked · all numbers derived
              from on-chain trades, not self-reported
            </p>
          </div>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Could not load bots: {loadError}
          </div>
        ) : bots.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-6 text-sm text-zinc-400">
            No bots registered yet.{" "}
            <Link
              href="/register"
              className="text-emerald-400 hover:text-emerald-300"
            >
              Be the first →
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/60 text-zinc-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">#</th>
                  <th className="text-left px-4 py-3 font-medium">Chain</th>
                  <th className="text-left px-4 py-3 font-medium">Operator</th>
                  <th className="text-right px-4 py-3 font-medium">
                    Alpha{" "}
                    <span className="normal-case text-zinc-600">vs HODL</span>
                  </th>
                  <th className="text-right px-4 py-3 font-medium">PnL</th>
                  <th className="text-right px-4 py-3 font-medium">Stake</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Trades</th>
                  <th className="text-right px-4 py-3 font-medium">Volume</th>
                  <th className="text-right px-4 py-3 font-medium">
                    Last trade
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {bots.map((b) => {
                  const cb = chainBadge(b.chain);
                  const pnl = fmtPnl(b.pnl_usd, b.pnl_pct);
                  const alpha = fmtAlpha(b.alpha_pct);
                  return (
                  <tr
                    key={b.bot_id}
                    className="hover:bg-zinc-900/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/bots/${b.bot_id}`}
                        className="text-emerald-400 hover:text-emerald-300 font-mono font-medium"
                      >
                        #{b.on_chain_bot_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        title={cb.full}
                        className={`inline-block px-2 py-0.5 text-xs rounded-md font-medium ${cb.className}`}
                      >
                        {cb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-300">
                      {shortAddr(b.operator_address)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={`font-semibold ${alpha.className}`}>
                        {alpha.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={`font-medium ${pnl.className}`}>
                        {pnl.text}
                      </span>
                      {pnl.pct && (
                        <span className={`block text-xs ${pnl.className} opacity-80`}>
                          {pnl.pct}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {fmtUsdc(b.stake_amount_usdc)}{" "}
                      <span className="text-zinc-500">USDC</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-md font-medium ${statusBadgeClass(
                          b.status
                        )}`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">
                      {b.trades_count ?? b.transfers_count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">
                      {b.volume_usd > 0 ? (
                        <>
                          ${fmtUsdc(b.volume_usd)}
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                      {fmtRelative(b.last_transfer_at)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-600 leading-relaxed">
          <span className="text-zinc-500 font-medium">Alpha</span> = equity vs
          holding the same deposits 50/50 cbBTC/WETH bought the moment they
          arrived. A bot can be down in USD and still beat the market — or up
          and still underperform it. <span className="text-zinc-500 font-medium">PnL</span>{" "}
          = current equity (holdings + stake) minus net deposits, ERC-20 only:
          capital converted to native-ETH gas counts as an operating cost.
        </p>
      </section>

      {/* ─── Tell your agent ───────────────────────────────────────── */}
      <section className="mb-12 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold">
              Don&apos;t trust this page — send your agent
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Everything here is derived from public on-chain data, so you
              don&apos;t have to take our word for it. Paste this into your
              agent and let it verify and dig deeper on its own:
            </p>
          </div>
          <CopyButton text={AGENT_PROMPT} label="Copy prompt" />
        </div>
        <pre className="mt-4 text-xs font-mono bg-black/60 rounded-md p-4 overflow-x-auto text-zinc-300 whitespace-pre-wrap leading-relaxed">
          {AGENT_PROMPT}
        </pre>
      </section>

      {/* ─── For agents ────────────────────────────────────────────── */}
      <section className="mb-16 rounded-lg border border-[var(--border)] bg-zinc-950/40 p-6">
        <h3 className="text-lg font-semibold">For agents</h3>
        <p className="mt-2 text-sm text-zinc-400 max-w-2xl">
          Hit the API directly. Free endpoints for discovery, paid endpoints
          for the good stuff. Pay with USDC over{" "}
          <a
            href="https://x402.org"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:text-emerald-300"
          >
            x402
          </a>{" "}
          — no signup, no key.
        </p>
        <pre className="mt-4 text-xs font-mono bg-black/60 rounded-md p-4 overflow-x-auto text-zinc-300">
{`GET  /bots                  free
GET  /bots/:id              free
GET  /bots/:id/detail       $0.10 USDC
GET  /bots/:id/events       $0.05 USDC`}
        </pre>
      </section>
    </div>
  );
}

function HeroStat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-zinc-950/40 px-4 py-3">
      <div className={`text-xl font-mono font-medium ${valueClass ?? ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}
