BEGIN;
ALTER TABLE finance_payout_batches DROP CONSTRAINT finance_payout_batches_status_check;
ALTER TABLE finance_payout_batches ADD CONSTRAINT finance_payout_batches_status_check CHECK(status IN('DRAFT','APPROVED','CANCELLED'));
ALTER TABLE finance_payout_events DROP CONSTRAINT finance_payout_events_action_check;
ALTER TABLE finance_payout_events ADD CONSTRAINT finance_payout_events_action_check CHECK(action IN('CREATED','APPROVED','CANCELLED'));

ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK(operation IN(
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID','HOST_BANK_SUBMIT','ADMIN_BANK_VERIFY','ADMIN_BANK_REJECT',
 'COMPLAINT_CREATE','HOST_COMPLAINT_RESPOND','ADMIN_COMPLAINT_ASSIGN','HOST_NO_SHOW_REPORT','ADMIN_NO_SHOW_RESOLVE','ADMIN_COMPLAINT_RESOLVE',
 'ADMIN_PAYOUT_DRAFT','ADMIN_PAYOUT_CANCEL','ADMIN_PAYOUT_APPROVE'));



CREATE FUNCTION finance_payout_ready(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM finance_payout_batches b
  JOIN finance_bank_states s ON s.host_id=b.host_id
  JOIN finance_bank_accounts a ON a.id=s.account_id
  WHERE b.id=target AND b.status IN('DRAFT','APPROVED')
   AND a.status='VERIFIED' AND s.account_id=b.bank_account_id AND s.version=b.bank_version
   AND ROW(a.host_id,a.bank_code,a.account_number,a.account_name)=ROW(b.host_id,b.bank_code,b.account_number,b.account_name)
   AND EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE')
   AND b.amount=(SELECT sum(i.amount) FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE')
   AND (b.amount>=200000 OR b.cutoff>=(SELECT min(i.eligible_at)+interval '60 days' FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE'))
   AND NOT EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
     WHERE j.host_id=b.host_id AND (e.account='HOST_DEBT' OR j.kind IN('ADJUSTMENT','PAYOUT')))
   AND NOT EXISTS(
    SELECT 1 FROM finance_payout_items i JOIN bookings k ON k.id=i.booking_id
    JOIN homestay_units u ON u.id=k.homestay_unit_id JOIN properties p ON p.id=u.property_id
    JOIN finance_journals j ON j.id=i.source_journal_id
    WHERE i.batch_id=b.id AND (
     i.status<>'ACTIVE' OR p.host_id<>b.host_id OR k.payment_status NOT IN('PAID','REFUNDED')
     OR j.booking_id IS DISTINCT FROM k.id OR j.host_id<>b.host_id OR j.kind<>'PAYMENT'
     OR (SELECT count(*) FROM finance_journals x WHERE x.booking_id=k.id AND x.kind='PAYMENT')<>1
     OR finance_payout_hold_start(k.id) IS NULL
     OR i.eligible_at IS DISTINCT FROM finance_payout_hold_start(k.id)+interval '72 hours' OR i.eligible_at>b.cutoff
     OR EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=k.id AND c.status='OPEN')
     OR i.amount IS DISTINCT FROM (SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0)
       FROM finance_entries e JOIN finance_journals x ON x.id=e.journal_id WHERE x.booking_id=k.id AND e.account='HOST_PAYABLE')
     OR EXISTS(SELECT 1 FROM finance_journals x WHERE x.booking_id=k.id AND (x.host_id<>b.host_id OR NOT(
      x.kind='PAYMENT' OR (x.kind='REFUND' AND (
       EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.booking_id=k.id AND c.reversal_journal_id=x.id)
       OR EXISTS(SELECT 1 FROM finance_refund_confirmations f JOIN finance_refunds r ON r.id=f.refund_id JOIN finance_cancellations c ON c.id=r.cancellation_id WHERE f.journal_id=x.id AND c.booking_id=k.id)
      ))
     )))
    )
   )
 )
$$;

CREATE OR REPLACE FUNCTION finance_payout_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bank finance_bank_accounts%ROWTYPE; bank_state finance_bank_states%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('bank:'||NEW.host_id::text,0));
  SELECT * INTO bank_state FROM finance_bank_states WHERE host_id=NEW.host_id FOR UPDATE;
  SELECT * INTO bank FROM finance_bank_accounts WHERE id=NEW.bank_account_id FOR SHARE;
  IF bank_state.account_id IS DISTINCT FROM NEW.bank_account_id OR bank_state.version IS DISTINCT FROM NEW.bank_version
   OR bank.status IS DISTINCT FROM 'VERIFIED' OR bank.host_id IS DISTINCT FROM NEW.host_id
   OR ROW(bank.bank_code,bank.account_number,bank.account_name) IS DISTINCT FROM ROW(NEW.bank_code,NEW.account_number,NEW.account_name) THEN
   RAISE EXCEPTION 'Payout requires current verified bank snapshot' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.cutoff>clock_timestamp()
   OR extract(isodow FROM NEW.cutoff AT TIME ZONE 'Asia/Ho_Chi_Minh')<>1
   OR (NEW.cutoff AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<>time '09:00:00' THEN
   RAISE EXCEPTION 'Payout requires a past weekly cutoff and initial draft state' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.host_id=NEW.host_id AND e.account='HOST_DEBT') THEN
   RAISE EXCEPTION 'Payout debt settlement requires financial review' USING ERRCODE='23514';
  END IF;
  NEW.created_at=clock_timestamp();NEW.created_txid=txid_current();
 ELSE
  IF ROW(NEW.id,NEW.host_id,NEW.bank_account_id,NEW.bank_version,NEW.bank_code,NEW.account_number,NEW.account_name,NEW.cutoff,NEW.amount,NEW.created_at,NEW.created_txid)
   IS DISTINCT FROM ROW(OLD.id,OLD.host_id,OLD.bank_account_id,OLD.bank_version,OLD.bank_code,OLD.account_number,OLD.account_name,OLD.cutoff,OLD.amount,OLD.created_at,OLD.created_txid)
   OR NOT ((OLD.status='DRAFT' AND NEW.status='APPROVED') OR (OLD.status IN('DRAFT','APPROVED') AND NEW.status='CANCELLED')) OR NEW.version<>OLD.version+1
   OR NOT EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=OLD.id AND e.action=NEW.status
    AND e.version_before=OLD.version AND e.created_txid=txid_current()) THEN
   RAISE EXCEPTION 'Payout snapshot is immutable; cancellation requires same transaction audit' USING ERRCODE='23514';
  END IF;
 END IF;RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION finance_payout_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch finance_payout_batches%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE) THEN
  RAISE EXCEPTION 'Payout audit requires active Admin' USING ERRCODE='23514';
 END IF;
 SELECT * INTO batch FROM finance_payout_batches WHERE id=NEW.batch_id FOR UPDATE;
 IF (NEW.action='CREATED' AND (batch.status IS DISTINCT FROM 'DRAFT' OR NEW.version_before<>0 OR batch.created_txid<>txid_current()))
  OR (NEW.action='APPROVED' AND (batch.status IS DISTINCT FROM 'DRAFT' OR NEW.version_before<>batch.version))
  OR (NEW.action='CANCELLED' AND (batch.status NOT IN('DRAFT','APPROVED') OR NEW.version_before<>batch.version)) THEN
  RAISE EXCEPTION 'Payout audit requires current draft version' USING ERRCODE='23514';
 END IF;
 NEW.created_at=clock_timestamp();NEW.created_txid=txid_current();RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION finance_payout_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; batch finance_payout_batches%ROWTYPE; total NUMERIC; earliest TIMESTAMPTZ; n BIGINT;
BEGIN
 IF TG_TABLE_NAME='finance_payout_batches' THEN target=NEW.id; ELSE target=NEW.batch_id; END IF;
 SELECT * INTO batch FROM finance_payout_batches WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM finance_payout_events WHERE batch_id=target AND action='CREATED') THEN
  RAISE EXCEPTION 'Payout requires immutable creation audit' USING ERRCODE='23514';
 END IF;
 IF batch.status IN('DRAFT','APPROVED') THEN
  IF batch.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=target AND e.action='APPROVED' AND e.version_before=batch.version-1) THEN
   RAISE EXCEPTION 'Approved payout requires immutable approval audit' USING ERRCODE='23514';
  END IF;
  IF NOT finance_payout_ready(target) THEN
   RAISE EXCEPTION 'Payout requires current verified financial gates' USING ERRCODE='23514';
  END IF;
  SELECT count(*),sum(amount),min(eligible_at) INTO n,total,earliest FROM finance_payout_items WHERE batch_id=target AND status='ACTIVE';
  IF n=0 OR total IS DISTINCT FROM batch.amount OR NOT EXISTS(SELECT 1 FROM finance_payout_events WHERE batch_id=target AND action='CREATED')
   OR (total<200000 AND batch.cutoff<earliest+interval '60 days') THEN
   RAISE EXCEPTION 'Draft payout requires matching items, threshold and creation audit' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM finance_payout_events WHERE batch_id=target AND action='CANCELLED')
   OR NOT EXISTS(SELECT 1 FROM finance_bank_states s JOIN finance_bank_accounts a ON a.id=s.account_id
    WHERE s.host_id=batch.host_id AND s.account_id=batch.bank_account_id AND s.version=batch.bank_version AND a.status='VERIFIED')
   OR EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.host_id=batch.host_id AND e.account='HOST_DEBT')
   OR EXISTS(SELECT 1 FROM finance_payout_items i JOIN finance_complaints c ON c.booking_id=i.booking_id WHERE i.batch_id=target AND c.status='OPEN')
   OR EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.batch_id=target AND i.amount IS DISTINCT FROM (
    SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0) FROM finance_entries e
    JOIN finance_journals j ON j.id=e.journal_id WHERE j.booking_id=i.booking_id AND e.account='HOST_PAYABLE')) THEN
   RAISE EXCEPTION 'Draft payout gates changed before commit' USING ERRCODE='23514';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM finance_payout_items WHERE batch_id=target AND status='ACTIVE')
   OR NOT EXISTS(SELECT 1 FROM finance_payout_events WHERE batch_id=target AND action='CANCELLED' AND version_before=batch.version-1) THEN
   RAISE EXCEPTION 'Cancelled payout must release every item in its transaction' USING ERRCODE='23514';
  END IF;
 END IF;RETURN NULL;
END; $$;

COMMIT;

