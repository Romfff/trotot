CREATE TABLE nearby_dataset_events (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 from_import_id UUID REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 to_import_id UUID NOT NULL REFERENCES nearby_imports(id) ON DELETE RESTRICT,
 action VARCHAR(10) NOT NULL CHECK(action IN ('PROMOTE','ROLLBACK')),
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER nearby_dataset_events_immutable BEFORE UPDATE OR DELETE ON nearby_dataset_events
FOR EACH ROW EXECUTE FUNCTION nearby_audit_append_only();
