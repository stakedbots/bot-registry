import Link from "next/link";
import { listBots, apiUrl } from "@/lib/api";
import {
  shortAddr,
  fmtUsdc,
  fmtDate,
  statusBadgeClass,
} from "@/lib/format";

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
          <a
            href={apiUrl()}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-zinc-500 transition-colors font-mono"
          >
            api.stakedbots.com
          </a>
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
              {fmtUsdc(totalStake)} USDC total staked
            </p>
          </div>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Could not load bots: {loadError}
          </div>
        ) : bots.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-6 text-sm text-zinc-400">
            No bots registered yet. Be the first.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/60 text-zinc-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">#</th>
                  <th className="text-left px-4 py-3 font-medium">Operator</th>
                  <th className="text-right px-4 py-3 font-medium">Stake</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Wallets</th>
                  <th className="text-right px-4 py-3 font-medium">Missions</th>
                  <th className="text-right px-4 py-3 font-medium">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {bots.map((b) => (
                  <tr
                    key={b.bot_id}
                    className="hover:bg-zinc-900/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/bots/${b.bot_id}`}
                        className="text-emerald-400 hover:text-emerald-300 font-mono font-medium"
                      >
                        #{b.bot_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-300">
                      {shortAddr(b.operator_address)}
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
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">
                      {b.wallets_count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">
                      {b.missions_count}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                      {fmtDate(b.registered_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
