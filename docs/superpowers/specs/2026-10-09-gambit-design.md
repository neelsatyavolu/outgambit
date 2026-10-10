# Gambit: play chess against AI models

Design spec, 2026-10-09. Status: awaiting owner review.

## 1. Purpose

A public website where anyone can play a full game of chess against an AI model.
The owner (Neel) pays for and connects the models once; visitors choose a model,
its reasoning effort and a time control, and play on a clear board. The owner can
watch any game live.

Success means:

- A visitor can go from landing page to first move in under a minute, with no sign-in.
- Usage never exceeds the daily limits, whatever visitors do.
- A game always reaches a definite end (result or abort), even when a provider fails.
- The owner can connect every provider and watch games without touching code.

## 2. Decisions made with the owner

| Topic | Decision |
|---|---|
| Player identity | Anonymous. Cookie plus hashed IP. No accounts. |
| AI turn display | The move only, with a thinking indicator. No commentary. |
| Architecture | Next.js on Vercel with Postgres; one-second polling for live state. |
| Illegal AI moves | Two retries, then the AI forfeits. |
| Provider failure | Game aborted with no result; the slot is returned. |
| Day boundary | Midnight America/Los_Angeles. |
| Visual design | Owner's "Machine & Ink" system in `~/DESIGN.md`. |

## 3. Scope

In scope: setup screen, game screen, five AI providers, daily limits, clocks,
owner panel (connections, models, live and finished games).

Out of scope: player accounts, ratings or leaderboards, public spectating, draw
offers, AI commentary, premoves, sound, engine analysis, human-vs-human play.

## 4. Player experience

### 4.1 Setup screen (`/`)

- Shows remaining capacity: the visitor's games left today (of 2) and everyone's
  (of 10). When either is zero, the form is disabled and a countdown to the reset
  is shown.
- If the visitor has a game in progress, the page links to it instead of offering
  a new one.
- Form fields:
  - **Opponent**: models the owner has enabled, grouped by provider.
  - **Effort**: low, medium or high. Shown only when the chosen model supports it.
  - **Time control**: options depend on the opponent (see 4.3).
  - **Color**: white, black or random.

### 4.2 Game screen (`/game/[id]`)

- Board: drag or click-to-move, legal-move dots, last-move highlight, check
  highlight, promotion picker. Flipped when the player has black.
- Both clocks, move list in standard algebraic notation, captured pieces.
- "Thinking" indicator on the AI's turn.
- Resign button. No draw offers.
- End-of-game banner with the result and reason, and a link back to setup.

### 4.3 Time controls

Format is minutes plus seconds added per move.

| Opponent | Options |
|---|---|
| LLM (ChatGPT, Grok, Gemini, OpenRouter) | 10+10, 20+20, 45+30 |
| Jev | 1+0, 2+1, 3+0, 5+0, 10+10, 20+20, 45+30 |

Both sides run on real clocks kept by the server. The AI's clock is charged for
its actual response time, including retries, so a slow model can lose on time.
Running out of time is always a loss (no insufficient-material exception).

### 4.4 Limits

All three numbers live in one config file.

| Limit | Value | Keyed on |
|---|---|---|
| Per player per day | 2 | Cookie ID |
| Per network per day (backstop) | 4 | Hashed IP |
| Everyone per day | 10 | Global |

- A new game must pass all three checks.
- A game uses a slot when it is created. Aborted games do not count.
- One game in progress per player at a time.
- Closing the tab does not pause the clocks. The player can return from the same
  browser; otherwise they lose on time.

### 4.5 How a game ends

Checkmate, stalemate, threefold repetition, fifty-move rule, insufficient
material, timeout, player resignation, AI forfeit by illegal move, or abort by
provider error.

## 5. AI move generation

### 5.1 Adapter interface

Every provider implements one function:

```ts
type MoveRequest = {
  fen: string; history: string[]; legalMoves: string[];   // SAN
  color: "white" | "black"; remainingMs: number;
  model: string; effort?: "low" | "medium" | "high";
};
type MoveResult =
  | { kind: "move"; san: string }
  | { kind: "invalid"; raw: string }        // reply was not a legal move
  | { kind: "provider_error"; message: string };
```

Adapters: `codex`, `grok`, `gemini`, `openrouter`, `jev`. Each turn is a fresh,
stateless request; no conversation is kept between moves.

### 5.2 LLM adapters

- Prompt contents: side to move, FEN, moves so far, the full legal-move list,
  time remaining, and the instruction to reply with exactly one move from the list.
- Reply parsing: trim, strip move numbers and punctuation, match against the
  legal list as SAN, then as UCI. No match is `invalid`.
- On `invalid`, retry up to twice with a message naming the rejected reply. A
  third `invalid` forfeits the game for the AI.
- Per-call timeout: the smaller of the AI's remaining clock and 240 seconds.
- Effort maps to each provider's own parameter. The exact field for Gemini and
  OpenRouter is confirmed against current provider docs during implementation.

| Adapter | Auth | Endpoint |
|---|---|---|
| codex | `shared-ai-auth` OAuth tokens | `chatgpt.com/backend-api/codex/responses` (as in strix) |
| grok | `shared-ai-auth` OAuth tokens | `api.x.ai/v1/chat/completions` (as in strix) |
| gemini | API key | Google Generative Language API |
| openrouter | API key | `openrouter.ai/api/v1/chat/completions` |

### 5.3 Jev adapter

Jev (TypeSafe System One, `api.typesafe.ai/v1/systemone`, model `jev-latest`)
cannot generate text. It answers typed questions about a state.

- State: FEN, a text board, side to move, recent moves.
- One Choice question whose options are the legal moves. Each option's
  description is built in code (piece, from, to, capture, check) because Jev
  reads criteria literally and does not calculate.
- Option order is shuffled on every request, because `jev-1.13` leans toward the
  first option.
- The highest-probability option is played. Timeout 3 seconds; one retry; then
  provider error.
- **Open item, tested first in the plan:** the docs give no maximum number of
  options per Choice. A spike sends a position with 40+ legal moves. If there is
  a cap, the adapter splits the moves into chunks, asks one Choice per chunk in a
  single request, then asks a final Choice among the chunk winners.
- Expectation: Jev plays quickly and weakly. The owner was told this before
  choosing it for bullet.

### 5.4 Provider errors

Outage, rate limit, rejected key or expired sign-in: retry once (after a token
refresh where that applies). If it still fails, the game is aborted, shown to the
player as "the AI is unavailable", and the slot is returned.

## 6. Owner panel (`/owner`)

- **Access**: password from the `OWNER_PASSWORD` environment variable, compared
  in constant time. Success sets a signed, httpOnly, secure, SameSite=Strict
  session cookie lasting 7 days.
- **Connections**
  - ChatGPT and Grok: "Connect" produces the sign-in link via `shared-ai-auth`.
    The owner signs in, then pastes the resulting callback URL (or Grok's bare
    code). The PKCE verifier and state are held in an encrypted httpOnly cookie
    for 10 minutes; state is verified for URL callbacks.
  - Gemini, OpenRouter, TypeSafe: paste an API key; a "Test" button makes the
    cheapest possible call and reports success or the error.
  - Each connection shows its status and can be removed.
- **Models**
  - ChatGPT and Grok models come from `shared-ai-auth`'s `loadModels()` (cached
    five minutes). New catalog entries are off until the owner enables them.
  - Gemini and OpenRouter models are added by hand: model ID, label, and whether
    effort is supported.
  - Jev appears once the TypeSafe key is set.
  - Turning every model off acts as a pause.
- **Games**
  - Today's games, live ones first, with opponent, effort, time control and status.
  - Opening a game shows the player's view read-only, refreshed every second.
  - Finished games can be stepped through move by move.

## 7. Architecture

### 7.1 Stack

- Next.js (App Router, TypeScript) on Vercel.
- Neon Postgres through the Vercel Marketplace.
- `chess.js` for rules; `react-chessboard` for the board.
- `@neelsatyavolu/shared-ai-auth` for OAuth and the ChatGPT/Grok model catalog.
- `zod` for request validation.

### 7.2 Layout

```
app/                 pages and API routes
lib/config.ts        limits and time controls
lib/chess/           rules wrapper, clock maths, reply parsing
lib/game/            create, move, state, housekeeping
lib/ai/              adapter interface, five adapters, prompt builder
lib/owner/           session, connections, encryption
lib/db/              schema and queries
```

Files stay small and single-purpose. Functions return new values and do not
mutate their inputs.

### 7.3 Data

| Table | Holds |
|---|---|
| `games` | id (UUID), player cookie ID, IP hash, provider, model, effort, initial ms, increment ms, player color, FEN, white ms, black ms, turn started at, AI lease until, status (`active`, `finished`, `aborted`), result, reason, created at |
| `moves` | game id, ply, SAN, UCI, FEN after, ms spent, created at |
| `connections` | provider, encrypted secret (OAuth tokens or API key), updated at |
| `models` | provider, model ID, label, supports effort, enabled |

The "day" of a game is `created_at` converted to America/Los_Angeles.

### 7.4 API

All responses use `{ ok, data, error }`.

| Route | Purpose |
|---|---|
| `GET /api/lobby` | Capacity, enabled models, the visitor's active game if any |
| `POST /api/games` | Create a game |
| `GET /api/games/[id]` | Game state; also runs housekeeping |
| `POST /api/games/[id]/moves` | Player move |
| `POST /api/games/[id]/resign` | Player resigns |
| `POST /api/owner/login` | Owner sign-in |
| `/api/owner/connections/*` | Start and finish OAuth, set and test keys, remove |
| `/api/owner/models` | List, add, enable, disable |
| `GET /api/owner/games` | Game list for the owner |

A player may read and act only on games whose cookie ID matches theirs. The owner
session may read any game.

### 7.5 Turn flow

1. **Create.** One transaction takes a Postgres advisory lock, counts today's
   non-aborted games (global, by cookie, by IP hash), checks for an active game,
   and inserts. If the player has black, the AI's first turn starts immediately.
2. **Player move.** Validate with `chess.js` against the stored FEN. Charge the
   player's clock from `turn_started_at`, add the increment, save the move, check
   for game end. Then set the AI lease and start the AI turn.
   - Jev: awaited inside the request, so the response carries Jev's reply.
   - LLM: the response returns at once and the AI turn continues in the
     background (`after()`, with the route's maximum duration raised). The
     Vercel plan's duration limit is confirmed in the plan; the per-call timeout
     is lowered to fit if needed.
3. **Poll.** `GET /api/games/[id]` returns position, clocks and status. Before
   answering it:
   - ends the game if the side to move has run out of time;
   - restarts the AI turn if it is the AI's move and the lease has expired.
4. **AI commit.** An AI move is saved only if the game is still at the ply the
   AI was asked about, so a restarted turn cannot play twice.

Clock shown to clients: stored remaining time minus time since `turn_started_at`
for the side to move. Browsers tick locally between polls.

### 7.6 Tokens and secrets

- Secrets in `connections` are encrypted with AES-256-GCM using `SECRETS_KEY`.
- OAuth tokens are refreshed shortly before expiry inside a `SELECT ... FOR
  UPDATE` on the connection row, using `refreshTokens(provider, token, {
  previous })`, so two games cannot refresh the same token at once.
- Tokens, keys, auth codes and callback URLs are never logged or sent to browsers.

Environment variables: `DATABASE_URL`, `OWNER_PASSWORD`, `SECRETS_KEY`, `IP_SALT`.
The app refuses to start if any is missing.

### 7.7 Security

- All request bodies validated with `zod`; moves validated by `chess.js`.
- State-changing routes accept JSON only and check the `Origin` header.
- Parameterised SQL only.
- Rate limits on owner login and game creation through Vercel Firewall rules;
  if the plan lacks them, a small counter in Postgres instead.
- Error messages shown to players never include provider responses.

## 8. Risks

- **Provider terms.** Serving the public from personal ChatGPT and Grok
  subscription sign-ins likely breaks those providers' terms and could get the
  accounts suspended. Raised with the owner on 2026-10-09, who continued with the
  design; the daily caps limit exposure but do not remove the risk.
- **Jev option cap.** Unknown until the spike in 5.3.
- **Slow models flagging.** High effort at 10+10 may lose on time. Accepted; the
  prompt tells the model its remaining time.
- **Limit evasion.** A determined visitor can change cookie and IP. The global
  cap of 10 bounds the cost.

## 9. Testing

- **Unit**: clock maths, daily-limit counting across the Pacific day boundary,
  reply parsing, prompt building, Jev option building and chunking, encryption
  round trip.
- **Integration** (test Postgres, fake adapters): game creation at and over each
  limit including concurrent requests, full move flow, illegal-move forfeit,
  provider-error abort and slot return, timeout on poll, lease-expiry restart,
  duplicate AI commit rejected, player cannot touch another player's game.
- **End to end** (Playwright): one short game against a scripted fake AI; owner
  login and watching that game.
- **Manual smoke scripts**, one per real provider, run with the owner's
  credentials. Not part of automated tests.
- Coverage target: 80%.

## 10. Deployment

Vercel project with Neon attached. Creating the project, setting environment
variables and choosing a domain are done with the owner at the time, not assumed
by the plan.
