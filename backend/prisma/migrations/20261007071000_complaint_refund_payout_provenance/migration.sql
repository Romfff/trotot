BEGIN;
-- Only immutable complaint allocation/cash-return proofs, not a generic REFUND kind.
CREATE FUNCTION finance_complaint_journal_verified(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM finance_complaint_refunds a JOIN finance_complaint_resolutions s ON s.complaint_id=a.complaint_id
   JOIN finance_complaints c ON c.id=a.complaint_id JOIN finance_journals j ON j.id=target
  WHERE c.status='RESOLVED' AND c.version=s.version_before+1 AND j.booking_id=a.booking_id AND j.host_id=c.host_id AND j.kind='REFUND'
   AND (j.id=a.reversal_journal_id OR EXISTS(SELECT 1 FROM finance_refunds r JOIN finance_refund_confirmations f ON f.refund_id=r.id
    WHERE r.complaint_id=a.complaint_id AND r.status='PAID' AND f.journal_id=j.id AND f.actor_id=j.actor_id AND f.amount=r.amount))
 )
$$;
CREATE FUNCTION finance_refund_journal_supported(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM finance_journals j WHERE j.id=target AND j.kind='REFUND' AND (
  EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.booking_id=j.booking_id AND c.reversal_journal_id=j.id)
  OR EXISTS(SELECT 1 FROM finance_refund_confirmations f JOIN finance_refunds r ON r.id=f.refund_id
   JOIN finance_cancellations c ON c.id=r.cancellation_id WHERE f.journal_id=j.id AND c.booking_id=j.booking_id)
  OR finance_complaint_journal_verified(j.id)))
$$;
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
  j.kind='PAYMENT' OR finance_refund_journal_supported(j.id)))) THEN
  RAISE EXCEPTION 'Payout item has unsupported ledger provenance' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0) INTO net
  FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.booking_id=b.id AND e.account='HOST_PAYABLE';
 IF NEW.amount IS DISTINCT FROM net OR net<=0 OR net>b.host_payout_amount THEN
  RAISE EXCEPTION 'Payout item amount differs from remaining ledger balance' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION finance_payout_ready(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM finance_payout_batches b JOIN finance_bank_states s ON s.host_id=b.host_id JOIN finance_bank_accounts a ON a.id=s.account_id
  WHERE b.id=target AND b.status IN('DRAFT','APPROVED') AND a.status='VERIFIED' AND s.account_id=b.bank_account_id AND s.version=b.bank_version
   AND ROW(a.host_id,a.bank_code,a.account_number,a.account_name)=ROW(b.host_id,b.bank_code,b.account_number,b.account_name)
   AND EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE')
   AND b.amount=(SELECT sum(i.amount) FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE')
   AND (b.amount>=200000 OR b.cutoff>=(SELECT min(i.eligible_at)+interval '60 days' FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE'))
   AND NOT EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.host_id=b.host_id
    AND (e.account='HOST_DEBT' OR j.kind='ADJUSTMENT' OR (j.kind='PAYOUT' AND NOT finance_payout_journal_verified(j.id))))
   AND NOT EXISTS(
    SELECT 1 FROM finance_payout_items i JOIN bookings k ON k.id=i.booking_id
     JOIN homestay_units u ON u.id=k.homestay_unit_id JOIN properties p ON p.id=u.property_id JOIN finance_journals j ON j.id=i.source_journal_id
    WHERE i.batch_id=b.id AND (
     i.status<>'ACTIVE' OR p.host_id<>b.host_id OR k.payment_status NOT IN('PAID','REFUNDED')
     OR j.booking_id IS DISTINCT FROM k.id OR j.host_id<>b.host_id OR j.kind<>'PAYMENT'
     OR (SELECT count(*) FROM finance_journals x WHERE x.booking_id=k.id AND x.kind='PAYMENT')<>1
     OR finance_payout_hold_start(k.id) IS NULL OR i.eligible_at IS DISTINCT FROM finance_payout_hold_start(k.id)+interval '72 hours' OR i.eligible_at>b.cutoff
     OR EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=k.id AND c.status='OPEN')
     OR i.amount IS DISTINCT FROM (SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0)
      FROM finance_entries e JOIN finance_journals x ON x.id=e.journal_id WHERE x.booking_id=k.id AND e.account='HOST_PAYABLE')
     OR EXISTS(SELECT 1 FROM finance_journals x WHERE x.booking_id=k.id AND (x.host_id<>b.host_id OR NOT(x.kind='PAYMENT' OR finance_refund_journal_supported(x.id))))
    )
   )
 )
$$;
COMMIT;
