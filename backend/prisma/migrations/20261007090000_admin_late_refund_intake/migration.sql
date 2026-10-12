-- APPROVED-S4-HOST-DEBT-FIFO: Admin-only intake; no money/state mutation.
BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK(operation IN(
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID','HOST_BANK_SUBMIT','ADMIN_BANK_VERIFY','ADMIN_BANK_REJECT',
 'COMPLAINT_CREATE','HOST_COMPLAINT_RESPOND','ADMIN_COMPLAINT_ASSIGN','HOST_NO_SHOW_REPORT','ADMIN_NO_SHOW_RESOLVE','ADMIN_COMPLAINT_RESOLVE',
 'ADMIN_PAYOUT_DRAFT','ADMIN_PAYOUT_CANCEL','ADMIN_PAYOUT_APPROVE','ADMIN_PAYOUT_PAID','PAYMENT_SESSION','ADMIN_LATE_REFUND_CREATE'));
CREATE FUNCTION finance_admin_late_case_eligible(booking_status TEXT,payment_status TEXT,completed_at TIMESTAMPTZ,at_time TIMESTAMPTZ)
 RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(booking_status='COMPLETED' AND payment_status='PAID' AND completed_at IS NOT NULL
   AND isfinite(completed_at) AND isfinite(at_time) AND at_time>=completed_at+interval '72 hours',false);
$$;
CREATE TABLE finance_admin_late_cases (
 complaint_id UUID PRIMARY KEY REFERENCES finance_complaints(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 evidence_note VARCHAR(500) NOT NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 500),
 booking_version_at_open INT NOT NULL CHECK(booking_version_at_open>=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current())
);
CREATE FUNCTION finance_admin_late_case_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c finance_complaints%ROWTYPE; b bookings%ROWTYPE; host UUID;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE) THEN
  RAISE EXCEPTION 'Late refund intake requires active Admin' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM finance_complaints WHERE id=NEW.complaint_id FOR UPDATE;
 SELECT * INTO b FROM bookings WHERE id=c.booking_id FOR UPDATE;
 SELECT p.host_id INTO host FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=b.homestay_unit_id;
 IF c.status IS DISTINCT FROM 'OPEN' OR c.version<>1 OR c.guest_id IS DISTINCT FROM b.guest_id OR c.host_id IS DISTINCT FROM host
  OR NEW.booking_version_at_open IS DISTINCT FROM b.version
  OR NOT finance_admin_late_case_eligible(b.booking_status,b.payment_status,b.completed_at,clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM finance_complaint_events e WHERE e.complaint_id=c.id AND e.actor_id=NEW.actor_id
   AND e.action='CREATED' AND e.message=c.reason AND e.created_txid=txid_current()) THEN
  RAISE EXCEPTION 'Late refund intake requires expired completed booking and same-transaction audit' USING ERRCODE='23514';
 END IF;
 NEW.created_at=clock_timestamp(); RETURN NEW;
END; $$;
CREATE TRIGGER finance_admin_late_case_source BEFORE INSERT ON finance_admin_late_cases FOR EACH ROW EXECUTE FUNCTION finance_admin_late_case_source();
CREATE TRIGGER finance_admin_late_cases_append_only BEFORE UPDATE OR DELETE ON finance_admin_late_cases FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_admin_late_cases_no_truncate BEFORE TRUNCATE ON finance_admin_late_cases FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
