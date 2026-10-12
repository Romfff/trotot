BEGIN;
-- Owner approval: retained Guest-cancellation proceeds wait 72h from scheduled
-- checkout in the immutable booking policy, not cancellation or mutable unit time.
CREATE FUNCTION finance_payout_hold_start(target UUID) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE AS $$
DECLARE b bookings%ROWTYPE; result TIMESTAMPTZ; checkout_time TEXT;
BEGIN
 SELECT * INTO b FROM bookings WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF b.booking_status='COMPLETED' THEN RETURN b.completed_at; END IF;
 IF b.booking_status='CANCELLED_BY_GUEST' AND EXISTS(
  SELECT 1 FROM finance_cancellations c JOIN finance_journals j ON j.id=c.source_journal_id
  WHERE c.booking_id=b.id AND c.actor_type='GUEST' AND c.actor_id=b.guest_id
   AND c.refund_amount<b.total_amount AND j.booking_id=b.id AND j.kind='PAYMENT'
 ) THEN
  checkout_time=b.policy_snapshot->>'checkOutTime';
  IF checkout_time IS NULL OR checkout_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$' THEN RETURN NULL; END IF;
  RETURN (b.check_out_date+checkout_time::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
 END IF;
 SELECT created_at INTO result FROM finance_no_show_resolutions WHERE booking_id=b.id;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION finance_payout_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch finance_payout_batches%ROWTYPE; b bookings%ROWTYPE; host UUID; hold_start TIMESTAMPTZ; source_count BIGINT;
 source_host UUID; net NUMERIC; cash NUMERIC; payable NUMERIC; commission NUMERIC; service NUMERIC; tax NUMERIC; valid_accounts BOOLEAN;
BEGIN
 SELECT * INTO batch FROM finance_payout_batches WHERE id=NEW.batch_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.batch_id,NEW.booking_id,NEW.source_journal_id,NEW.amount,NEW.eligible_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.batch_id,OLD.booking_id,OLD.source_journal_id,OLD.amount,OLD.eligible_at)
   OR OLD.status<>'ACTIVE' OR NEW.status<>'RELEASED' OR batch.status<>'CANCELLED' THEN
   RAISE EXCEPTION 'Payout item snapshot is immutable; only cancelled batch releases it' USING ERRCODE='23514';
  END IF;RETURN NEW;
 END IF;
 IF batch.status IS DISTINCT FROM 'DRAFT' OR batch.created_txid<>txid_current() OR NEW.status<>'ACTIVE' THEN
  RAISE EXCEPTION 'Payout items must be created with their draft' USING ERRCODE='23514';
 END IF;
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 SELECT p.host_id INTO host FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=b.homestay_unit_id;
 IF host IS DISTINCT FROM batch.host_id OR b.payment_status NOT IN('PAID','REFUNDED') THEN
  RAISE EXCEPTION 'Payout item ownership or payment state mismatch' USING ERRCODE='23514';
 END IF;
 hold_start=finance_payout_hold_start(b.id);
 IF hold_start IS NULL OR NEW.eligible_at IS DISTINCT FROM hold_start+interval '72 hours' OR NEW.eligible_at>batch.cutoff
  OR EXISTS(SELECT 1 FROM finance_complaints WHERE booking_id=b.id AND status='OPEN') THEN
  RAISE EXCEPTION 'Payout item is held or disputed' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO source_count FROM finance_journals WHERE booking_id=b.id AND kind='PAYMENT';
 SELECT host_id INTO source_host FROM finance_journals WHERE id=NEW.source_journal_id AND booking_id=b.id AND kind='PAYMENT';
 SELECT coalesce(sum(amount) FILTER(WHERE side='DEBIT' AND account='CASH_CLEARING'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='HOST_PAYABLE'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_COMMISSION'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_SERVICE'),0),
  coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='TAX_PAYABLE'),0),
  bool_and((side='DEBIT' AND account='CASH_CLEARING') OR(side='CREDIT' AND account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
 INTO cash,payable,commission,service,tax,valid_accounts FROM finance_entries WHERE journal_id=NEW.source_journal_id;
 IF source_count<>1 OR source_host IS DISTINCT FROM host OR valid_accounts IS DISTINCT FROM true
  OR ROW(cash,payable,commission,service,tax) IS DISTINCT FROM ROW(b.total_amount,b.host_payout_amount,b.commission_amount,b.service_fee,b.tax_amount) THEN
  RAISE EXCEPTION 'Payout item needs exact payment source' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM finance_journals j WHERE j.booking_id=b.id AND (j.host_id<>host OR NOT(
  j.kind='PAYMENT' OR (j.kind='REFUND' AND (EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.booking_id=b.id AND c.reversal_journal_id=j.id)
  OR EXISTS(SELECT 1 FROM finance_refund_confirmations f JOIN finance_refunds r ON r.id=f.refund_id JOIN finance_cancellations c ON c.id=r.cancellation_id WHERE f.journal_id=j.id AND c.booking_id=b.id)))))) THEN
  RAISE EXCEPTION 'Payout item has unsupported ledger provenance' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0) INTO net
  FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.booking_id=b.id AND e.account='HOST_PAYABLE';
 IF NEW.amount IS DISTINCT FROM net OR net<=0 OR net>b.host_payout_amount THEN
  RAISE EXCEPTION 'Payout item amount differs from remaining ledger balance' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;

COMMIT;

