ALTER TABLE bookings ADD COLUMN completed_at TIMESTAMPTZ;
-- Legacy COMPLETED rows stay NULL: updated_at is not evidence of completion.
CREATE FUNCTION booking_record_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.completed_at IS NOT NULL THEN
   RAISE EXCEPTION 'Completion timestamp must come from a completion transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.booking_status IS DISTINCT FROM 'COMPLETED' AND NEW.booking_status='COMPLETED' THEN
  IF OLD.completed_at IS NOT NULL THEN
   RAISE EXCEPTION 'Booking completion is already recorded' USING ERRCODE='23514';
  END IF;
  NEW.completed_at=clock_timestamp();
 ELSIF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
  RAISE EXCEPTION 'Completion timestamp is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER booking_record_completion BEFORE INSERT OR UPDATE ON bookings
 FOR EACH ROW EXECUTE FUNCTION booking_record_completion();
