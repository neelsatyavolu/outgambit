import type { Metadata } from "next";
import { Account } from "@/components/account/Account";
import { AccountForm } from "@/components/account/AccountForm";
import { accountId } from "@/lib/server/context";

export const metadata: Metadata = { title: "Account · Gambit", robots: { index: false } };

export default async function AccountPage() {
  const signedIn = (await accountId()) !== null;
  return (
    <>
      <h1 className="display">Account</h1>
      {signedIn ? <Account /> : <AccountForm />}
    </>
  );
}
