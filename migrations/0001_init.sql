-- 0001_init.sql — Music Club core schema.
-- Multi-tenant: every row is scoped by guild_id (one independent club per server).
-- Apply with: npm run db:migrate:local  (or :remote for production).

-- One club per Discord server. current_dj_id points at the member on deck.
-- (clubs <-> members is a mutual reference; SQLite permits the forward ref.)
CREATE TABLE clubs (
  guild_id            TEXT    PRIMARY KEY,
  name                TEXT    NOT NULL DEFAULT 'Music Club',
  announce_channel_id TEXT,
  admin_role_id       TEXT,
  current_dj_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
  default_listen_days INTEGER NOT NULL DEFAULT 7,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Members of a club. rotation_pos defines DJ order; pure listeners can pass forever.
CREATE TABLE members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL REFERENCES clubs(guild_id) ON DELETE CASCADE,
  discord_id   TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  rotation_pos INTEGER NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  picks_count  INTEGER NOT NULL DEFAULT 0,
  passes_count INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (guild_id, discord_id)
);

-- The historical record: every pick a DJ made. This table alone is enough to
-- build ratings / a Hall of Fame later without any migration.
CREATE TABLE rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL REFERENCES clubs(guild_id) ON DELETE CASCADE,
  dj_id        INTEGER NOT NULL REFERENCES members(id),
  title        TEXT    NOT NULL,
  artist       TEXT,
  type         TEXT    NOT NULL CHECK (type IN ('song', 'album')),
  url          TEXT    NOT NULL,
  songlink_url TEXT,
  note         TEXT,
  listen_by    INTEGER,
  status       TEXT    NOT NULL DEFAULT 'listening'
                 CHECK (status IN ('listening', 'discussing', 'archived')),
  thread_id    TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  wrapped_at   INTEGER
);

CREATE INDEX idx_members_guild_rotation ON members (guild_id, rotation_pos);
CREATE INDEX idx_rounds_guild_status    ON rounds  (guild_id, status);
CREATE INDEX idx_rounds_guild_created   ON rounds  (guild_id, created_at);

-- At most one non-archived round per guild (one thing "playing" at a time).
CREATE UNIQUE INDEX idx_rounds_one_active_per_guild
  ON rounds (guild_id)
  WHERE status IN ('listening', 'discussing');
