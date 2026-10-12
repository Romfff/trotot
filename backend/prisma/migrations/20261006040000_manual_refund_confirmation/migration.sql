BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID'));
CREATE TABLE finance_refund_confirmations (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 refund_id UUID NOT NULL UNIQUE REFERENCES finance_refunds(id) ON DELETE RESTRICT,
 journal_id UUID NOT NULL UNIQUE REFERENCES finance_journals(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 bank_reference VARCHAR(200) NOT NULL CHECK(length(btrim(bank_reference)) BETWEEN 1 AND 200),
 reference_key VARCHAR(200) NOT NULL UNIQUE CHECK(reference_key=upper(btrim(bank_reference))),
 evidence_note VARCHAR(500) NOT NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 500),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 amount NUMERIC NOT NULL CHECK(amount>0 AND amount=trunc(amount) AND amount<10000000000000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER finance_refund_confirmations_append_only BEFORE UPDATE OR DELETE ON finance_refund_confirmations
 FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_refund_confirmations_no_truncate BEFORE TRUNCATE ON finance_refund_confirmations
 FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
