-- S5-02: durable minimal moderation audit; no changes to existing migration files.
CREATE TABLE listing_moderation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  action VARCHAR(10) NOT NULL CHECK (action IN ('APPROVE','REJECT')),
  target VARCHAR(10) NOT NULL CHECK (target IN ('LISTING','REVISION')),
  reviewed_version INTEGER NOT NULL CHECK (reviewed_version > 0),
  result_version INTEGER NOT NULL CHECK (result_version = reviewed_version + 1),
  status_before VARCHAR(30) NOT NULL,
  status_after VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(property_id,reviewed_version)
);
CREATE INDEX listing_moderation_events_actor_id_created_at_idx ON listing_moderation_events(actor_id,created_at);
