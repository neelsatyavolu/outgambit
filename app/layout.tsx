import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://outgambit.n3el.dev"),
  title: "Gambit",
  description: "Play a full game of chess against an AI model.",
  openGraph: {
    title: "Gambit — play chess against an AI model",
    description: "Play a full game of chess against an AI model.",
    url: "/",
    siteName: "Gambit",
    type: "website",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body>
        <div className="shell">
          <header className="masthead">
            <Link href="/" className="mark">
              Gambit<span className="caret" aria-hidden="true">▏</span>
            </Link>
            <nav>
              <span className="muted tagline">chess vs machines</span>
              <Link href="/ratings">Ratings</Link>
              <Link href="/account">Account</Link>
              <Link href="/owner">Owner</Link>
              <a href="https://github.com/neelsatyavolu/outgambit" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
