import type { Metadata } from "next";
import { ForgotForm } from "@/components/account/ForgotForm";

export const metadata: Metadata = { title: "Forgot password · Gambit", robots: { index: false } };

export default function ForgotPage() {
  return (
    <>
      <h1 className="display">Forgot password</h1>
      <ForgotForm />
    </>
  );
}
