BEGIN;
-- A second PAYMENT journal must not bypass the already-validated receipt by
-- using a new journal ID. Check related newly recorded receipt on journal insert.
CREATE FUNCTION vnpay_ipn_recheck_journal_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
 FOR target IN SELECT r.id FROM vnpay_ipn_receipts r JOIN payment_sessions s ON s.id=r.session_id
  WHERE s.booking_id=NEW.booking_id AND r.outcome='APPLIED' AND r.created_txid=txid_current()
  LOOP PERFORM vnpay_ipn_validate_proof(target); END LOOP;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER vnpay_ipn_journal_proof AFTER INSERT ON finance_journals DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION vnpay_ipn_recheck_journal_proof();
COMMIT;
