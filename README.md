# Gambit

Play a full, timed game of chess against an AI model. The owner connects the
models once; visitors pick a model, its effort and a time control, and play.

- Design: `docs/superpowers/specs/2026-10-09-gambit-design.md`
- Plan: `docs/superpowers/plans/2026-10-09-gambit.md`

## Run it locally

```bash
pnpm install
cp .env.example .env.local   # then fill in the three secrets as the file explains
pnpm dev
```

`DATABASE_URL=pglite://.data/gambit` keeps the database in a local folder, so
nothing needs provisioning. Add `GAMBIT_FAKE_AI=1` to `.env.local` to get a
scripted test opponent that needs no keys. That switch is ignored in production.

## Owner setup

Open `/owner` and sign in with `OWNER_PASSWORD`.

1. **Connections.** Sign in to ChatGPT and Grok (paste the callback address the
   sign-in ends on), and paste API keys for Gemini, OpenRouter and TypeSafe.
   "Test" checks each one.
2. **Models.** Tick the models players may choose. ChatGPT and Grok models come
   from `shared-ai-auth` and start switched off. Gemini and OpenRouter models are
   added by ID. Jev appears once the TypeSafe key is saved.
3. **Games.** Live games are listed first. Open one to watch it; finished games
   can be stepped through.

## Limits and time controls

All in `lib/config.ts`: 2 games per player per day, 4 per network, 10 overall,
resetting at midnight Pacific. LLMs get 10+10, 20+20 and 45+30. Jev also gets
1+0, 2+1, 3+0 and 5+0.

## Checks

| Command | What it runs |
|---|---|
| `pnpm test` | Unit and integration tests (in-memory Postgres, fake AI) |
| `TEST_DATABASE_URL=postgres://… pnpm test` | The same tests against a real Postgres server. The locking tests only prove anything here, because the in-memory database runs one transaction at a time. |
| `pnpm test:coverage` | The same, with coverage |
| `pnpm test:e2e` | A browser plays a game against the scripted opponent |
| `pnpm typecheck`, `pnpm lint` | Types and lint |
| `pnpm smoke` | Asks every model you have enabled for a real move. Spends quota. Stop `pnpm dev` first when using the local database. |

## Deploying

Vercel with a Neon Postgres database. Set `DATABASE_URL`, `OWNER_PASSWORD`,
`SECRETS_KEY` and `IP_SALT`, using Neon's pooled connection string. Tables are
created on first use. Slow models think after the response is sent, inside a
300-second function limit; a turn that needs longer is picked up by the next
poll. Limits by network rely on the `x-forwarded-for` header Vercel sets.

Changing `OWNER_PASSWORD` signs the owner out everywhere.

Changing `SECRETS_KEY` makes stored connections unreadable; reconnect them after.
