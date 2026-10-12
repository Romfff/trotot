-- S5 search cache: one authoritative DB generation, bumped in the SAME write
-- transaction. Rolled back writes do not invalidate; lost Redis invalidations
-- cannot expose old publication/Host state. No payload, contact or user tracking.
BEGIN;
CREATE TABLE public_search_epoch (
  id SMALLINT PRIMARY KEY CHECK(id=1),
  generation BIGINT NOT NULL CHECK(generation>=0)
);
INSERT INTO public_search_epoch(id,generation) VALUES(1,0);
CREATE FUNCTION invalidate_public_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public_search_epoch SET generation=generation+1 WHERE id=1;
  RETURN NULL;
END; $$;
DO $$
DECLARE relation_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['properties','long_term_details','property_images','amenities','property_amenity_mapping','users','address_provinces','address_wards'] LOOP
    EXECUTE format('CREATE TRIGGER public_search_invalidation AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION invalidate_public_search()',relation_name);
  END LOOP;
END; $$;
COMMIT;
