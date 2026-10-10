"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

export function Login() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const response = await api("/api/owner/login", "POST", { password });
    setBusy(false);
    if (response.success) router.refresh();
    else setError(response.error);
  }

  return (
    <form
      className="login stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="label" htmlFor="owner-password">
        Owner password
      </label>
      <input
        id="owner-password"
        className="field"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn" type="submit" disabled={busy || password.length === 0}>
          Sign in
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  );
}
