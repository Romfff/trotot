-- S4-REFUND-CUMULATIVE: additive, each new complaint has its own immutable allocation.
BEGIN;
ALTER TABLE finance_complaint_refunds DROP CONSTRAINT finance_complaint_refunds_booking_id_key;
CREATE UNIQUE INDEX finance_complaint_refund_booking_version ON finance_complaint_refunds(booking_id,booking_version_before);
CREATE OR REPLACE FUNCTION finance_complaint_refund_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings%ROWTYPE; r finance_complaint_resolutions%ROWTYPE; c finance_complaints%ROWTYPE;
 host UUID; checkout_time TEXT; before_gross NUMERIC; retained_gross NUMERIC;
 prior_base NUMERIC; prior_cleaning NUMERIC; prior_service NUMERIC; prior_tax NUMERIC;
BEGIN
 SELECT * INTO r FROM finance_complaint_resolutions WHERE complaint_id=NEW.complaint_id;
 SELECT * INTO c FROM finance_complaints WHERE id=NEW.complaint_id;
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 SELECT p.host_id INTO host FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=b.homestay_unit_id;
 SELECT coalesce(sum(base_amount),0),coalesce(sum(cleaning_fee),0),coalesce(sum(service_fee),0),coalesce(sum(tax_amount),0)
  INTO prior_base,prior_cleaning,prior_service,prior_tax FROM finance_complaint_refunds WHERE booking_id=b.id;
 IF r.decision IS NULL OR r.decision='HOST' OR r.created_txid<>txid_current() OR c.booking_id IS DISTINCT FROM b.id
  OR c.host_id IS DISTINCT FROM host OR b.payment_status IS DISTINCT FROM 'PAID'
  OR b.version IS DISTINCT FROM NEW.booking_version_before OR b.booking_status IS DISTINCT FROM NEW.booking_status_before
  OR NEW.base_amount+prior_base>b.base_amount OR NEW.cleaning_fee+prior_cleaning>b.cleaning_fee
  OR NEW.service_fee+prior_service>b.service_fee OR NEW.tax_amount+prior_tax>b.tax_amount
  OR (r.decision='FULL_REFUND' AND (prior_base+prior_cleaning+prior_service+prior_tax<>0 OR NEW.refund_amount<>b.total_amount))
  OR (r.decision='PARTIAL_REFUND' AND (NEW.refund_amount+prior_base+prior_cleaning+prior_service+prior_tax>=b.total_amount OR NEW.service_fee<>0)) THEN
  RAISE EXCEPTION 'Complaint refund requires current booking and capped cumulative allocation' USING ERRCODE='23514';
 END IF;
 checkout_time=b.policy_snapshot->>'checkOutTime';
 IF checkout_time IS NULL OR checkout_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
  OR NEW.checkout_at IS DISTINCT FROM ((b.check_out_date+checkout_time::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
  OR (r.decision='FULL_REFUND' AND NEW.hold_start IS NOT NULL)
  OR (r.decision='PARTIAL_REFUND' AND NEW.hold_start IS DISTINCT FROM greatest(NEW.checkout_at,r.created_at)) THEN
  RAISE EXCEPTION 'Complaint refund hold must snapshot max checkout and Admin resolution' USING ERRCODE='23514';
 END IF;
 before_gross=b.base_amount-prior_base+b.cleaning_fee-prior_cleaning;
 retained_gross=before_gross-NEW.base_amount-NEW.cleaning_fee;
 IF NEW.commission_reversal IS DISTINCT FROM round(before_gross*b.commission_rate/100)-round(retained_gross*b.commission_rate/100)
  OR NEW.host_reduction IS DISTINCT FROM (before_gross-round(before_gross*b.commission_rate/100))-(retained_gross-round(retained_gross*b.commission_rate/100))
  OR EXISTS(SELECT 1 FROM finance_payout_items WHERE booking_id=b.id AND status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_no_show_resolutions WHERE booking_id=b.id)
  OR EXISTS(SELECT 1 FROM finance_cancellations WHERE booking_id=b.id)
  OR EXISTS(SELECT 1 FROM finance_journals j WHERE j.booking_id=b.id AND j.kind<>'PAYMENT' AND j.id<>NEW.reversal_journal_id
   AND NOT finance_complaint_journal_verified(j.id))
  OR (SELECT count(*) FROM finance_journals WHERE booking_id=b.id AND kind='PAYMENT')<>1
  OR NOT EXISTS(SELECT 1 FROM finance_journals WHERE id=NEW.source_journal_id AND booking_id=b.id AND host_id=host AND kind='PAYMENT') THEN
  RAISE EXCEPTION 'Complaint refund requires exact supported payment provenance' USING ERRCODE='23514';
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
CREATE OR REPLACE FUNCTION finance_payout_hold_start(target UUID) RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
DECLARE b bookings%ROWTYPE; result TIMESTAMPTZ; checkout_time TEXT;
BEGIN
 SELECT * INTO b FROM bookings WHERE id=target; IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT max(a.hold_start) INTO result FROM finance_complaint_refunds a JOIN finance_complaint_resolutions r ON r.complaint_id=a.complaint_id
  WHERE a.booking_id=b.id AND r.decision='PARTIAL_REFUND';
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF b.booking_status='COMPLETED' THEN RETURN b.completed_at; END IF;
 IF b.booking_status='CANCELLED_BY_GUEST' AND EXISTS(SELECT 1 FROM finance_cancellations c JOIN finance_journals j ON j.id=c.source_journal_id
  WHERE c.booking_id=b.id AND c.actor_type='GUEST' AND c.actor_id=b.guest_id AND c.refund_amount<b.total_amount AND j.booking_id=b.id AND j.kind='PAYMENT') THEN
  checkout_time=b.policy_snapshot->>'checkOutTime';
  IF checkout_time IS NULL OR checkout_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$' THEN RETURN NULL; END IF;
  RETURN (b.check_out_date+checkout_time::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
 END IF;
 SELECT created_at INTO result FROM finance_no_show_resolutions WHERE booking_id=b.id; RETURN result;
END; $$;
COMMIT;
