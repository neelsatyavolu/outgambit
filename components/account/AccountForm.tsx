"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/account/input";
import { api } from "@/lib/client/api";
import type { Skill } from "@/lib/rating/elo";
import { Segmented } from "../Segmented";
import { SkillPicker } from "./SkillPicker";

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
  const [skill, setSkill] = useState<Skill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";
  const complete = email.length > 0 && password.length > 0 && (!registering || skill !== null);

  async function submit() {
    setBusy(true);
    setError(null);
    const body = registering ? { email, password, skill } : { email, password };
    const response = await api(`/api/account/${mode}`, "POST", body);
    // On success the form stays busy until the refresh replaces it, so it cannot be sent twice.
    if (response.success) return router.refresh();
    setBusy(false);
    setError(response.error);
  }

  return (
    <>
      <p className="lede">
        You need an account to play. Games are rated, so your account keeps your rating, your games and your stats
        together on every device.
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
        {mode === "register" ? (
          <span className="muted">
            At least {MIN_PASSWORD_LENGTH} characters. If you forget it, a reset link goes to this email, so use one you
            can read.
          </span>
        ) : (
          <Link className="muted" href="/account/forgot" style={{ alignSelf: "flex-start", textDecoration: "underline" }}>
            Forgot password?
          </Link>
        )}
        {registering && (
          <div style={{ marginTop: 16 }}>
            <SkillPicker onChange={setSkill} />
          </div>
        )}
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn" type="submit" disabled={busy || !complete}>
            {mode === "register" ? "Create account" : "Sign in"}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </>
  );
}
