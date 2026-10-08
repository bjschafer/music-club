-- Small key/value store for bot-wide state (e.g. the hash of the last slash
-- command set synced to Discord).
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
