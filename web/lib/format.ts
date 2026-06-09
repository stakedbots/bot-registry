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
