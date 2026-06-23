-- 0002_round_reminders.sql — track whether a listening-window reminder was sent,
-- so the daily cron nudges each round at most once.
ALTER TABLE rounds ADD COLUMN reminded_at INTEGER;
