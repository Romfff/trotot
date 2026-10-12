-- Review follow-up: rounded nightly snapshots must match the stay and base subtotal.
-- Keep the preceding migration intact after its first real-DB verification.
BEGIN;
CREATE FUNCTION booking_nightly_snapshot_valid(prices JSONB, arrival DATE, departure DATE, subtotal NUMERIC)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(prices) <> 'array' THEN false ELSE (
    SELECT count(*) = departure - arrival
      AND bool_and(COALESCE(
        jsonb_typeof(item) = 'object'
        AND item->>'date' = to_char(arrival + ordinal::int - 1,'YYYY-MM-DD')
        AND item->>'price' ~ '^(0|[1-9][0-9]{0,12})$',false))
      AND sum(CASE WHEN item->>'price' ~ '^(0|[1-9][0-9]{0,12})$'
        THEN (item->>'price')::numeric ELSE NULL END) = subtotal
    FROM jsonb_array_elements(prices) WITH ORDINALITY AS night(item,ordinal)
  ) END;
$$;
ALTER TABLE bookings ADD CONSTRAINT bookings_nightly_snapshot_matches
  CHECK (booking_nightly_snapshot_valid(nightly_prices,check_in_date,check_out_date,base_amount));
COMMIT;
