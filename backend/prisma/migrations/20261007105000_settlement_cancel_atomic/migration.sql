BEGIN;
-- Cancelling a batch cannot leave its debt offsets consumed. The service writes
-- reversals in the same transaction; this deferred guard also protects raw SQL.
CREATE FUNCTION finance_settlement_cancel_committed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='CANCELLED' AND EXISTS (
  SELECT 1 FROM finance_debt_settlements s JOIN finance_debt_offsets o ON o.settlement_id=s.id
  WHERE s.batch_id=NEW.id AND NOT EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.offset_id=o.id)
 ) THEN RAISE EXCEPTION 'Cancelled batch requires all debt offset reversals' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_settlement_cancel_committed AFTER UPDATE ON finance_payout_batches
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_settlement_cancel_committed();
COMMIT;
