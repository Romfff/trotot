-- Owner-approved G02/G03 per-room policy. Preserve prior migrations and existing units.
BEGIN;
ALTER TABLE homestay_units
  ADD COLUMN max_guests INT CHECK (max_guests >= 1),
  ADD COLUMN max_nights INT NOT NULL DEFAULT 90 CHECK (max_nights BETWEEN 1 AND 90),
  ADD COLUMN same_day_booking_cutoff TIME(0) NOT NULL DEFAULT '18:00:00'
    CHECK (same_day_booking_cutoff < TIME '24:00:00'),
  ADD COLUMN service_fee_rate NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (service_fee_rate BETWEEN 0 AND 100 AND service_fee_rate <> 'NaN'::numeric),
  ADD COLUMN tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate BETWEEN 0 AND 100 AND tax_rate <> 'NaN'::numeric),
  ADD COLUMN commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (commission_rate BETWEEN 8 AND 12 AND commission_rate <> 'NaN'::numeric);
COMMIT;
