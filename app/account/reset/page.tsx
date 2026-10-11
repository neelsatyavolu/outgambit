import type { Metadata } from "next";
import { ResetForm } from "@/components/account/ResetForm";

// The address of this page holds the reset token, so the page tells the browser never to send it on as a referrer.
export const metadata: Metadata = { title: "New password · Gambit", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="display">New password</h1>
      <ResetForm token={typeof token === "string" ? token : null} />
    </>
  );
}
