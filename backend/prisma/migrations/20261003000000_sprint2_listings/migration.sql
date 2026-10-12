-- Sprint 2, source: 02 section 2 + 03 Sprint 2. No changes to Sprint 1 tables/data.
BEGIN;
CREATE TABLE address_provinces (code VARCHAR(20) PRIMARY KEY,name VARCHAR(150) NOT NULL);
CREATE TABLE address_wards (
  code VARCHAR(20) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  province_code VARCHAR(20) NOT NULL REFERENCES address_provinces(code) ON DELETE RESTRICT,
  UNIQUE(code,province_code)
);
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(300) NOT NULL UNIQUE,
  property_type VARCHAR(50) NOT NULL,
  rental_mode VARCHAR(30) NOT NULL CHECK (rental_mode IN ('LONG_TERM','SHORT_TERM','HYBRID')),
  listing_plan VARCHAR(20) NOT NULL DEFAULT 'FREE' CHECK (listing_plan IN ('FREE','PAID')),
  description TEXT NOT NULL,
  video_url VARCHAR(2048),
  address_detail VARCHAR(255) NOT NULL,
  province_code VARCHAR(20) NOT NULL,
  -- Current administrative addresses approved by the owner on 2026-10-03.
  -- Retain the legacy field, but never invent a district for a two-tier address.
  district_code VARCHAR(20),
  ward_code VARCHAR(20) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location GEOMETRY(Point,4326),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted_at TIMESTAMPTZ,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','HIDDEN','EXPIRED')),
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  vip_expire_at TIMESTAMPTZ,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  view_count INT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ward_code,province_code) REFERENCES address_wards(code,province_code) ON DELETE RESTRICT
);
CREATE FUNCTION update_property_location() RETURNS TRIGGER AS $$
BEGIN
  NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude),4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_update_property_location BEFORE INSERT OR UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION update_property_location();
CREATE INDEX idx_properties_location ON properties USING GIST(location);
-- The radius query casts to geography (meters), so index that expression too.
CREATE INDEX idx_properties_location_geography ON properties USING GIST((location::geography));
CREATE INDEX properties_host_id_status_idx ON properties(host_id,status);
CREATE INDEX properties_rental_mode_status_created_at_id_idx ON properties(rental_mode,status,created_at,id);
CREATE INDEX properties_province_code_district_code_status_idx ON properties(province_code,district_code,status);

CREATE TABLE property_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE long_term_details (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  monthly_price NUMERIC(15,2) NOT NULL CHECK (monthly_price >= 0),
  deposit_amount NUMERIC(15,2) NOT NULL CHECK (deposit_amount >= 0),
  lease_term_months INT NOT NULL DEFAULT 6 CHECK (lease_term_months > 0),
  area_sqm NUMERIC(6,2) NOT NULL CHECK (area_sqm > 0),
  electricity_cost NUMERIC(12,2) NOT NULL CHECK (electricity_cost >= 0),
  water_cost NUMERIC(12,2) NOT NULL CHECK (water_cost >= 0),
  water_unit VARCHAR(20) NOT NULL DEFAULT 'M3' CHECK (water_unit IN ('M3','PERSON')),
  internet_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (internet_cost >= 0),
  garbage_cost NUMERIC(12,2) NOT NULL CHECK (garbage_cost >= 0),
  parking_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (parking_fee >= 0),
  contact_phone VARCHAR(20) NOT NULL,
  contact_zalo VARCHAR(20),
  allow_pets BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX long_term_details_monthly_price_property_id_idx ON long_term_details(monthly_price,property_id);
CREATE INDEX long_term_details_area_sqm_idx ON long_term_details(area_sqm);

CREATE TABLE amenities (id VARCHAR(50) PRIMARY KEY,name VARCHAR(100) NOT NULL);
-- IDs from 06 examples, remaining names from 01 section 3.1; pets is the separate allowPets field.
INSERT INTO amenities(id,name) VALUES
  ('air_cond','Máy lạnh'),('wifi','Wi-Fi'),('mezzanine','Gác lửng'),('camera','Camera an ninh'),
  ('balcony','Ban công'),('washer','Máy giặt'),('kitchen','Kệ bếp'),('private_wc','WC riêng'),
  ('security_24h','Bảo vệ 24/7'),('no_curfew','Giờ giấc tự do'),('elevator','Thang máy');
CREATE TABLE property_amenity_mapping (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  amenity_id VARCHAR(50) NOT NULL REFERENCES amenities(id) ON DELETE RESTRICT,
  PRIMARY KEY(property_id,amenity_id)
);
CREATE INDEX property_amenity_mapping_amenity_id_property_id_idx ON property_amenity_mapping(amenity_id,property_id);
CREATE TABLE property_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url VARCHAR(2048) NOT NULL,
  position INT NOT NULL CHECK (position BETWEEN 0 AND 14),
  UNIQUE(property_id,position)
);
CREATE TABLE viewing_appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_name VARCHAR(150) NOT NULL,
  tenant_phone VARCHAR(20) NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME(0) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX viewing_appointments_tenant_id_scheduled_date_idx ON viewing_appointments(tenant_id,scheduled_date);
CREATE INDEX viewing_appointments_property_id_scheduled_date_idx ON viewing_appointments(property_id,scheduled_date);
COMMIT;
