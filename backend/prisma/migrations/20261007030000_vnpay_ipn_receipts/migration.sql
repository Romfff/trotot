BEGIN;
CREATE TABLE vnpay_ipn_receipts (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 session_id UUID NOT NULL REFERENCES payment_sessions(id) ON DELETE RESTRICT,
 merchant_code VARCHAR(8) NOT NULL,
 transaction_no VARCHAR(15) NOT NULL CHECK(transaction_no ~ '^[1-9][0-9]{0,14}$'),
 payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 amount_vnd NUMERIC NOT NULL CHECK(amount_vnd>0 AND amount_vnd=trunc(amount_vnd) AND amount_vnd<=9999999999),
 pay_date TIMESTAMPTZ,
 received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 outcome VARCHAR(10) NOT NULL CHECK(outcome IN('APPLIED','REVIEW')),
 reason_code VARCHAR(40) NOT NULL CHECK(reason_code IN('MATCHED','AMOUNT_MISMATCH','BOOKING_NOT_PAYABLE','SESSION_CHANGED','PAYMENT_TIME_INVALID','SOURCE_EXISTS')),
 journal_id UUID UNIQUE REFERENCES finance_journals(id) ON DELETE RESTRICT,
 created_txid BIGINT NOT NULL DEFAULT txid_current(),
 UNIQUE(merchant_code,transaction_no),
 CHECK((outcome='APPLIED' AND reason_code='MATCHED' AND journal_id IS NOT NULL) OR (outcome='REVIEW' AND reason_code<>'MATCHED' AND journal_id IS NULL))
);
CREATE UNIQUE INDEX vnpay_ipn_receipts_one_applied_session ON vnpay_ipn_receipts(session_id) WHERE outcome='APPLIED';
CREATE FUNCTION vnpay_session_payable(target UUID,amount NUMERIC,paid_at TIMESTAMPTZ,received TIMESTAMPTZ) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM payment_sessions s JOIN bookings b ON b.id=s.booking_id
  JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
  WHERE s.id=target AND s.provider='VNPAY_SANDBOX' AND s.guest_id=b.guest_id AND b.guest_id<>p.host_id
   AND b.booking_status='PENDING_PAYMENT' AND b.payment_status='PENDING' AND b.version=s.booking_version AND b.version<2147483647
   AND b.total_amount=s.amount_vnd AND amount=s.amount_vnd AND b.expires_at=s.expires_at
   AND received<s.expires_at AND paid_at<s.expires_at AND paid_at>=date_trunc('second',s.created_at)
   AND paid_at<=date_trunc('second',received))
$$;
CREATE FUNCTION vnpay_ipn_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s payment_sessions%ROWTYPE; unit UUID;
BEGIN
 SELECT * INTO s FROM payment_sessions WHERE id=NEW.session_id;
 IF s.id IS NULL OR s.merchant_code<>NEW.merchant_code THEN
  RAISE EXCEPTION 'VNPay receipt requires matching merchant session' USING ERRCODE='23514'; END IF;
 SELECT homestay_unit_id INTO unit FROM bookings WHERE id=s.booking_id;
 PERFORM id FROM homestay_units WHERE id=unit FOR UPDATE;
 PERFORM id FROM bookings WHERE id=s.booking_id FOR UPDATE;
 NEW.received_at=clock_timestamp();NEW.created_txid=txid_current();
 IF NEW.outcome='APPLIED' AND NOT vnpay_session_payable(s.id,NEW.amount_vnd,NEW.pay_date,NEW.received_at) THEN
  RAISE EXCEPTION 'VNPay receipt cannot confirm ineligible booking' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER vnpay_ipn_receipts_insert_guard BEFORE INSERT ON vnpay_ipn_receipts FOR EACH ROW EXECUTE FUNCTION vnpay_ipn_insert_guard();
CREATE TRIGGER vnpay_ipn_receipts_append_only BEFORE UPDATE OR DELETE ON vnpay_ipn_receipts FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER vnpay_ipn_receipts_no_truncate BEFORE TRUNCATE ON vnpay_ipn_receipts FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE FUNCTION vnpay_ipn_proof_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s payment_sessions%ROWTYPE; b bookings%ROWTYPE; j finance_journals%ROWTYPE; owner UUID;
 cash NUMERIC; host NUMERIC; commission NUMERIC; service NUMERIC; tax NUMERIC; accounts_valid BOOLEAN;
BEGIN
 IF NEW.outcome='REVIEW' THEN RETURN NULL; END IF;
 SELECT * INTO s FROM payment_sessions WHERE id=NEW.session_id;
 SELECT * INTO b FROM bookings WHERE id=s.booking_id;
 SELECT p.host_id INTO owner FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=b.homestay_unit_id;
 SELECT * INTO j FROM finance_journals WHERE id=NEW.journal_id;
 SELECT coalesce(sum(amount) FILTER(WHERE side='DEBIT' AND account='CASH_CLEARING'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='HOST_PAYABLE'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_COMMISSION'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_SERVICE'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='TAX_PAYABLE'),0),
  bool_and((side='DEBIT' AND account='CASH_CLEARING') OR (side='CREDIT' AND account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
 INTO cash,host,commission,service,tax,accounts_valid FROM finance_entries WHERE journal_id=j.id;
 IF b.booking_status<>'CONFIRMED' OR b.payment_status<>'PAID' OR b.version<>s.booking_version+1
  OR b.expires_at IS DISTINCT FROM s.expires_at OR b.total_amount IS DISTINCT FROM NEW.amount_vnd
  OR j.id IS NULL OR j.kind<>'PAYMENT' OR j.booking_id IS DISTINCT FROM b.id OR j.host_id IS DISTINCT FROM owner OR j.actor_id IS NOT NULL
  OR j.created_txid<>NEW.created_txid OR NEW.created_txid<>txid_current()
  OR j.event_key<>'vnpay-paid:'||NEW.merchant_code||':'||NEW.transaction_no
  OR (SELECT count(*) FROM finance_journals WHERE booking_id=b.id AND kind='PAYMENT')<>1
  OR accounts_valid IS DISTINCT FROM true
  OR ROW(cash,host,commission,service,tax) IS DISTINCT FROM ROW(b.total_amount,b.host_payout_amount,b.commission_amount,b.service_fee,b.tax_amount) THEN
   RAISE EXCEPTION 'VNPay receipt requires atomic exact payment journal and booking confirmation' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER vnpay_ipn_receipts_atomic_proof AFTER INSERT ON vnpay_ipn_receipts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION vnpay_ipn_proof_guard();
COMMIT;
