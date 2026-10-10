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
   sign-in ends on), and paste API keys for Gemini, OpenRouter, TypeSafe, OpenAI
   (for the Decisions API) and Vercel AI Gateway. Each row says what it costs.
   "Test" checks each one.
2. **Models.** Tick the models players may choose. ChatGPT and Grok models come
   from `shared-ai-auth` and start switched off. Gemini and OpenRouter models are
   added by ID or from the suggested list, and only free ones are accepted
   (OpenRouter `:free` variants; the Gemini list in `lib/ai/free-models.ts`).
   Gemini is free only while the key's Google project has no billing set up. Jev appears once the TypeSafe key is saved.
3. **Games.** Live games are listed first. Open one to watch it; finished games
   can be stepped through.

## Accounts

Signing in is optional. A visitor can create an account at `/account` with an
email and a password to keep their stats and game history across browsers; the
games already played in that browser move to the account. Gambit sends no email,
so addresses are not verified and there is no password reset.

Sessions are signed with `SECRETS_KEY`, so changing it signs every player out.

## Limits and time controls

All in `lib/config.ts`: 5 games per player per day, 10 per network, 12 overall,
resetting at midnight Pacific. LLMs get 10+10, 20+20 and 45+30. Jev also gets
1+0, 2+1, 3+0 and 5+0.

## Accounts and ratings

Playing needs an account. Sign-up asks for a level or chess.com ratings, which
set the player's starting Elo. Every finished game then moves the player's
rating and the model's, separately for bullet (1+0 to 5+0) and regular games.
Models start at the estimates in `lib/rating/seeds.ts`; `/ratings` shows the
table.

## Arena

The models also play each other, with nobody at the board, so their ratings
rest on more than the games people happen to play. `/arena` lists the games and
anyone can open one to watch it or step through it. A result moves both models'
ratings, in the pool the game was played in.

Every move is a call to a provider, so the arena is capped in several ways:

- A schedule (`vercel.json`) starts one game an hour at most, and only up to the
  owner's number of games a day (6 unless changed). One game is played at a
  time. Setting the number to 0 switches the arena off and calls off the game
  being played.
- Only models ticked under Owner → Arena take part. Models that spend the
  owner's ChatGPT or Grok subscription start out unticked.
- A model with effort levels plays at medium effort only. Bullet games are 3+0
  and regular games 10+10.
- A game still going after 200 plies is called a draw.
- A model that cannot be reached has its game called off, unrated, and sits out
  until the next day. The game still counts toward the day's number if any
  moves were played.

The pairing goes to the model with the fewest rated games, against the opponent
it has met least and, among those, the one rated closest (`lib/arena/pairing.ts`).
A game's clocks only run while a model is being asked for a move, so a game
that waits between runs loses no time.

The schedule needs `CRON_SECRET` set in the deployment; Vercel sends it with
each scheduled call. Without it, games only start from the button in the owner
panel. Settings are in `ARENA` in `lib/config.ts`.

## Premoves

While the model is thinking, the player can queue moves for their coming turns
by clicking or dragging as usual. Queued moves are drawn as if played and go
out one per turn, the moment the turn comes round; if one is not legal by then,
the rest are dropped with it. A pawn premoved to the last rank becomes a queen.
A right-click, a click on a square the queue has no use for, or the Cancel
button calls the queue off. The rules are in `lib/chess/premove.ts`.

## Checks

| Command | What it runs |
|---|---|
| `pnpm test` | Unit and integration tests (in-memory Postgres, fake AI) |
| `TEST_DATABASE_URL=postgres://… pnpm test` | The same tests against a real Postgres server. The locking tests only prove anything here, because the in-memory database runs one transaction at a time. |
| `pnpm test:coverage` | The same, with coverage |
| `pnpm test:e2e` | A browser plays a game against the scripted opponent |
| `pnpm typecheck`, `pnpm lint` | Types and lint |
| `JEV_BENCH=1 TYPESAFE_API_KEY=… pnpm smoke smoke/jev-strength.smoke.ts` | Plays Jev with and without the code assist, to compare. A few hundred Jev calls. |
| `pnpm smoke` | Asks every model you have enabled for a real move. Spends quota. Stop `pnpm dev` first when using the local database. |

## Deploying

Live at https://outgambit.n3el.dev (Vercel project `gambit`, Neon
database `gambit-db`). There is no Git integration; ship a change with
`vercel deploy --prod` from this folder.

Vercel with a Neon Postgres database. Set `DATABASE_URL`, `OWNER_PASSWORD`,
`SECRETS_KEY` and `IP_SALT`, using Neon's pooled connection string. Tables are
created on first use. Slow models think after the response is sent, inside a
300-second function limit; a turn that needs longer is picked up by the next
poll. Limits by network rely on the `x-forwarded-for` header Vercel sets.

Changing `OWNER_PASSWORD` signs the owner out everywhere.

Changing `SECRETS_KEY` makes stored connections unreadable; reconnect them after.

## License

MIT. See `LICENSE`.
