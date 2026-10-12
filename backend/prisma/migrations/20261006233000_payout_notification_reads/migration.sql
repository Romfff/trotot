BEGIN;
CREATE TABLE finance_payout_notification_reads (
 event_id UUID NOT NULL REFERENCES finance_payout_events(id) ON DELETE RESTRICT,
 recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(event_id,recipient_id)
);
CREATE FUNCTION finance_payout_notification_recipient() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_payout_events e JOIN finance_payout_batches b ON b.id=e.batch_id
  WHERE e.id=NEW.event_id AND b.host_id=NEW.recipient_id) THEN
  RAISE EXCEPTION 'Payout notification belongs to another recipient' USING ERRCODE='23514';
 END IF;
 NEW.read_at=clock_timestamp(); RETURN NEW;
END; $$;
CREATE TRIGGER finance_payout_notification_recipient BEFORE INSERT ON finance_payout_notification_reads
 FOR EACH ROW EXECUTE FUNCTION finance_payout_notification_recipient();
CREATE TRIGGER finance_payout_notification_reads_append_only BEFORE UPDATE OR DELETE ON finance_payout_notification_reads
 FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_payout_notification_reads_no_truncate BEFORE TRUNCATE ON finance_payout_notification_reads
 FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
