-- Independent ingest staging only. No active dataset or public feature is enabled here.
CREATE TABLE nearby_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version VARCHAR(100) NOT NULL UNIQUE,
  config_version VARCHAR(30) NOT NULL,
  source_url TEXT NOT NULL,
  source_as_of TIMESTAMPTZ NOT NULL,
  extract_sha256 CHAR(64) NOT NULL CHECK (extract_sha256 ~ '^[a-f0-9]{64}$'),
  export_sha256 CHAR(64) NOT NULL CHECK (export_sha256 ~ '^[a-f0-9]{64}$'),
  boundary_sha256 CHAR(64) NOT NULL CHECK (boundary_sha256 ~ '^[a-f0-9]{64}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'STAGED' CHECK (status = 'STAGED'),
  feature_count INTEGER NOT NULL CHECK (feature_count > 0),
  ignored_count INTEGER NOT NULL CHECK (ignored_count >= 0),
  outside_count INTEGER NOT NULL CHECK (outside_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE nearby_import_places (
  import_id UUID NOT NULL REFERENCES nearby_imports(id) ON DELETE RESTRICT,
  external_type VARCHAR(10) NOT NULL CHECK (external_type IN ('node','way','relation')),
  external_id VARCHAR(20) NOT NULL CHECK (external_id ~ '^[1-9][0-9]{0,18}$'),
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  source_updated_at TIMESTAMPTZ NOT NULL,
  name VARCHAR(300) NOT NULL,
  category VARCHAR(30) NOT NULL CHECK (category IN ('MARKETS','GROCERIES','UNIVERSITIES','HOSPITALS','BUS_STOPS','ATTRACTIONS','DINING','TRANSPORT')),
  tags JSONB NOT NULL,
  location GEOGRAPHY(Point,4326) NOT NULL,
  representative_method VARCHAR(30) NOT NULL CHECK (representative_method IN ('OSM_POINT','POINT_ON_SURFACE')),
  PRIMARY KEY (import_id, external_type, external_id),
  CHECK (ST_X(location::geometry) BETWEEN 102.1 AND 109.5 AND ST_Y(location::geometry) BETWEEN 8.4 AND 23.4)
);
CREATE INDEX nearby_import_places_location_idx ON nearby_import_places USING GIST (location);
CREATE INDEX nearby_import_places_category_idx ON nearby_import_places(import_id, category);
