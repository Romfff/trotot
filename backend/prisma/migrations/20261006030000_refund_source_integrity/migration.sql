-- Additive hardening after obligation foundation has been applied in integration DBs.
CREATE FUNCTION finance_refund_validate_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_amount NUMERIC;
BEGIN
 SELECT refund_amount INTO source_amount FROM finance_cancellations WHERE id=NEW.cancellation_id FOR SHARE;
 IF source_amount IS DISTINCT FROM NEW.amount THEN
  RAISE EXCEPTION 'Refund obligation must match cancellation amount' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finance_refund_validate_source BEFORE INSERT ON finance_refunds
 FOR EACH ROW EXECUTE FUNCTION finance_refund_validate_source();
