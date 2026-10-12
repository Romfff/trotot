-- Approved D04/D07. Abort on inconsistent historical data; never repair/delete it silently.
ALTER TABLE viewing_appointments
 ADD COLUMN reason VARCHAR(500),
 ADD COLUMN cancelled_by VARCHAR(10),
 ADD COLUMN updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD CONSTRAINT appointment_status CHECK (status IN ('PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED')),
 ADD CONSTRAINT appointment_cancelled_by CHECK (cancelled_by IS NULL OR cancelled_by IN ('TENANT','HOST','SYSTEM'));
CREATE UNIQUE INDEX appointment_one_active_pair ON viewing_appointments(tenant_id,property_id)
 WHERE status IN ('PENDING','ACCEPTED');
CREATE INDEX appointment_pending_deadline ON viewing_appointments(scheduled_date,scheduled_time,id) WHERE status='PENDING';
CREATE TABLE appointment_idempotency (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 operation VARCHAR(30) NOT NULL DEFAULT 'POST /appointments', key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL, response_body JSONB NOT NULL, expires_at TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT appointment_idempotency_user_id_operation_key_key UNIQUE(user_id,operation,key)
);
CREATE INDEX appointment_idempotency_expires_at_idx ON appointment_idempotency(expires_at);
CREATE TABLE appointment_notifications (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 appointment_id UUID NOT NULL REFERENCES viewing_appointments(id) ON DELETE RESTRICT,
 type VARCHAR(30) NOT NULL, message VARCHAR(500) NOT NULL, read_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX appointment_notifications_recipient_id_created_at_id_idx ON appointment_notifications(recipient_id,created_at,id);
CREATE INDEX appointment_notifications_recipient_id_read_at_idx ON appointment_notifications(recipient_id,read_at);
