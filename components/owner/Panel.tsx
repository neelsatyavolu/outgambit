"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Connections } from "./Connections";
import { Games } from "./Games";
import { Models } from "./Models";

export function Panel() {
  const router = useRouter();
  const [version, setVersion] = useState(0);

  async function signOut() {
    await api("/api/owner/logout", "POST");
    router.refresh();
  }

  return (
    <>
      <section className="section">
        <span className="label">Games</span>
        <Games />
      </section>
      <section className="section">
        <span className="label">Connections</span>
        <Connections onChange={() => setVersion((v) => v + 1)} />
      </section>
      <section className="section">
        <span className="label">Models offered to players</span>
        <Models version={version} />
      </section>
      <div className="actions">
        <button className="btn ghost" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </>
  );
}
