CREATE TABLE user_moderation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status_before VARCHAR(20) NOT NULL,
  status_after VARCHAR(20) NOT NULL,
  reason VARCHAR(500) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CHECK (actor_id <> target_id),
  CHECK ((status_before='ACTIVE' AND status_after='BANNED') OR
         (status_before='BANNED' AND status_after='ACTIVE'))
);
CREATE INDEX user_moderation_events_target_id_created_at_id_idx ON user_moderation_events(target_id,created_at,id);
CREATE FUNCTION protect_user_moderation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'User moderation audit is append only'; END;
$$;
CREATE TRIGGER user_moderation_events_append_only BEFORE UPDATE OR DELETE ON user_moderation_events
FOR EACH ROW EXECUTE FUNCTION protect_user_moderation_event();
CREATE TRIGGER user_moderation_events_no_truncate BEFORE TRUNCATE ON user_moderation_events
FOR EACH STATEMENT EXECUTE FUNCTION protect_user_moderation_event();
