BEGIN;
CREATE OR REPLACE FUNCTION finance_payout_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; batch finance_payout_batches%ROWTYPE; total NUMERIC; earliest TIMESTAMPTZ; n BIGINT;
BEGIN
 IF TG_TABLE_NAME='finance_payout_batches' THEN target=NEW.id; ELSE target=NEW.batch_id; END IF;
 SELECT * INTO batch FROM finance_payout_batches WHERE id=target;
 IF batch.status='PAID' THEN
  IF NOT finance_payout_paid_proof(target) THEN RAISE EXCEPTION 'Paid payout requires complete immutable ledger proof' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
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
   OR EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.host_id=batch.host_id AND e.account='HOST_DEBT' AND NOT finance_debt_journal_verified(j.id))
   OR EXISTS(SELECT 1 FROM finance_host_debts d WHERE d.host_id=batch.host_id AND finance_debt_remaining(d.refund_id)>0)
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
