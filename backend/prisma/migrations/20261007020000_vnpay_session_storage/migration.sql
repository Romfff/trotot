BEGIN;
CREATE TABLE payment_sessions (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 provider VARCHAR(20) NOT NULL CHECK(provider='VNPAY_SANDBOX'),
 booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 guest_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 booking_version INT NOT NULL CHECK(booking_version>=1),
 merchant_code VARCHAR(8) NOT NULL CHECK(merchant_code ~ '^[A-Za-z0-9]{8}$'),
 transaction_ref VARCHAR(32) NOT NULL UNIQUE,
 amount_vnd NUMERIC NOT NULL CHECK(amount_vnd>0 AND amount_vnd=trunc(amount_vnd) AND amount_vnd<=9999999999),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(booking_id,provider)
);
CREATE FUNCTION payment_session_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings%ROWTYPE; owner UUID; unit UUID;
BEGIN
 SELECT homestay_unit_id INTO unit FROM bookings WHERE id=NEW.booking_id;
 IF unit IS NULL THEN RAISE EXCEPTION 'Payment session booking missing' USING ERRCODE='23514'; END IF;
 PERFORM id FROM homestay_units WHERE id=unit FOR UPDATE;
 SELECT * INTO b FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 SELECT p.host_id INTO owner FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE u.id=unit;
 IF b.guest_id IS DISTINCT FROM NEW.guest_id OR b.guest_id=owner
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.guest_id AND status='ACTIVE' AND role IN('TENANT','HOST') FOR SHARE)
  OR b.booking_status<>'PENDING_PAYMENT' OR b.payment_status<>'PENDING'
  OR b.version<>NEW.booking_version OR b.total_amount IS DISTINCT FROM NEW.amount_vnd
  OR b.expires_at IS DISTINCT FROM NEW.expires_at OR b.expires_at<=clock_timestamp()
  OR NEW.transaction_ref<>replace(NEW.id::text,'-','') THEN
   RAISE EXCEPTION 'Payment session requires current own unpaid booking snapshot' USING ERRCODE='23514';
 END IF;
 NEW.created_at=clock_timestamp();
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_sessions_insert_guard BEFORE INSERT ON payment_sessions FOR EACH ROW EXECUTE FUNCTION payment_session_insert_guard();
CREATE TRIGGER payment_sessions_append_only BEFORE UPDATE OR DELETE ON payment_sessions FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER payment_sessions_no_truncate BEFORE TRUNCATE ON payment_sessions FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
COMMIT;
