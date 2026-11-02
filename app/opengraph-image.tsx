import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Blackletter share card, rendered once at build time from the bundled TTFs
// (satori cannot read woff2). See assets/fonts/OFL.txt for the font license.

export const alt = "Gambit: play a machine. Play a full game of chess against an AI model. outgambit.n3el.dev";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function OpengraphImage() {
  const [regular, medium, serif] = await Promise.all([
    font("Geist-Regular.ttf"),
    font("Geist-Medium.ttf"),
    font("GeistSerif-Regular.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#000",
          color: "#FCFDFF",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 500 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "#4C8DFF" }} />
          Gambit
        </div>
        <div style={{ fontFamily: "Geist Serif", fontSize: 132, lineHeight: 1, letterSpacing: "-0.02em" }}>
          Play a machine.
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.14)",
            paddingTop: 26,
            fontSize: 22,
            color: "#888E90",
          }}
        >
          <span>Play a full game of chess against an AI model.</span>
          <span style={{ color: "#A1A4A5" }}>outgambit.n3el.dev</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist Serif", data: serif, weight: 400, style: "normal" },
      ],
    },
  );
}
