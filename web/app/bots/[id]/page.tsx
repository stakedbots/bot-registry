import Link from "next/link";
import { notFound } from "next/navigation";
import { getBot, apiUrl } from "@/lib/api";
import {
  shortAddr,
  fmtUsdc,
  fmtDateTime,
  basescanAddr,
  basescanTx,
  ipfsToHttp,
  statusBadgeClass,
  chainBadge,
} from "@/lib/format";

export const revalidate = 30;

export default async function BotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bot = await getBot(id);
  if (!bot) notFound();

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="text-sm text-zinc-500 mb-2">
        <Link href="/" className="hover:text-zinc-300">
          ← Leaderboard
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-semibold font-mono">
            Bot <span className="text-emerald-400">#{bot.on_chain_bot_id}</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Operated by{" "}
            <a
              href={basescanAddr(bot.operator_address, bot.chain)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-zinc-200 hover:text-emerald-300"
            >
              {shortAddr(bot.operator_address)}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-3 py-1 text-xs rounded-md font-medium ${chainBadge(
              bot.chain
            ).className}`}
          >
            {chainBadge(bot.chain).full}
          </span>
          <span
            className={`inline-flex items-center px-3 py-1 text-xs rounded-md font-medium ${statusBadgeClass(
              bot.status
            )}`}
          >
            {bot.status}
          </span>
        </div>
      </header>

      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        <Stat label="Stake" value={`${fmtUsdc(bot.stake_amount_usdc)} USDC`} />
        <Stat
          label="Wallets linked"
          value={String(bot.wallets_count)}
          hint="active trading wallets"
        />
        <Stat
          label="Missions attested"
          value={String(bot.missions_count)}
          hint="strategy commitments on-chain"
        />
      </div>

      {/* ─── On-chain identity ─────────────────────────────────────── */}
      <section className="rounded-lg border border-[var(--border)] bg-zinc-950/40 mb-8">
        <header className="px-5 py-3 border-b border-[var(--border)] text-sm font-medium text-zinc-300">
          On-chain identity
        </header>
        <dl className="grid sm:grid-cols-[180px_1fr] gap-x-6 gap-y-3 px-5 py-4 text-sm">
          <Row label="Chain" value={bot.chain} mono />
          <Row label="Operator" mono>
            <a
              href={basescanAddr(bot.operator_address, bot.chain)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-emerald-300"
            >
              {bot.operator_address}
            </a>
          </Row>
          <Row label="Manifest URI" mono>
            <a
              href={ipfsToHttp(bot.manifest_uri)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-emerald-300 break-all"
            >
              {bot.manifest_uri}
            </a>
          </Row>
          <Row label="Manifest hash" mono>
            <span className="break-all">{bot.manifest_hash}</span>
          </Row>
          <Row label="Registered" value={fmtDateTime(bot.registered_at)} />
          <Row label="Block" mono value={String(bot.registered_block)} />
          <Row label="Tx" mono>
            <a
              href={basescanTx(bot.registered_tx, bot.chain)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-emerald-300 break-all"
            >
              {bot.registered_tx}
            </a>
          </Row>
        </dl>
      </section>

      {/* ─── Inspect deeper ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-6">
        <h2 className="text-lg font-semibold">Inspect deeper</h2>
        <p className="mt-2 text-sm text-zinc-400 max-w-2xl">
          Full mission history, linked wallets, and on-chain event log are
          available via the API — paid with USDC over x402, no signup.
        </p>
        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          <PayCallout
            method="GET"
            path={`/bots/${bot.bot_id}/detail`}
            price="$0.10"
            description="Wallets, missions, stats"
          />
          <PayCallout
            method="GET"
            path={`/bots/${bot.bot_id}/events`}
            price="$0.05"
            description="Raw on-chain event log"
          />
        </div>
        <p className="mt-5 text-xs text-zinc-500">
          API base:{" "}
          <a
            href={apiUrl()}
            target="_blank"
            rel="noreferrer"
            className="font-mono hover:text-zinc-300"
          >
            {apiUrl()}
          </a>
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-zinc-950/40 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-mono">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function Row({
  label,
  value,
  children,
  mono,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={mono ? "font-mono text-zinc-200" : "text-zinc-200"}>
        {children ?? value}
      </dd>
    </>
  );
}

function PayCallout({
  method,
  path,
  price,
  description,
}: {
  method: string;
  path: string;
  price: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-emerald-400">{method}</span>
        <span className="text-zinc-300">{path}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{description}</span>
        <span className="text-sm font-mono text-emerald-300">{price}</span>
      </div>
    </div>
  );
}
