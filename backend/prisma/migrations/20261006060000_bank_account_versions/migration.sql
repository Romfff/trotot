BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID','HOST_BANK_SUBMIT','ADMIN_BANK_VERIFY','ADMIN_BANK_REJECT'));
CREATE TABLE finance_bank_accounts (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 bank_code VARCHAR(20) NOT NULL,account_number VARCHAR(50) NOT NULL,account_name VARCHAR(150) NOT NULL,
 status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REJECTED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(bank_code ~ '^[A-Z0-9_-]{1,20}$'),CHECK(account_number ~ '^[A-Za-z0-9]{1,50}$'),CHECK(length(btrim(account_name)) BETWEEN 1 AND 150),
 UNIQUE(host_id,id)
);
CREATE TABLE finance_bank_states (
 host_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 account_id UUID NOT NULL UNIQUE,version INT NOT NULL CHECK(version>=1),
 FOREIGN KEY(host_id,account_id) REFERENCES finance_bank_accounts(host_id,id) ON DELETE RESTRICT
);
CREATE TABLE finance_bank_events (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),account_id UUID NOT NULL REFERENCES finance_bank_accounts(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,action VARCHAR(10) NOT NULL CHECK(action IN ('SUBMITTED','VERIFIED','REJECTED')),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 evidence_note VARCHAR(500) NOT NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX finance_bank_accounts_host_created_idx ON finance_bank_accounts(host_id,created_at,id);
CREATE INDEX finance_bank_events_account_created_idx ON finance_bank_events(account_id,created_at,id);
CREATE TRIGGER finance_bank_events_append_only BEFORE UPDATE OR DELETE ON finance_bank_events FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_bank_events_no_truncate BEFORE TRUNCATE ON finance_bank_events FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE FUNCTION finance_bank_protect_details() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.host_id,NEW.bank_code,NEW.account_number,NEW.account_name,NEW.created_at) IS DISTINCT FROM ROW(OLD.host_id,OLD.bank_code,OLD.account_number,OLD.account_name,OLD.created_at) THEN
  RAISE EXCEPTION 'Bank account details are immutable; submit a new version' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER finance_bank_protect_details BEFORE UPDATE ON finance_bank_accounts FOR EACH ROW EXECUTE FUNCTION finance_bank_protect_details();
CREATE TRIGGER finance_bank_accounts_no_delete BEFORE DELETE ON finance_bank_accounts FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_bank_accounts_no_truncate BEFORE TRUNCATE ON finance_bank_accounts FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
