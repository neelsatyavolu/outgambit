"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH, RESET_LINK_DEAD } from "@/lib/account/input";
import { api } from "@/lib/client/api";

/** Sets a new password with the token from a reset email. `token` is null when the address had none. */
export function ResetForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [dead, setDead] = useState(!token);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const response = await api("/api/account/reset", "POST", { token, password });
    // On success the form stays busy until the account page replaces it, so it cannot be sent twice.
    // Replacing also takes the link, and the token in it, out of the browser's history.
    if (response.success) return router.replace("/account");
    setBusy(false);
    if (response.error === RESET_LINK_DEAD) setDead(true);
    else setError(response.error);
  }

  if (dead) {
    return (
      <div className="notice" role="alert">
        <h2>Link not valid</h2>
        <p>{RESET_LINK_DEAD}</p>
        <div className="actions">
          <Link className="btn accent" href="/account/forgot">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <p className="lede">Choose a new password. Setting it signs your account out everywhere else.</p>
      <form
        className="login stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="label" htmlFor="reset-password">
          New password
        </label>
        <input
          id="reset-password"
          className="field"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="muted">At least {MIN_PASSWORD_LENGTH} characters.</span>
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn" type="submit" disabled={busy || password.length === 0}>
            Set password
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </>
  );
}
