BEGIN;
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE','HOST_CALENDAR_PRICE','HOST_CALENDAR_BLOCK',
 'GUEST_CANCEL_PAID','HOST_CANCEL_PAID','ADMIN_REFUND_PAID','HOST_BANK_SUBMIT','ADMIN_BANK_VERIFY','ADMIN_BANK_REJECT',
 'COMPLAINT_CREATE','HOST_COMPLAINT_RESPOND','ADMIN_COMPLAINT_ASSIGN','HOST_NO_SHOW_REPORT','ADMIN_NO_SHOW_RESOLVE'));
CREATE TABLE finance_no_show_reports (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
 host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE finance_no_show_resolutions (
 booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE RESTRICT,
 report_id UUID NOT NULL UNIQUE REFERENCES finance_no_show_reports(id) ON DELETE RESTRICT,
 source_journal_id UUID NOT NULL UNIQUE REFERENCES finance_journals(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 evidence_note VARCHAR(500) NOT NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX finance_no_show_reports_created_idx ON finance_no_show_reports(created_at,id);
CREATE FUNCTION finance_no_show_clock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created_at=clock_timestamp();RETURN NEW;END; $$;
CREATE TRIGGER finance_no_show_report_clock BEFORE INSERT ON finance_no_show_reports FOR EACH ROW EXECUTE FUNCTION finance_no_show_clock();
CREATE TRIGGER finance_no_show_resolution_clock BEFORE INSERT ON finance_no_show_resolutions FOR EACH ROW EXECUTE FUNCTION finance_no_show_clock();
CREATE FUNCTION finance_no_show_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_no_show_reports r JOIN bookings b ON b.id=r.booking_id
  JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
  JOIN finance_journals j ON j.id=NEW.source_journal_id AND j.booking_id=b.id AND j.host_id=p.host_id AND j.kind='PAYMENT'
  WHERE r.id=NEW.report_id AND r.booking_id=NEW.booking_id AND r.host_id=p.host_id
   AND b.booking_status='CONFIRMED' AND b.payment_status='PAID'
   AND ((b.check_out_date::text||'T'||(b.policy_snapshot->>'checkOutTime')||'+07:00')::timestamptz)<=clock_timestamp()) THEN
  RAISE EXCEPTION 'No-show resolution requires matching report/payment and elapsed checkout' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER finance_no_show_source BEFORE INSERT ON finance_no_show_resolutions FOR EACH ROW EXECUTE FUNCTION finance_no_show_source();
CREATE TRIGGER finance_no_show_reports_append_only BEFORE UPDATE OR DELETE ON finance_no_show_reports FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_no_show_reports_no_truncate BEFORE TRUNCATE ON finance_no_show_reports FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_no_show_resolutions_append_only BEFORE UPDATE OR DELETE ON finance_no_show_resolutions FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_no_show_resolutions_no_truncate BEFORE TRUNCATE ON finance_no_show_resolutions FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
