BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID','HOST_BANK_SUBMIT','ADMIN_BANK_VERIFY','ADMIN_BANK_REJECT',
 'COMPLAINT_CREATE','HOST_COMPLAINT_RESPOND','ADMIN_COMPLAINT_ASSIGN'));
CREATE TABLE finance_complaints (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 guest_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
 assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,version INT NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX finance_complaints_one_open_booking ON finance_complaints(booking_id) WHERE status='OPEN';
CREATE INDEX finance_complaints_host_created_idx ON finance_complaints(host_id,created_at,id);
CREATE TABLE finance_complaint_events (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),complaint_id UUID NOT NULL REFERENCES finance_complaints(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action VARCHAR(10) NOT NULL CHECK(action IN ('CREATED','RESPONDED','ASSIGNED','RESOLVED')),
 message VARCHAR(500) NOT NULL CHECK(length(btrim(message)) BETWEEN 1 AND 500),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX finance_complaint_events_created_idx ON finance_complaint_events(complaint_id,created_at,id);
CREATE TRIGGER finance_complaint_events_append_only BEFORE UPDATE OR DELETE ON finance_complaint_events FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_complaint_events_no_truncate BEFORE TRUNCATE ON finance_complaint_events FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE FUNCTION finance_complaint_protect_intake() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.booking_id,NEW.guest_id,NEW.host_id,NEW.reason,NEW.created_at) IS DISTINCT FROM ROW(OLD.booking_id,OLD.guest_id,OLD.host_id,OLD.reason,OLD.created_at) THEN
  RAISE EXCEPTION 'Complaint intake is immutable' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER finance_complaint_protect_intake BEFORE UPDATE ON finance_complaints FOR EACH ROW EXECUTE FUNCTION finance_complaint_protect_intake();
CREATE TRIGGER finance_complaints_no_delete BEFORE DELETE ON finance_complaints FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_complaints_no_truncate BEFORE TRUNCATE ON finance_complaints FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
