-- S5-01: 01/02/03/04 and owner-approved D-S5-01. No booking state or payment mutation.
BEGIN;
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  guest_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cleanliness INT NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  location INT NOT NULL CHECK (location BETWEEN 1 AND 5),
  value INT NOT NULL CHECK (value BETWEEN 1 AND 5),
  comment VARCHAR(2000) NOT NULL CHECK (length(btrim(comment)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reviews_created_id_idx ON reviews(created_at DESC,id DESC);
CREATE FUNCTION verified_review_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings%ROWTYPE;
BEGIN
  SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
  IF b.id IS NULL OR b.guest_id <> NEW.guest_id OR b.booking_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Review requires own completed booking' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.guest_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'Review requires active guest' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER verified_review_insert BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION verified_review_insert_guard();
COMMIT;
