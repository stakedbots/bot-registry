export function shortAddr(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtUsdc(usdc: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usdc);
}

export type PnlView = { text: string; pct: string | null; className: string };

/** Render PnL with sign + color. null → muted em-dash (stats not computed yet). */
export function fmtPnl(pnlUsd: number | null, pnlPct: number | null): PnlView {
  if (pnlUsd === null || pnlUsd === undefined) {
    return { text: "—", pct: null, className: "text-zinc-600" };
  }
  const sign = pnlUsd >= 0 ? "+" : "−";
  const text = `${sign}$${fmtUsdc(Math.abs(pnlUsd))}`;
  const pct =
    pnlPct === null || pnlPct === undefined
      ? null
      : `${pnlUsd >= 0 ? "+" : "−"}${Math.abs(pnlPct * 100).toFixed(1)}%`;
  return {
    text,
    pct,
    className: pnlUsd >= 0 ? "text-emerald-400" : "text-red-400",
  };
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function basescanAddr(addr: string, chain: string): string {
  const base = chain === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${base}/address/${addr}`;
}

export function basescanTx(tx: string, chain: string): string {
  const base = chain === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${base}/tx/${tx}`;
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d2 = Math.floor(hr / 24);
  if (d2 < 30) return `${d2}d ago`;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function ipfsToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

export type ChainBadge = { label: string; className: string; full: string };

export function chainBadge(chain: string): ChainBadge {
  switch (chain) {
    case "base":
      return {
        label: "mainnet",
        full: "Base mainnet",
        className:
          "bg-blue-500/15 text-blue-300 border border-blue-500/30",
      };
    case "baseSepolia":
      return {
        label: "testnet",
        full: "Base Sepolia",
        className:
          "bg-zinc-700/40 text-zinc-300 border border-zinc-600/40",
      };
    default:
      return {
        label: chain,
        full: chain,
        className: "bg-zinc-700/40 text-zinc-300 border border-zinc-600/40",
      };
  }
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
    case "slashed":
      return "bg-red-500/15 text-red-300 border border-red-500/30";
    case "withdrawn":
      return "bg-zinc-700/40 text-zinc-300 border border-zinc-600/40";
    case "paused":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
    default:
      return "bg-zinc-700/40 text-zinc-300 border border-zinc-600/40";
  }
}
