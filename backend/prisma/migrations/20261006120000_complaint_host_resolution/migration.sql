-- APPROVED-14 #11/#13: Admin HOST resolution, no refund or money mutation.
BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID','HOST_BANK_SUBMIT','ADMIN_BANK_VERIFY','ADMIN_BANK_REJECT',
 'COMPLAINT_CREATE','HOST_COMPLAINT_RESPOND','ADMIN_COMPLAINT_ASSIGN','HOST_NO_SHOW_REPORT','ADMIN_NO_SHOW_RESOLVE','ADMIN_COMPLAINT_RESOLVE'));
ALTER TABLE finance_complaint_events ADD COLUMN created_txid BIGINT NOT NULL DEFAULT txid_current();
CREATE TABLE finance_complaint_resolutions (
 complaint_id UUID PRIMARY KEY REFERENCES finance_complaints(id) ON DELETE RESTRICT,
 event_id UUID NOT NULL UNIQUE REFERENCES finance_complaint_events(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 decision VARCHAR(20) NOT NULL CHECK(decision='HOST'),
 version_before INT NOT NULL CHECK(version_before>=1 AND version_before<2147483647),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 evidence_note VARCHAR(500) NOT NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current())
);
CREATE FUNCTION finance_complaint_resolution_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status VARCHAR; current_version INT;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE) THEN
  RAISE EXCEPTION 'Complaint resolution requires an active Admin' USING ERRCODE='23514';
 END IF;
 SELECT status,version INTO current_status,current_version FROM finance_complaints WHERE id=NEW.complaint_id FOR UPDATE;
 IF current_status IS DISTINCT FROM 'OPEN' OR current_version IS DISTINCT FROM NEW.version_before OR NOT EXISTS(
  SELECT 1 FROM finance_complaint_events e WHERE e.id=NEW.event_id AND e.complaint_id=NEW.complaint_id
   AND e.actor_id=NEW.actor_id AND e.action='RESOLVED' AND e.message=NEW.reason AND e.created_txid=txid_current()
 ) THEN
  RAISE EXCEPTION 'Complaint resolution requires current OPEN version and matching transaction audit' USING ERRCODE='23514';
 END IF;
 NEW.created_at=clock_timestamp(); RETURN NEW;
END; $$;
CREATE TRIGGER finance_complaint_resolution_source BEFORE INSERT ON finance_complaint_resolutions
 FOR EACH ROW EXECUTE FUNCTION finance_complaint_resolution_source();
CREATE FUNCTION finance_complaint_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'OPEN' THEN RAISE EXCEPTION 'Complaint must start OPEN' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='RESOLVED' THEN
  RAISE EXCEPTION 'Resolved complaint cannot be changed or reopened' USING ERRCODE='23514';
 ELSIF NEW.status='RESOLVED' AND (NEW.version<>OLD.version+1 OR NOT EXISTS(
  SELECT 1 FROM finance_complaint_resolutions r WHERE r.complaint_id=NEW.id AND r.version_before=OLD.version AND r.created_txid=txid_current()
 )) THEN
  RAISE EXCEPTION 'Closing complaint requires resolution proof in same transaction' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER finance_complaint_status_guard BEFORE INSERT OR UPDATE ON finance_complaints
 FOR EACH ROW EXECUTE FUNCTION finance_complaint_status_guard();
CREATE FUNCTION finance_complaint_resolution_committed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_complaints c WHERE c.id=NEW.complaint_id AND c.status='RESOLVED' AND c.version=NEW.version_before+1) THEN
  RAISE EXCEPTION 'Resolution must commit with matching closed complaint version' USING ERRCODE='23514';
 END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_complaint_resolution_committed AFTER INSERT ON finance_complaint_resolutions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_complaint_resolution_committed();
CREATE TRIGGER finance_complaint_resolutions_append_only BEFORE UPDATE OR DELETE ON finance_complaint_resolutions
 FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_complaint_resolutions_no_truncate BEFORE TRUNCATE ON finance_complaint_resolutions
 FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
