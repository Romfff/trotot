CREATE TABLE nearby_import_quality (
 import_id UUID PRIMARY KEY REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 quarantined_count INT NOT NULL CHECK(quarantined_count>=0),
 report JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
