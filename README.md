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

## Budgets

Every opponent has a budget, checked when a game starts; a game already being
played is always finished. The figures are in `lib/config.ts` and the code in
`lib/budget`. The owner panel's Usage section shows each one.

- **ChatGPT and Grok** spend the owner's subscription. Gambit reads the
  subscription's own weekly meter and only starts a game while it is under a
  line that rises to 50% at the weekly reset, so the owner's own use counts
  and Gambit can never take the week past half. The line runs 10 points ahead
  of an even pace, so a busy start to the week does not close play. ChatGPT's five-hour window
  must also be under half. If the meter cannot be read for an hour, no game
  starts until it can.
- **Gemini and OpenRouter** stop at their free limits: OpenRouter's 50 requests
  a day (1,000 once the account has bought credits), and a cautious 100 a day
  for each Gemini model, since Google only shows that number in AI Studio. A
  "too many requests" from either closes it for an hour.
- **Jev, GPT-6 Luna Decisions and the AI Gateway models** are paid by the
  input token. Each may cost 10¢ a day, counted from the tokens its replies
  report.

A budget's games for the day are split evenly between the players expected
that day: those who have played, plus as many of the past week's daily average
as the day has left for. One network may use two players' shares. Budgets
count by the Pacific day and start again at midnight.

## Time controls

LLMs get 20+20 and 45+30: a model's clock runs
for the whole of each reply, and at anything quicker a slow reply loses it the
game on time. Decision models (Jev, GPT-6 Luna Decisions and the ones on AI
Gateway) get 1+0 only. A model with effort levels plays at low or medium; high
was too slow for a timed game and is no longer offered. Grok 4.7 and 4.6 play
at low only, since medium took them a minute or more over a hard move
(`effortsFor` in `lib/config.ts`).

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
- A model is only paired while its budget has a game to spare beyond what
  players usually start in the rest of the day, going by the past week.
- Only models ticked under Owner → Arena take part. Models that spend the
  owner's ChatGPT or Grok subscription start out unticked.
- A model with effort levels plays at medium effort only, or at low if that is
  all it is offered at. Bullet games are 1+0 and regular games 20+20.
- A game still going after 200 plies is called a draw.
- A model that cannot be reached has its game called off, unrated, and sits out
  until the next day. The game still counts toward the day's number if any
  moves were played. The game's page names the model and what stopped it
  ("HTTP 429"), and Owner → Arena shows the same beside the model.

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
| `JEV_BENCH=1 TYPESAFE_API_KEY=… pnpm smoke smoke/jev-strength.smoke.ts` | Plays Jev with and without the one-move tactics, and with and without being told what each move does, to compare. A few hundred Jev calls. |
| `EFFORT_BENCH=1 pnpm smoke smoke/effort-timing.smoke.ts --silent=false` | Times every model that has effort levels, at each effort, and counts the tactics it finds. A dozen calls per model. |
| `pnpm smoke smoke/usage.smoke.ts --silent=false` | Reads the ChatGPT and Grok meters and OpenRouter's free limit with the stored credentials, and prints them. Spends nothing. |
| `pnpm smoke` | Asks every model you have enabled for a real move. Spends quota. Stop `pnpm dev` first when using the local database. |

## Deploying

Live at https://outgambit.n3el.dev (Vercel project `gambit`, Neon
database `gambit-db`). The project is connected to this repository: a push
to `main` deploys to production.

Vercel with a Neon Postgres database. Set `DATABASE_URL`, `OWNER_PASSWORD`,
`SECRETS_KEY` and `IP_SALT`, using Neon's pooled connection string. Tables are
created on first use. Slow models think after the response is sent, inside a
300-second function limit; a turn that needs longer is picked up by the next
poll. Limits by network rely on the `x-forwarded-for` header Vercel sets.

Changing `OWNER_PASSWORD` signs the owner out everywhere.

Changing `SECRETS_KEY` makes stored connections unreadable; reconnect them after.

## License

MIT. See `LICENSE`.
