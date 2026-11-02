import type { Metadata, Viewport } from "next";
import { GeistSerif } from "geist/font/serif";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import { THEME_SCRIPT } from "@/components/theme-script";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

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
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${GeistSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div className="shell">
          <header className="masthead">
            <Link href="/" className="mark">
              <i aria-hidden="true" />
              Gambit
            </Link>
            <nav>
              <span className="muted tagline">chess vs machines</span>
              <Link href="/ratings">Ratings</Link>
              <Link href="/account">Account</Link>
              <Link href="/owner">Owner</Link>
              <a className="github" href="https://github.com/neelsatyavolu/outgambit" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <ThemeToggle />
            </nav>
          </header>
          <main>{children}</main>
        </div>
        <Script src="https://analytics.n3el.dev/p.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
