BEGIN;
-- APPROVED-14 #10/#13: Admin adjustments are append-only and same-Host.
-- This serializes NEW adjustments with payout/bank operations; it does not
-- authorize debt settlement or relax any existing payout provenance gate.
CREATE FUNCTION finance_adjustment_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='ADJUSTMENT' THEN
  -- uuid::text is canonical even when the caller used upper-case spelling.
  -- Acquire the same lock as payout BEFORE role checks and journal writes.
  PERFORM pg_advisory_xact_lock(hashtextextended('bank:'||NEW.host_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE) THEN
   RAISE EXCEPTION 'Financial adjustment requires active Admin' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finance_journals_adjustment_serialization BEFORE INSERT ON finance_journals
 FOR EACH ROW EXECUTE FUNCTION finance_adjustment_insert_guard();
COMMIT;
