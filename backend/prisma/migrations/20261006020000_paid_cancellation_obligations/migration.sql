BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID'));
CREATE TABLE finance_cancellations (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_type VARCHAR(5) NOT NULL CHECK (actor_type IN ('GUEST','HOST')),
 reason VARCHAR(500) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 refund_amount NUMERIC NOT NULL CHECK (refund_amount >= 0 AND refund_amount=trunc(refund_amount) AND refund_amount < 10000000000000),
 calculation JSONB NOT NULL CHECK (jsonb_typeof(calculation)='object'),
 source_journal_id UUID NOT NULL REFERENCES finance_journals(id) ON DELETE RESTRICT,
 reversal_journal_id UUID REFERENCES finance_journals(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK ((refund_amount=0 AND reversal_journal_id IS NULL) OR (refund_amount>0 AND reversal_journal_id IS NOT NULL))
);
CREATE TRIGGER finance_cancellations_append_only BEFORE UPDATE OR DELETE ON finance_cancellations
 FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_cancellations_no_truncate BEFORE TRUNCATE ON finance_cancellations
 FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE TABLE finance_refunds (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 cancellation_id UUID NOT NULL UNIQUE REFERENCES finance_cancellations(id) ON DELETE RESTRICT,
 amount NUMERIC NOT NULL CHECK (amount>0 AND amount=trunc(amount) AND amount<10000000000000),
 status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED')),
 version INT NOT NULL DEFAULT 1 CHECK (version>=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX finance_refunds_status_created_idx ON finance_refunds(status,created_at,id);
CREATE FUNCTION finance_refund_protect_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.cancellation_id,NEW.amount,NEW.created_at) IS DISTINCT FROM ROW(OLD.cancellation_id,OLD.amount,OLD.created_at) THEN
  RAISE EXCEPTION 'Refund obligation amount and source are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finance_refund_protect_obligation BEFORE UPDATE ON finance_refunds
 FOR EACH ROW EXECUTE FUNCTION finance_refund_protect_obligation();
CREATE TRIGGER finance_refunds_no_delete BEFORE DELETE ON finance_refunds
 FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_refunds_no_truncate BEFORE TRUNCATE ON finance_refunds
 FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
