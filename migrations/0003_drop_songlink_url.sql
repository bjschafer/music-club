-- Drop the songlink_url column — Songlink/Odesli enrichment was replaced by
-- constructing platform search URLs directly in the pick announcement thread.
ALTER TABLE rounds DROP COLUMN songlink_url;
