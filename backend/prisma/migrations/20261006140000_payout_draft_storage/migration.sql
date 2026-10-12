BEGIN;
CREATE TABLE finance_payout_batches (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 bank_account_id UUID NOT NULL REFERENCES finance_bank_accounts(id) ON DELETE RESTRICT,
 bank_version INT NOT NULL CHECK(bank_version>=1),
 bank_code VARCHAR(20) NOT NULL,account_number VARCHAR(50) NOT NULL,account_name VARCHAR(150) NOT NULL,
 cutoff TIMESTAMPTZ NOT NULL,
 amount NUMERIC NOT NULL CHECK(amount>0 AND amount=trunc(amount) AND amount<'1000000000000000000'::numeric),
 status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','CANCELLED')),
 version INT NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),created_txid BIGINT NOT NULL DEFAULT txid_current(),
 FOREIGN KEY(host_id,bank_account_id) REFERENCES finance_bank_accounts(host_id,id) ON DELETE RESTRICT
);
CREATE TABLE finance_payout_items (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 batch_id UUID NOT NULL REFERENCES finance_payout_batches(id) ON DELETE RESTRICT,
 booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 source_journal_id UUID NOT NULL REFERENCES finance_journals(id) ON DELETE RESTRICT,
 amount NUMERIC NOT NULL CHECK(amount>0 AND amount=trunc(amount) AND amount<'1000000000000000000'::numeric),
 eligible_at TIMESTAMPTZ NOT NULL,
 status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','RELEASED')),
 UNIQUE(batch_id,booking_id)
);
CREATE UNIQUE INDEX finance_payout_items_active_booking ON finance_payout_items(booking_id) WHERE status='ACTIVE';
CREATE INDEX finance_payout_batches_host_created ON finance_payout_batches(host_id,created_at,id);
CREATE TABLE finance_payout_events (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 batch_id UUID NOT NULL REFERENCES finance_payout_batches(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action VARCHAR(10) NOT NULL CHECK(action IN('CREATED','CANCELLED')),
 version_before INT NOT NULL CHECK(version_before>=0),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),created_txid BIGINT NOT NULL DEFAULT txid_current(),
 UNIQUE(batch_id,action)
);
CREATE FUNCTION finance_payout_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
   OR OLD.status<>'DRAFT' OR NEW.status<>'CANCELLED' OR NEW.version<>OLD.version+1
   OR NOT EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=OLD.id AND e.action='CANCELLED'
    AND e.version_before=OLD.version AND e.created_txid=txid_current()) THEN
   RAISE EXCEPTION 'Payout snapshot is immutable; cancellation requires same transaction audit' USING ERRCODE='23514';
  END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER finance_payout_batch_guard BEFORE INSERT OR UPDATE ON finance_payout_batches FOR EACH ROW EXECUTE FUNCTION finance_payout_batch_guard();
CREATE FUNCTION finance_payout_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch finance_payout_batches%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE) THEN
  RAISE EXCEPTION 'Payout audit requires active Admin' USING ERRCODE='23514';
 END IF;
 SELECT * INTO batch FROM finance_payout_batches WHERE id=NEW.batch_id FOR UPDATE;
 IF batch.status IS DISTINCT FROM 'DRAFT' OR (NEW.action='CREATED' AND (NEW.version_before<>0 OR batch.created_txid<>txid_current()))
  OR (NEW.action='CANCELLED' AND NEW.version_before<>batch.version) THEN
  RAISE EXCEPTION 'Payout audit requires current draft version' USING ERRCODE='23514';
 END IF;
 NEW.created_at=clock_timestamp();NEW.created_txid=txid_current();RETURN NEW;
END; $$;
CREATE TRIGGER finance_payout_event_guard BEFORE INSERT ON finance_payout_events FOR EACH ROW EXECUTE FUNCTION finance_payout_event_guard();
CREATE FUNCTION finance_payout_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF b.booking_status='COMPLETED' THEN hold_start=b.completed_at;
 ELSE SELECT created_at INTO hold_start FROM finance_no_show_resolutions WHERE booking_id=b.id; END IF;
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
CREATE TRIGGER finance_payout_item_guard BEFORE INSERT OR UPDATE ON finance_payout_items FOR EACH ROW EXECUTE FUNCTION finance_payout_item_guard();
CREATE FUNCTION finance_payout_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; batch finance_payout_batches%ROWTYPE; total NUMERIC; earliest TIMESTAMPTZ; n BIGINT;
BEGIN
 IF TG_TABLE_NAME='finance_payout_batches' THEN target=NEW.id; ELSE target=NEW.batch_id; END IF;
 SELECT * INTO batch FROM finance_payout_batches WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM finance_payout_events WHERE batch_id=target AND action='CREATED') THEN
  RAISE EXCEPTION 'Payout requires immutable creation audit' USING ERRCODE='23514';
 END IF;
 IF batch.status='DRAFT' THEN
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
CREATE CONSTRAINT TRIGGER finance_payout_batches_commit AFTER INSERT OR UPDATE ON finance_payout_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_payout_commit_guard();
CREATE CONSTRAINT TRIGGER finance_payout_items_commit AFTER INSERT OR UPDATE ON finance_payout_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_payout_commit_guard();
CREATE CONSTRAINT TRIGGER finance_payout_events_commit AFTER INSERT ON finance_payout_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_payout_commit_guard();
CREATE TRIGGER finance_payout_batches_no_delete BEFORE DELETE ON finance_payout_batches FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_payout_batches_no_truncate BEFORE TRUNCATE ON finance_payout_batches FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_payout_items_no_delete BEFORE DELETE ON finance_payout_items FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_payout_items_no_truncate BEFORE TRUNCATE ON finance_payout_items FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_payout_events_append_only BEFORE UPDATE OR DELETE ON finance_payout_events FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_payout_events_no_truncate BEFORE TRUNCATE ON finance_payout_events FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
