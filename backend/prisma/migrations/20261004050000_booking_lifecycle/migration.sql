BEGIN;
ALTER TABLE bookings ADD COLUMN inventory_lock JSONB;
ALTER TABLE bookings DROP CONSTRAINT bookings_booking_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_booking_status_check CHECK (booking_status IN (
 'PENDING_HOST_APPROVAL','PENDING_PAYMENT','REJECTED_BY_HOST','CANCELLED_HOST_TIMEOUT','CANCELLED_TIMEOUT',
 'CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','CANCELLED_BY_GUEST'));
ALTER TABLE booking_idempotency DROP CONSTRAINT booking_idempotency_operation_check;
ALTER TABLE booking_idempotency ADD CONSTRAINT booking_idempotency_operation_check CHECK (operation IN (
 'HOLD','HOST_ACCEPT','HOST_REJECT','GUEST_CANCEL','HOST_CHECK_IN','HOST_COMPLETE'));
COMMIT;
