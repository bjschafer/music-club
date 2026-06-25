-- discussing status is no longer used; normalize any existing rows to listening.
UPDATE rounds SET status = 'listening' WHERE status = 'discussing';
