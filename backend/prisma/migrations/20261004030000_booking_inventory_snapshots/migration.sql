-- S3-01/04, 02 bookings, 03/04 Sprint3, owner-approved G07 B/D and G02/G03.
-- Additive, no public hold endpoint or undecided transition/provider policy.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_code VARCHAR(32) NOT NULL UNIQUE CHECK (length(btrim(booking_code)) > 0),
  homestay_unit_id UUID NOT NULL REFERENCES homestay_units(id) ON DELETE RESTRICT,
  guest_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  check_in_date DATE NOT NULL CHECK (check_in_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  check_out_date DATE NOT NULL CHECK (check_out_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  total_nights INT NOT NULL CHECK (total_nights BETWEEN 1 AND 90 AND total_nights = check_out_date - check_in_date),
  num_adults INT NOT NULL CHECK (num_adults >= 1),
  num_children INT NOT NULL CHECK (num_children >= 0),
  guest_name VARCHAR(150) NOT NULL CHECK (length(btrim(guest_name)) > 0),
  guest_phone VARCHAR(20) NOT NULL CHECK (length(btrim(guest_phone)) > 0),
  guest_email VARCHAR(255), guest_notes TEXT,
  nightly_prices JSONB NOT NULL CHECK (jsonb_typeof(nightly_prices) = 'array' AND jsonb_array_length(nightly_prices) = total_nights),
  policy_snapshot JSONB NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  base_amount NUMERIC(15,2) NOT NULL CHECK (base_amount >= 0 AND base_amount = trunc(base_amount) AND base_amount <> 'NaN'::numeric),
  cleaning_fee NUMERIC(15,2) NOT NULL CHECK (cleaning_fee >= 0 AND cleaning_fee = trunc(cleaning_fee) AND cleaning_fee <> 'NaN'::numeric),
  service_fee NUMERIC(15,2) NOT NULL CHECK (service_fee >= 0 AND service_fee = trunc(service_fee) AND service_fee <> 'NaN'::numeric),
  tax_amount NUMERIC(15,2) NOT NULL CHECK (tax_amount >= 0 AND tax_amount = trunc(tax_amount) AND tax_amount <> 'NaN'::numeric),
  total_amount NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0 AND total_amount = trunc(total_amount) AND total_amount <> 'NaN'::numeric),
  service_fee_rate NUMERIC(5,2) NOT NULL CHECK (service_fee_rate BETWEEN 0 AND 100 AND service_fee_rate <> 'NaN'::numeric),
  tax_rate NUMERIC(5,2) NOT NULL CHECK (tax_rate BETWEEN 0 AND 100 AND tax_rate <> 'NaN'::numeric),
  commission_rate NUMERIC(5,2) NOT NULL CHECK (commission_rate BETWEEN 8 AND 12 AND commission_rate <> 'NaN'::numeric),
  commission_amount NUMERIC(15,2) NOT NULL CHECK (commission_amount >= 0 AND commission_amount = trunc(commission_amount) AND commission_amount <> 'NaN'::numeric),
  host_payout_amount NUMERIC(15,2) NOT NULL CHECK (host_payout_amount >= 0 AND host_payout_amount = trunc(host_payout_amount) AND host_payout_amount <> 'NaN'::numeric),
  booking_status VARCHAR(30) NOT NULL CHECK (booking_status IN (
    'PENDING_HOST_APPROVAL','PENDING_PAYMENT','REJECTED_BY_HOST','CANCELLED_HOST_TIMEOUT','CANCELLED_TIMEOUT',
    'CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED')),
  payment_status VARCHAR(30) NOT NULL CHECK (payment_status IN ('NOT_CONFIGURED','PENDING','PAID','REFUNDED')),
  expires_at TIMESTAMPTZ NOT NULL,
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bookings_valid_stay CHECK (check_out_date > check_in_date),
  CONSTRAINT bookings_guest_total CHECK (total_amount = base_amount + cleaning_fee + service_fee + tax_amount),
  CONSTRAINT bookings_service_fee CHECK (service_fee = round((base_amount + cleaning_fee) * service_fee_rate / 100)),
  CONSTRAINT bookings_tax_amount CHECK (tax_amount = round((base_amount + cleaning_fee + service_fee) * tax_rate / 100)),
  CONSTRAINT bookings_commission CHECK (commission_amount = round((base_amount + cleaning_fee) * commission_rate / 100)),
  CONSTRAINT bookings_host_payout CHECK (host_payout_amount = base_amount + cleaning_fee - commission_amount),
  CONSTRAINT bookings_paid_state CHECK (
    booking_status NOT IN ('CONFIRMED','CHECKED_IN','COMPLETED') OR payment_status = 'PAID'),
  CONSTRAINT bookings_pending_state CHECK (
    booking_status NOT IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT') OR payment_status IN ('NOT_CONFIGURED','PENDING')),
  -- Never use now() in an exclusion predicate. Expiry atomically transitions the row first.
  CONSTRAINT bookings_no_active_overlap EXCLUDE USING gist (
    homestay_unit_id WITH =, daterange(check_in_date,check_out_date,'[)') WITH &&
  ) WHERE (booking_status IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED','CHECKED_IN'))
);
CREATE INDEX bookings_guest_id_created_at_id_idx ON bookings(guest_id,created_at,id);
CREATE INDEX bookings_homestay_unit_id_booking_status_idx ON bookings(homestay_unit_id,booking_status);
CREATE INDEX bookings_booking_status_expires_at_idx ON bookings(booking_status,expires_at);
CREATE FUNCTION protect_booking_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.homestay_unit_id,NEW.guest_id,NEW.check_in_date,NEW.check_out_date,NEW.total_nights,
    NEW.num_adults,NEW.num_children,NEW.nightly_prices,NEW.policy_snapshot,NEW.base_amount,NEW.cleaning_fee,
    NEW.service_fee,NEW.tax_amount,NEW.total_amount,NEW.service_fee_rate,NEW.tax_rate,NEW.commission_rate,
    NEW.commission_amount,NEW.host_payout_amount)
    IS DISTINCT FROM ROW(OLD.homestay_unit_id,OLD.guest_id,OLD.check_in_date,OLD.check_out_date,OLD.total_nights,
    OLD.num_adults,OLD.num_children,OLD.nightly_prices,OLD.policy_snapshot,OLD.base_amount,OLD.cleaning_fee,
    OLD.service_fee,OLD.tax_amount,OLD.total_amount,OLD.service_fee_rate,OLD.tax_rate,OLD.commission_rate,
    OLD.commission_amount,OLD.host_payout_amount) THEN
    RAISE EXCEPTION 'Booking stay and pricing/policy snapshots are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bookings_protect_snapshot BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION protect_booking_snapshot();
CREATE TABLE booking_idempotency (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation VARCHAR(30) NOT NULL CHECK (operation IN ('HOLD','HOST_ACCEPT','HOST_REJECT')),
  key VARCHAR(128) NOT NULL CHECK (length(key) > 0),
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_status INT NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_body JSONB NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at = created_at + INTERVAL '168 hours'),
  UNIQUE(user_id,operation,key)
);
CREATE INDEX booking_idempotency_expires_at_idx ON booking_idempotency(expires_at);
COMMIT;
