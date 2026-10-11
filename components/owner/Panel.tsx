"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { BUDGET } from "@/lib/config";
import { Connections } from "./Connections";
import { Games } from "./Games";
import { Models } from "./Models";
import { Usage } from "./Usage";

export function Panel() {
  const router = useRouter();
  const [version, setVersion] = useState(0);

  async function signOut() {
    await api("/api/owner/logout", "POST");
    router.refresh();
  }

  return (
    <>
      <nav className="subnav" aria-label="Owner sections">
        <a href="#games">Games</a>
        <a href="#connections">Connections</a>
        <a href="#models">Models</a>
        <a href="#usage">Usage</a>
      </nav>
      <section className="section" id="games">
        <span className="label">Games</span>
        <p className="hint">Live games come first. Open one to watch it, or to step through a finished game.</p>
        <Games />
      </section>
      <section className="section" id="connections">
        <span className="label">Connections</span>
        <p className="hint">Sign in or paste a key for each provider you want to offer. Keys are stored encrypted.</p>
        <Connections onChange={() => setVersion((v) => v + 1)} />
      </section>
      <section className="section" id="models">
        <span className="label">Models offered to players</span>
        <p className="hint">Tick a model to offer it. It appears on the setup screen once its provider is connected.</p>
        <Models version={version} onChange={() => setVersion((v) => v + 1)} />
      </section>
      <section className="section" id="usage">
        <span className="label">Usage</span>
        <p className="hint">
          What each model on offer has used of its budget, and the games that leaves for today. A subscription may be{" "}
          {BUDGET.weeklyShare * 100}% used by the end of its week; a paid model may cost {BUDGET.centsPerDay}¢ a day; a
          free model stops at its free limit.
        </p>
        <Usage version={version} />
      </section>
      <div className="actions">
        <button className="btn ghost" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </>
  );
}
