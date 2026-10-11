"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client/api";

/** Asks for a reset link. The answer is the same whether or not the address has an account. */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const response = await api<{ message: string }>("/api/account/forgot", "POST", { email });
    setBusy(false);
    if (response.success) setSent(response.data.message);
    else setError(response.error);
  }

  if (sent) {
    return (
      <div className="notice" role="status">
        <h2>Check your email</h2>
        <p>{sent} It works once and expires in 1 hour.</p>
        <div className="actions">
          <Link className="btn" href="/account">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="lede">Enter the email your account uses and we will send a link to set a new password.</p>
      <form
        className="login stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="label" htmlFor="forgot-email">
          Email
        </label>
        <input
          id="forgot-email"
          className="field"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn" type="submit" disabled={busy || email.length === 0}>
            Send reset link
          </button>
          <Link className="btn ghost" href="/account">
            Back to sign in
          </Link>
        </div>
        {error && <span className="error">{error}</span>}
      </form>
    </>
  );
}
