CREATE TABLE nearby_places (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 external_type VARCHAR(10) NOT NULL CHECK (external_type IN ('node','way','relation')),
 external_id VARCHAR(20) NOT NULL,
 source VARCHAR(10) NOT NULL DEFAULT 'OSM' CHECK (source='OSM'),
 name VARCHAR(300) NOT NULL,
 category VARCHAR(30) NOT NULL,
 tags JSONB NOT NULL,
 location GEOGRAPHY(Point,4326) NOT NULL,
 representative_method VARCHAR(30) NOT NULL,
 dataset_id UUID NOT NULL REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 source_version INT NOT NULL,
 source_updated_at TIMESTAMPTZ NOT NULL,
 retired_at TIMESTAMPTZ,
 UNIQUE(source,external_type,external_id)
);
CREATE INDEX nearby_places_location_idx ON nearby_places USING GIST(location);
CREATE INDEX nearby_places_category_idx ON nearby_places(category) WHERE retired_at IS NULL;
CREATE TABLE nearby_dataset_state (
 id SMALLINT PRIMARY KEY CHECK(id=1),
 import_id UUID NOT NULL UNIQUE REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 promoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 review_reference VARCHAR(500) NOT NULL
);
CREATE TABLE property_nearby_snapshots (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
 coordinate_hash CHAR(64) NOT NULL,
 dataset_id UUID NOT NULL REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 config_version VARCHAR(30) NOT NULL,
 generation CHAR(64) NOT NULL,
 latitude DOUBLE PRECISION NOT NULL,
 longitude DOUBLE PRECISION NOT NULL,
 rental_mode VARCHAR(30) NOT NULL,
 province_code VARCHAR(20) NOT NULL,
 status VARCHAR(10) NOT NULL CHECK(status IN ('READY','EMPTY')),
 last_success_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days',
 UNIQUE(property_id,generation)
);
CREATE INDEX property_nearby_snapshots_due_idx ON property_nearby_snapshots(next_refresh_at,property_id);
CREATE TABLE nearby_job_failures (
 property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
 latitude DOUBLE PRECISION NOT NULL,
 longitude DOUBLE PRECISION NOT NULL,
 rental_mode VARCHAR(30) NOT NULL,
 province_code VARCHAR(20) NOT NULL,
 dataset_id UUID NOT NULL REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 config_version VARCHAR(30) NOT NULL,
 attempts INT NOT NULL DEFAULT 1,
 next_retry_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE property_nearby_places (
 snapshot_id UUID NOT NULL REFERENCES property_nearby_snapshots(id) ON DELETE CASCADE,
 place_id UUID NOT NULL REFERENCES nearby_places(id) ON DELETE RESTRICT,
 group_code VARCHAR(30) NOT NULL,
 rank INT NOT NULL CHECK(rank BETWEEN 1 AND 20),
 distance_meters DOUBLE PRECISION NOT NULL CHECK(distance_meters>=0 AND distance_meters<'Infinity'::float8),
 item JSONB NOT NULL,
 PRIMARY KEY(snapshot_id,place_id,group_code),
 UNIQUE(snapshot_id,group_code,rank)
);
CREATE TABLE property_nearby_state (
 property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
 active_snapshot_id UUID REFERENCES property_nearby_snapshots(id) ON DELETE SET NULL,
 visibility_version INT NOT NULL DEFAULT 0 CHECK(visibility_version>=0)
);
CREATE TABLE property_nearby_overrides (
 property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
 place_id UUID NOT NULL REFERENCES nearby_places(id) ON DELETE RESTRICT,
 hidden BOOLEAN NOT NULL,
 reason VARCHAR(500) NOT NULL,
 actor_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 version INT NOT NULL CHECK(version>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(property_id,place_id)
);
CREATE TABLE nearby_visibility_requests (
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 key VARCHAR(128) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 response JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,key)
);
CREATE TABLE nearby_visibility_audit (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
 place_id UUID NOT NULL REFERENCES nearby_places(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 before_value JSONB,
 after_value JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION nearby_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Nearby audit is append-only'; END; $$;
CREATE TRIGGER nearby_audit_immutable BEFORE UPDATE OR DELETE ON nearby_visibility_audit
FOR EACH ROW EXECUTE FUNCTION nearby_audit_append_only();
