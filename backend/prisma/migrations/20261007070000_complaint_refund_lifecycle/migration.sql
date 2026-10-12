-- APPROVED-S4-REFUND-LIFECYCLE: additive; no applied migration or financial history rewritten.
BEGIN;
ALTER TABLE finance_complaint_resolutions DROP CONSTRAINT finance_complaint_resolutions_decision_check;
ALTER TABLE finance_complaint_resolutions ADD CONSTRAINT finance_complaint_resolutions_decision_check
 CHECK(decision IN('HOST','FULL_REFUND','PARTIAL_REFUND'));
CREATE TABLE finance_complaint_refunds (
 complaint_id UUID PRIMARY KEY REFERENCES finance_complaint_resolutions(complaint_id) ON DELETE RESTRICT,
 booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
 source_journal_id UUID NOT NULL REFERENCES finance_journals(id) ON DELETE RESTRICT,
 reversal_journal_id UUID NOT NULL UNIQUE REFERENCES finance_journals(id) ON DELETE RESTRICT,
 booking_version_before INT NOT NULL CHECK(booking_version_before BETWEEN 1 AND 2147483646),
 booking_status_before VARCHAR(30) NOT NULL CHECK(booking_status_before IN('CONFIRMED','CHECKED_IN','COMPLETED')),
 base_amount NUMERIC NOT NULL,cleaning_fee NUMERIC NOT NULL,service_fee NUMERIC NOT NULL,tax_amount NUMERIC NOT NULL,
 refund_amount NUMERIC NOT NULL,commission_reversal NUMERIC NOT NULL,host_reduction NUMERIC NOT NULL,
 checkout_at TIMESTAMPTZ NOT NULL,hold_start TIMESTAMPTZ,
 created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current()),
 CHECK(base_amount>=0 AND base_amount=trunc(base_amount) AND base_amount<10000000000000),
 CHECK(cleaning_fee>=0 AND cleaning_fee=trunc(cleaning_fee) AND cleaning_fee<10000000000000),
 CHECK(service_fee>=0 AND service_fee=trunc(service_fee) AND service_fee<10000000000000),
 CHECK(tax_amount>=0 AND tax_amount=trunc(tax_amount) AND tax_amount<10000000000000),
 CHECK(refund_amount>0 AND refund_amount<10000000000000 AND refund_amount=base_amount+cleaning_fee+service_fee+tax_amount),
 CHECK(commission_reversal>=0 AND commission_reversal=trunc(commission_reversal) AND commission_reversal<10000000000000),
 CHECK(host_reduction>=0 AND host_reduction=trunc(host_reduction) AND host_reduction<10000000000000)
);
CREATE TRIGGER finance_complaint_refunds_append_only BEFORE UPDATE OR DELETE ON finance_complaint_refunds
 FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_complaint_refunds_no_truncate BEFORE TRUNCATE ON finance_complaint_refunds
 FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
ALTER TABLE finance_refunds ALTER COLUMN cancellation_id DROP NOT NULL;
ALTER TABLE finance_refunds ADD COLUMN complaint_id UUID UNIQUE REFERENCES finance_complaint_refunds(complaint_id) ON DELETE RESTRICT;
ALTER TABLE finance_refunds ADD CONSTRAINT finance_refunds_one_source CHECK(num_nonnulls(cancellation_id,complaint_id)=1);

CREATE FUNCTION finance_complaint_refund_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings%ROWTYPE; r finance_complaint_resolutions%ROWTYPE; c finance_complaints%ROWTYPE;
 host UUID; checkout_time TEXT; retained_gross NUMERIC;
BEGIN
 SELECT * INTO r FROM finance_complaint_resolutions WHERE complaint_id=NEW.complaint_id;
 SELECT * INTO c FROM finance_complaints WHERE id=NEW.complaint_id;
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 SELECT p.host_id INTO host FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=b.homestay_unit_id;
 IF r.decision IS NULL OR r.decision='HOST' OR r.created_txid<>txid_current() OR c.booking_id IS DISTINCT FROM b.id
  OR c.host_id IS DISTINCT FROM host OR b.payment_status IS DISTINCT FROM 'PAID'
  OR b.version IS DISTINCT FROM NEW.booking_version_before OR b.booking_status IS DISTINCT FROM NEW.booking_status_before
  OR NEW.base_amount>b.base_amount OR NEW.cleaning_fee>b.cleaning_fee OR NEW.service_fee>b.service_fee OR NEW.tax_amount>b.tax_amount
  OR (r.decision='FULL_REFUND' AND NEW.refund_amount<>b.total_amount)
  OR (r.decision='PARTIAL_REFUND' AND (NEW.refund_amount>=b.total_amount OR NEW.service_fee<>0)) THEN
  RAISE EXCEPTION 'Complaint refund requires current booking and capped individual allocation' USING ERRCODE='23514';
 END IF;
 checkout_time=b.policy_snapshot->>'checkOutTime';
 IF checkout_time IS NULL OR checkout_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
  OR NEW.checkout_at IS DISTINCT FROM ((b.check_out_date+checkout_time::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
  OR (r.decision='FULL_REFUND' AND NEW.hold_start IS NOT NULL)
  OR (r.decision='PARTIAL_REFUND' AND NEW.hold_start IS DISTINCT FROM greatest(NEW.checkout_at,r.created_at)) THEN
  RAISE EXCEPTION 'Complaint refund hold must snapshot max checkout and Admin resolution' USING ERRCODE='23514';
 END IF;
 retained_gross=b.base_amount-NEW.base_amount+b.cleaning_fee-NEW.cleaning_fee;
 IF NEW.commission_reversal IS DISTINCT FROM b.commission_amount-round(retained_gross*b.commission_rate/100)
  OR NEW.host_reduction IS DISTINCT FROM b.host_payout_amount-(retained_gross-round(retained_gross*b.commission_rate/100))
  OR EXISTS(SELECT 1 FROM finance_payout_items WHERE booking_id=b.id AND status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_no_show_resolutions WHERE booking_id=b.id)
  OR EXISTS(SELECT 1 FROM finance_journals WHERE booking_id=b.id AND kind<>'PAYMENT' AND id<>NEW.reversal_journal_id)
  OR (SELECT count(*) FROM finance_journals WHERE booking_id=b.id AND kind='PAYMENT')<>1
  OR NOT EXISTS(SELECT 1 FROM finance_journals WHERE id=NEW.source_journal_id AND booking_id=b.id AND host_id=host AND kind='PAYMENT') THEN
  RAISE EXCEPTION 'Complaint refund requires exact unallocated payment provenance' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=NEW.source_journal_id GROUP BY journal_id HAVING
  bool_and((side='DEBIT' AND account='CASH_CLEARING') OR (side='CREDIT' AND account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
  AND coalesce(sum(amount) FILTER(WHERE side='DEBIT' AND account='CASH_CLEARING'),0)=b.total_amount
  AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='HOST_PAYABLE'),0)=b.host_payout_amount
  AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_COMMISSION'),0)=b.commission_amount
  AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_SERVICE'),0)=b.service_fee
  AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='TAX_PAYABLE'),0)=b.tax_amount) THEN
  RAISE EXCEPTION 'Complaint refund requires exact payment amounts' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM finance_journals j WHERE j.id=NEW.reversal_journal_id AND j.kind='REFUND' AND j.booking_id=b.id
  AND j.host_id=host AND j.actor_id=r.actor_id AND j.reason=r.reason AND j.created_txid=txid_current()
  AND j.event_key='complaint-refund:'||NEW.complaint_id::text)
  OR NOT EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=NEW.reversal_journal_id GROUP BY journal_id HAVING
   bool_and((side='CREDIT' AND account='REFUND_PAYABLE') OR(side='DEBIT' AND account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
   AND coalesce(sum(amount) FILTER(WHERE account='REFUND_PAYABLE' AND side='CREDIT'),0)=NEW.refund_amount
   AND coalesce(sum(amount) FILTER(WHERE account='HOST_PAYABLE' AND side='DEBIT'),0)=NEW.host_reduction
   AND coalesce(sum(amount) FILTER(WHERE account='PLATFORM_COMMISSION' AND side='DEBIT'),0)=NEW.commission_reversal
   AND coalesce(sum(amount) FILTER(WHERE account='PLATFORM_SERVICE' AND side='DEBIT'),0)=NEW.service_fee
   AND coalesce(sum(amount) FILTER(WHERE account='TAX_PAYABLE' AND side='DEBIT'),0)=NEW.tax_amount) THEN
  RAISE EXCEPTION 'Complaint refund requires exact reversal journal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finance_complaint_refund_source BEFORE INSERT ON finance_complaint_refunds
 FOR EACH ROW EXECUTE FUNCTION finance_complaint_refund_source();

CREATE FUNCTION finance_complaint_refund_committed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r finance_complaint_resolutions%ROWTYPE; a finance_complaint_refunds%ROWTYPE; b bookings%ROWTYPE;
BEGIN
 SELECT * INTO r FROM finance_complaint_resolutions WHERE complaint_id=NEW.complaint_id;
 IF r.decision='HOST' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM finance_complaint_refunds WHERE complaint_id=r.complaint_id;
 SELECT * INTO b FROM bookings WHERE id=a.booking_id;
 IF a.complaint_id IS NULL OR a.created_txid<>r.created_txid
  OR NOT EXISTS(SELECT 1 FROM finance_refunds WHERE complaint_id=r.complaint_id AND amount=a.refund_amount AND status='PENDING' AND version=1)
  OR b.version IS DISTINCT FROM a.booking_version_before+1 OR b.payment_status IS DISTINCT FROM 'PAID'
  OR b.booking_status IS DISTINCT FROM (CASE WHEN r.decision='FULL_REFUND' AND r.created_at<a.checkout_at THEN 'CANCELLED' ELSE a.booking_status_before END) THEN
  RAISE EXCEPTION 'Complaint refund must commit obligation, booking and allocation atomically' USING ERRCODE='23514';
 END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_complaint_refund_committed AFTER INSERT ON finance_complaint_resolutions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_complaint_refund_committed();

CREATE OR REPLACE FUNCTION finance_refund_protect_obligation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.cancellation_id,NEW.complaint_id,NEW.amount,NEW.created_at) IS DISTINCT FROM ROW(OLD.cancellation_id,OLD.complaint_id,OLD.amount,OLD.created_at) THEN
  RAISE EXCEPTION 'Refund obligation amount and source are immutable' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION finance_refund_validate_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_amount NUMERIC;
BEGIN
 IF NEW.cancellation_id IS NOT NULL THEN
  SELECT refund_amount INTO source_amount FROM finance_cancellations WHERE id=NEW.cancellation_id FOR SHARE;
 ELSE SELECT refund_amount INTO source_amount FROM finance_complaint_refunds WHERE complaint_id=NEW.complaint_id FOR SHARE; END IF;
 IF source_amount IS DISTINCT FROM NEW.amount THEN
  RAISE EXCEPTION 'Refund obligation must match cancellation amount or complaint allocation' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;
CREATE FUNCTION finance_refund_booking(target UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
 SELECT coalesce(c.booking_id,a.booking_id) FROM finance_refunds r
 LEFT JOIN finance_cancellations c ON c.id=r.cancellation_id LEFT JOIN finance_complaint_refunds a ON a.complaint_id=r.complaint_id WHERE r.id=target
$$;
CREATE OR REPLACE FUNCTION finance_refund_validate_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; r finance_refunds%ROWTYPE; c finance_refund_confirmations%ROWTYPE; booking UUID; paid_out NUMERIC; payable NUMERIC;
BEGIN
 IF TG_TABLE_NAME='finance_refunds' THEN target=NEW.id; ELSE target=NEW.refund_id; END IF;
 SELECT * INTO r FROM finance_refunds WHERE id=target;
 SELECT * INTO c FROM finance_refund_confirmations WHERE refund_id=target;
 IF r.status='PAID' OR c.id IS NOT NULL THEN
  IF r.status<>'PAID' OR c.id IS NULL OR c.amount<>r.amount THEN
   RAISE EXCEPTION 'Paid refund must have a matching immutable confirmation' USING ERRCODE='23514';
  END IF;
  booking=finance_refund_booking(target);
  SELECT coalesce(sum(e.amount) FILTER(WHERE e.account='CASH_CLEARING' AND e.side='CREDIT'),0),
   coalesce(sum(e.amount) FILTER(WHERE e.account='REFUND_PAYABLE' AND e.side='DEBIT'),0)
   INTO paid_out,payable FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
   WHERE j.id=c.journal_id AND j.kind='REFUND' AND j.booking_id=booking AND j.actor_id=c.actor_id;
  IF paid_out<>r.amount OR payable<>r.amount THEN
   RAISE EXCEPTION 'Refund confirmation must match its cash-return journal' USING ERRCODE='23514';
  END IF;
 END IF;RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION finance_payout_hold_start(target UUID) RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
DECLARE b bookings%ROWTYPE; result TIMESTAMPTZ; checkout_time TEXT;
BEGIN
 SELECT * INTO b FROM bookings WHERE id=target; IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT a.hold_start INTO result FROM finance_complaint_refunds a JOIN finance_complaint_resolutions r ON r.complaint_id=a.complaint_id
  WHERE a.booking_id=b.id AND r.decision='PARTIAL_REFUND';
 IF FOUND THEN RETURN result; END IF;
 IF b.booking_status='COMPLETED' THEN RETURN b.completed_at; END IF;
 IF b.booking_status='CANCELLED_BY_GUEST' AND EXISTS(SELECT 1 FROM finance_cancellations c JOIN finance_journals j ON j.id=c.source_journal_id
  WHERE c.booking_id=b.id AND c.actor_type='GUEST' AND c.actor_id=b.guest_id AND c.refund_amount<b.total_amount AND j.booking_id=b.id AND j.kind='PAYMENT') THEN
  checkout_time=b.policy_snapshot->>'checkOutTime';
  IF checkout_time IS NULL OR checkout_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$' THEN RETURN NULL; END IF;
  RETURN (b.check_out_date+checkout_time::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
 END IF;
 SELECT created_at INTO result FROM finance_no_show_resolutions WHERE booking_id=b.id; RETURN result;
END; $$;

ALTER TABLE bookings DROP CONSTRAINT bookings_paid_state;
ALTER TABLE bookings ADD CONSTRAINT bookings_paid_state CHECK(booking_status NOT IN('CONFIRMED','CHECKED_IN','COMPLETED') OR payment_status='PAID'
 OR payment_status='REFUNDED');
CREATE FUNCTION finance_completed_refund_proof() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.booking_status IN('CONFIRMED','CHECKED_IN','COMPLETED') AND NEW.payment_status='REFUNDED' AND NOT EXISTS(
  SELECT 1 FROM finance_complaint_refunds a JOIN finance_complaint_resolutions s ON s.complaint_id=a.complaint_id
   JOIN finance_refunds r ON r.complaint_id=a.complaint_id JOIN finance_refund_confirmations c ON c.refund_id=r.id
  WHERE a.booking_id=NEW.id AND s.decision='FULL_REFUND' AND a.refund_amount=NEW.total_amount AND r.status='PAID' AND c.amount=r.amount
 ) THEN RAISE EXCEPTION 'Completed refunded stay requires confirmed full complaint refund' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_completed_refund_proof AFTER INSERT OR UPDATE ON bookings
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_completed_refund_proof();
COMMIT;
