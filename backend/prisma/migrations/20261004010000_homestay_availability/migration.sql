-- S3-01/02: 02 section 2, 03/04 Sprint 3, approved G07 B/D.
-- Additive migration. No booking creation, holds, payment states or expiry worker here.
BEGIN;
CREATE TABLE homestay_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  unit_name VARCHAR(150) NOT NULL CHECK (length(btrim(unit_name)) > 0),
  max_adults INT NOT NULL CHECK (max_adults >= 1),
  max_children INT NOT NULL CHECK (max_children >= 0),
  bedrooms INT NOT NULL CHECK (bedrooms >= 0),
  bathrooms INT NOT NULL CHECK (bathrooms >= 0),
  base_price_per_night NUMERIC(15,2) NOT NULL CHECK (base_price_per_night >= 0 AND base_price_per_night <> 'NaN'::numeric),
  weekend_price_per_night NUMERIC(15,2) CHECK (weekend_price_per_night >= 0 AND weekend_price_per_night <> 'NaN'::numeric),
  cleaning_fee NUMERIC(12,2) NOT NULL CHECK (cleaning_fee >= 0 AND cleaning_fee <> 'NaN'::numeric),
  check_in_time TIME(0) NOT NULL,
  check_out_time TIME(0) NOT NULL,
  cancellation_policy VARCHAR(30) NOT NULL CHECK (cancellation_policy IN ('FLEXIBLE','MODERATE','STRICT')),
  instant_book BOOLEAN NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','PUBLISHED','REJECTED','HIDDEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX homestay_units_property_id_status_idx ON homestay_units(property_id,status);
CREATE TABLE calendar_pricing (
  id BIGSERIAL PRIMARY KEY,
  homestay_unit_id UUID NOT NULL REFERENCES homestay_units(id) ON DELETE RESTRICT,
  date DATE NOT NULL CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  custom_price NUMERIC(15,2) CHECK (custom_price >= 0 AND custom_price <> 'NaN'::numeric),
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','BLOCKED','BOOKED')),
  UNIQUE(homestay_unit_id,date)
);
COMMIT;
