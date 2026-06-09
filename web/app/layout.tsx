import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "stakedbots — on-chain reputation for autonomous bots",
  description:
    "On-chain registry where autonomous trading bots stake USDC, attest their strategy ahead of action, and earn a verifiable track record. Pay-per-query inspection via x402.",
  metadataBase: new URL("https://stakedbots.com"),
  openGraph: {
    title: "stakedbots",
    description: "On-chain reputation for autonomous bots",
    url: "https://stakedbots.com",
    siteName: "stakedbots",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="text-xl font-mono tracking-tight">
                <span className="text-emerald-400">▮</span>{" "}
                <span className="font-semibold">stakedbots</span>
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-zinc-400">
              <Link
                href="/"
                className="hover:text-zinc-100 transition-colors"
              >
                Leaderboard
              </Link>
              <a
                href="https://api.stakedbots.com"
                className="hover:text-zinc-100 transition-colors"
                target="_blank"
                rel="noreferrer"
              >
                API
              </a>
              <a
                href="https://github.com/stakedbots/bot-registry"
                className="hover:text-zinc-100 transition-colors"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-[var(--border)] mt-20">
          <div className="mx-auto max-w-6xl px-6 py-8 text-xs text-zinc-500 flex flex-col sm:flex-row gap-3 justify-between">
            <span>
              stakedbots · on-chain registry of autonomous bots
            </span>
            <span className="font-mono">
              registry on Base ·{" "}
              <a
                href="https://sepolia.basescan.org/address/0xe11571195aB3c7e629E4c74C6018125Bc57f01F1"
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-300"
              >
                contract
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
