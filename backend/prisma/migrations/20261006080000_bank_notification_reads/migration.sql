CREATE TABLE finance_bank_notification_reads (
 event_id UUID PRIMARY KEY REFERENCES finance_bank_events(id) ON DELETE RESTRICT,
 read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
