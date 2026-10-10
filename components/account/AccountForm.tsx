"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/account/input";
import { api } from "@/lib/client/api";
import { Segmented } from "../Segmented";

type Mode = "login" | "register";

const MODES = [
  { value: "login", label: "Sign in" },
  { value: "register", label: "Create account" },
] as const;

export function AccountForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const response = await api(`/api/account/${mode}`, "POST", { email, password });
    // On success the form stays busy until the refresh replaces it, so it cannot be sent twice.
    if (response.success) return router.refresh();
    setBusy(false);
    setError(response.error);
  }

  return (
    <>
      <p className="lede">
        An account keeps your games and stats together on every device. Games already played in this browser come
        with you.
      </p>
      <form
        className="login stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <Segmented
            label="Sign in or create an account"
            options={MODES}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
          />
        </div>
        <label className="label" htmlFor="account-email" style={{ marginTop: 8 }}>
          Email
        </label>
        <input
          id="account-email"
          className="field"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label className="label" htmlFor="account-password">
          Password
        </label>
        <input
          id="account-password"
          className="field"
          type="password"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mode === "register" && (
          <span className="muted">
            At least {MIN_PASSWORD_LENGTH} characters. There is no password reset, so keep it somewhere safe.
          </span>
        )}
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn" type="submit" disabled={busy || email.length === 0 || password.length === 0}>
            {mode === "register" ? "Create account" : "Sign in"}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </>
  );
}
