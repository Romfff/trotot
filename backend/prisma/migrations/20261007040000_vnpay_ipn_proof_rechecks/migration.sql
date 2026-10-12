BEGIN;
-- Additive correction: receipt-only deferred validation can be forced early,
-- then followed by same-transaction entry/booking writes. Recheck all dependents.
CREATE FUNCTION vnpay_ipn_validate_proof(target UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r vnpay_ipn_receipts%ROWTYPE; s payment_sessions%ROWTYPE; b bookings%ROWTYPE; j finance_journals%ROWTYPE; owner UUID;
 cash NUMERIC; host NUMERIC; commission NUMERIC; service NUMERIC; tax NUMERIC; accounts_valid BOOLEAN;
BEGIN
 SELECT * INTO r FROM vnpay_ipn_receipts WHERE id=target;
 IF r.id IS NULL OR r.outcome='REVIEW' THEN RETURN; END IF;
 SELECT * INTO s FROM payment_sessions WHERE id=r.session_id;
 SELECT * INTO b FROM bookings WHERE id=s.booking_id;
 SELECT p.host_id INTO owner FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=b.homestay_unit_id;
 SELECT * INTO j FROM finance_journals WHERE id=r.journal_id;
 SELECT coalesce(sum(amount) FILTER(WHERE side='DEBIT' AND account='CASH_CLEARING'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='HOST_PAYABLE'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_COMMISSION'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_SERVICE'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='TAX_PAYABLE'),0),
  bool_and((side='DEBIT' AND account='CASH_CLEARING') OR (side='CREDIT' AND account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
 INTO cash,host,commission,service,tax,accounts_valid FROM finance_entries WHERE journal_id=j.id;
 IF b.booking_status<>'CONFIRMED' OR b.payment_status<>'PAID' OR b.version<>s.booking_version+1
  OR b.expires_at IS DISTINCT FROM s.expires_at OR b.total_amount IS DISTINCT FROM r.amount_vnd
  OR j.id IS NULL OR j.kind<>'PAYMENT' OR j.booking_id IS DISTINCT FROM b.id OR j.host_id IS DISTINCT FROM owner OR j.actor_id IS NOT NULL
  OR j.created_txid<>r.created_txid OR r.created_txid<>txid_current()
  OR j.event_key<>'vnpay-paid:'||r.merchant_code||':'||r.transaction_no
  OR (SELECT count(*) FROM finance_journals WHERE booking_id=b.id AND kind='PAYMENT')<>1
  OR accounts_valid IS DISTINCT FROM true
  OR ROW(cash,host,commission,service,tax) IS DISTINCT FROM ROW(b.total_amount,b.host_payout_amount,b.commission_amount,b.service_fee,b.tax_amount) THEN
   RAISE EXCEPTION 'VNPay receipt requires atomic exact payment journal and booking confirmation' USING ERRCODE='23514';
 END IF;
END; $$;
CREATE OR REPLACE FUNCTION vnpay_ipn_proof_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM vnpay_ipn_validate_proof(NEW.id);RETURN NULL;END; $$;
CREATE FUNCTION vnpay_ipn_recheck_related_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN
  FOR target IN SELECT r.id FROM vnpay_ipn_receipts r JOIN payment_sessions s ON s.id=r.session_id
   WHERE s.booking_id=NEW.id AND r.outcome='APPLIED' AND r.created_txid=txid_current()
   LOOP PERFORM vnpay_ipn_validate_proof(target); END LOOP;
 ELSE
  FOR target IN SELECT id FROM vnpay_ipn_receipts WHERE journal_id=NEW.journal_id AND outcome='APPLIED' AND created_txid=txid_current()
   LOOP PERFORM vnpay_ipn_validate_proof(target); END LOOP;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER vnpay_ipn_booking_proof AFTER UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION vnpay_ipn_recheck_related_proof();
CREATE CONSTRAINT TRIGGER vnpay_ipn_entry_proof AFTER INSERT ON finance_entries DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION vnpay_ipn_recheck_related_proof();
COMMIT;
