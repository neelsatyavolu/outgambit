import type { Queryable } from "./client";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS games (
    id uuid PRIMARY KEY,
    player_id text NOT NULL,
    ip_hash text NOT NULL,
    day text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    model_label text NOT NULL,
    effort text,
    time_control text NOT NULL,
    initial_ms integer NOT NULL,
    increment_ms integer NOT NULL,
    player_color text NOT NULL,
    fen text NOT NULL,
    ply integer NOT NULL DEFAULT 0,
    white_ms integer NOT NULL,
    black_ms integer NOT NULL,
    turn_started_at timestamptz NOT NULL,
    ai_lease_until timestamptz,
    status text NOT NULL DEFAULT 'active',
    result text,
    reason text,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS games_day_idx ON games (day)`,
  `CREATE INDEX IF NOT EXISTS games_player_idx ON games (player_id, status)`,
  `CREATE TABLE IF NOT EXISTS moves (
    game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    ply integer NOT NULL,
    san text NOT NULL,
    uci text NOT NULL,
    fen_after text NOT NULL,
    spent_ms integer NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (game_id, ply)
  )`,
  `CREATE TABLE IF NOT EXISTS connections (
    provider text PRIMARY KEY,
    secret text NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS models (
    provider text NOT NULL,
    model_id text NOT NULL,
    label text NOT NULL,
    supports_effort boolean NOT NULL,
    enabled boolean NOT NULL,
    PRIMARY KEY (provider, model_id)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  // Later additions go here as idempotent ALTERs, so existing databases catch up.
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS ai_invalid integer NOT NULL DEFAULT 0`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS ai_failures integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS model_ratings (
    key text NOT NULL,
    pool text NOT NULL,
    rating integer NOT NULL,
    games integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key, pool)
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS level text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bullet_rating integer`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS regular_rating integer`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bullet_games integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS regular_games integer NOT NULL DEFAULT 0`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS rated boolean NOT NULL DEFAULT false`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS player_rating_before integer`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS player_rating_after integer`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS ai_rating_before integer`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS ai_rating_after integer`,
  // The arena, since removed, had models play each other. Its games are kept, with the second model
  // here, and are left out wherever people's games are listed or counted.
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS rival_provider text`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS rival_model text`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS rival_label text`,
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS rival_effort text`,
  // What stopped the last call to a model that failed, in the adapter's few fixed words.
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS ai_error text`,
  `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value text NOT NULL
  )`,
  // What each model was asked on each Pacific day, for the budgets in lib/budget.
  `CREATE TABLE IF NOT EXISTS usage (
    day text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    calls integer NOT NULL DEFAULT 0,
    input_tokens integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, provider, model)
  )`,
];

/** Creates any missing tables and columns. Safe to run on every start. */
export async function migrate(db: Queryable): Promise<void> {
  for (const statement of STATEMENTS) await db.query(statement);
}
