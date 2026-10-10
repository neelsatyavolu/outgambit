import type { Metadata } from "next";
import { Login } from "@/components/owner/Login";
import { Panel } from "@/components/owner/Panel";
import { isOwner } from "@/lib/server/context";

export const metadata: Metadata = { title: "Owner · Gambit", robots: { index: false } };

export default async function OwnerPage() {
  const owner = await isOwner();
  return (
    <>
      <h1 className="display">Owner</h1>
      {owner ? <Panel /> : <Login />}
    </>
  );
}
