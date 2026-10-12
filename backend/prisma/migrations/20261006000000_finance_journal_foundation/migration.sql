-- S4-LEDGER-FOUNDATION, APPROVED-14: additive append-only balanced VND journal.
-- No provider, payout allocation, bank workflow or automatic transfer is enabled here.
BEGIN;
CREATE TABLE finance_journals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_key VARCHAR(256) NOT NULL UNIQUE CHECK (event_key ~ '^[!-~]{1,256}$'),
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  kind VARCHAR(30) NOT NULL CHECK (kind IN ('PAYMENT','REFUND','PAYOUT','ADJUSTMENT')),
  booking_id UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  reason VARCHAR(500) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  currency VARCHAR(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK (created_txid = txid_current())
);
CREATE TABLE finance_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_id UUID NOT NULL REFERENCES finance_journals(id) ON DELETE RESTRICT,
  line_number INT NOT NULL CHECK (line_number BETWEEN 1 AND 20),
  account VARCHAR(30) NOT NULL CHECK (account IN (
    'CASH_CLEARING','HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE','REFUND_PAYABLE','HOST_DEBT')),
  side VARCHAR(6) NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount NUMERIC NOT NULL CHECK (amount > 0 AND amount = trunc(amount) AND amount <> 'NaN'::numeric AND amount < '1000000000000000000'::numeric),
  CONSTRAINT finance_entries_line_unique UNIQUE (journal_id,line_number)
);
CREATE INDEX finance_journals_host_created_idx ON finance_journals(host_id,created_at,id);
CREATE INDEX finance_journals_booking_idx ON finance_journals(booking_id);

CREATE FUNCTION finance_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial journal is append-only; record a new correcting entry' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER finance_journals_append_only BEFORE UPDATE OR DELETE ON finance_journals
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_entries_append_only BEFORE UPDATE OR DELETE ON finance_entries
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_journals_no_truncate BEFORE TRUNCATE ON finance_journals
  FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_entries_no_truncate BEFORE TRUNCATE ON finance_entries
  FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();

CREATE FUNCTION finance_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_txid BIGINT;
BEGIN
  SELECT created_txid INTO journal_txid FROM finance_journals WHERE id=NEW.journal_id FOR SHARE;
  IF journal_txid IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION 'Cannot append lines to a previously committed journal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_entries_creation_transaction BEFORE INSERT ON finance_entries
  FOR EACH ROW EXECUTE FUNCTION finance_entry_insert_guard();

CREATE FUNCTION finance_validate_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_count BIGINT; debit_total NUMERIC; credit_total NUMERIC; target_id UUID;
BEGIN
  IF TG_TABLE_NAME='finance_entries' THEN target_id=NEW.journal_id; ELSE target_id=NEW.id; END IF;
  SELECT count(*),COALESCE(sum(amount) FILTER (WHERE side='DEBIT'),0),COALESCE(sum(amount) FILTER (WHERE side='CREDIT'),0)
    INTO line_count,debit_total,credit_total FROM finance_entries WHERE journal_id=target_id;
  IF line_count < 2 OR debit_total <= 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'Financial journal must balance debit and credit before commit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER finance_journal_balanced AFTER INSERT ON finance_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_balance();
CREATE CONSTRAINT TRIGGER finance_entries_balanced AFTER INSERT ON finance_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_balance();
COMMIT;
