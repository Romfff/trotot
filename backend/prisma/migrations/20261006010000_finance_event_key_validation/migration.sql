-- Additive correction: PostgreSQL regex repetition bounds cannot exceed 255.
-- Keep the already applied foundation migration immutable.
ALTER TABLE finance_journals DROP CONSTRAINT finance_journals_event_key_check;
ALTER TABLE finance_journals ADD CONSTRAINT finance_journals_event_key_check
  CHECK (length(event_key) BETWEEN 1 AND 256 AND event_key ~ '^[!-~]+$');
