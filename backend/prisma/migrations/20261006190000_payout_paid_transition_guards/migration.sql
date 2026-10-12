BEGIN;
-- Additive correction: predecessor deployed to isolated tests; never rewrite it.
CREATE OR REPLACE FUNCTION finance_payout_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bank finance_bank_accounts%ROWTYPE; bank_state finance_bank_states%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.status='PAID' THEN
  IF OLD.status<>'APPROVED' OR NEW.version<>OLD.version+1
   OR (to_jsonb(NEW)-'status'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'version')
   OR NOT EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=OLD.id AND e.action='PAID' AND e.version_before=OLD.version AND e.created_txid=txid_current())
   OR NOT EXISTS(SELECT 1 FROM finance_payout_confirmations c WHERE c.batch_id=OLD.id AND c.version_before=OLD.version AND c.created_txid=txid_current()) THEN
   RAISE EXCEPTION 'Paid payout requires immutable snapshot and same transaction proof' USING ERRCODE='23514';
  END IF; RETURN NEW;
 END IF;
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
 IF NEW.action='PAID' THEN
  SELECT * INTO batch FROM finance_payout_batches WHERE id=NEW.batch_id FOR UPDATE;
  IF batch.status IS DISTINCT FROM 'APPROVED' OR NEW.version_before<>batch.version
   OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE)
   OR NOT EXISTS(SELECT 1 FROM finance_payout_confirmations c WHERE c.batch_id=batch.id AND c.actor_id=NEW.actor_id AND c.version_before=batch.version AND c.reason=NEW.reason AND c.created_txid=txid_current()) THEN
   RAISE EXCEPTION 'Paid payout audit requires current approved evidence' USING ERRCODE='23514';
  END IF; NEW.created_at=clock_timestamp();NEW.created_txid=txid_current();RETURN NEW;
 END IF;
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

COMMIT;

