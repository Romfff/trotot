BEGIN;
CREATE OR REPLACE FUNCTION finance_complaint_refund_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings%ROWTYPE; r finance_complaint_resolutions%ROWTYPE; c finance_complaints%ROWTYPE;
 host UUID; checkout_time TEXT; before_gross NUMERIC; retained_gross NUMERIC;
 debit_account TEXT; prior_base NUMERIC; prior_cleaning NUMERIC; prior_service NUMERIC; prior_tax NUMERIC;
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
  OR (r.decision='FULL_REFUND' AND NEW.refund_amount+prior_base+prior_cleaning+prior_service+prior_tax<>b.total_amount)
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
 debit_account=CASE WHEN EXISTS(SELECT 1 FROM finance_payout_items i JOIN finance_payout_batches batch ON batch.id=i.batch_id
  JOIN finance_payout_paid_items x ON x.item_id=i.id WHERE i.booking_id=b.id AND i.status='ACTIVE' AND batch.status='PAID'
  AND finance_payout_journal_verified(x.journal_id)) THEN 'HOST_DEBT' ELSE 'HOST_PAYABLE' END;
 before_gross=b.base_amount-prior_base+b.cleaning_fee-prior_cleaning;
 retained_gross=before_gross-NEW.base_amount-NEW.cleaning_fee;
 IF NEW.commission_reversal IS DISTINCT FROM round(before_gross*b.commission_rate/100)-round(retained_gross*b.commission_rate/100)
  OR NEW.host_reduction IS DISTINCT FROM (before_gross-round(before_gross*b.commission_rate/100))-(retained_gross-round(retained_gross*b.commission_rate/100))
  OR EXISTS(SELECT 1 FROM finance_payout_items i JOIN finance_payout_batches batch ON batch.id=i.batch_id WHERE i.booking_id=b.id AND i.status='ACTIVE' AND batch.status<>'PAID')
  OR EXISTS(SELECT 1 FROM finance_no_show_resolutions WHERE booking_id=b.id)
  OR EXISTS(SELECT 1 FROM finance_cancellations WHERE booking_id=b.id)
  OR EXISTS(SELECT 1 FROM finance_journals j WHERE j.booking_id=b.id AND j.kind<>'PAYMENT' AND j.id<>NEW.reversal_journal_id
   AND NOT finance_complaint_journal_verified(j.id) AND NOT finance_payout_journal_verified(j.id))
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
   bool_and((side='CREDIT' AND account='REFUND_PAYABLE') OR(side='DEBIT' AND account IN(debit_account,'PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
   AND coalesce(sum(amount) FILTER(WHERE account='REFUND_PAYABLE' AND side='CREDIT'),0)=NEW.refund_amount
   AND coalesce(sum(amount) FILTER(WHERE account=debit_account AND side='DEBIT'),0)=NEW.host_reduction
   AND coalesce(sum(amount) FILTER(WHERE account='PLATFORM_COMMISSION' AND side='DEBIT'),0)=NEW.commission_reversal
   AND coalesce(sum(amount) FILTER(WHERE account='PLATFORM_SERVICE' AND side='DEBIT'),0)=NEW.service_fee
   AND coalesce(sum(amount) FILTER(WHERE account='TAX_PAYABLE' AND side='DEBIT'),0)=NEW.tax_amount) THEN
  RAISE EXCEPTION 'Complaint refund requires exact reversal journal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

COMMIT;

