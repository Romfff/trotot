-- Deferred: journal, confirmation and obligation status are written atomically in either order.
CREATE FUNCTION finance_refund_validate_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; r finance_refunds%ROWTYPE; c finance_refund_confirmations%ROWTYPE; booking UUID; paid_out NUMERIC; payable NUMERIC;
BEGIN
 IF TG_TABLE_NAME='finance_refunds' THEN target=NEW.id; ELSE target=NEW.refund_id; END IF;
 SELECT * INTO r FROM finance_refunds WHERE id=target;
 SELECT * INTO c FROM finance_refund_confirmations WHERE refund_id=target;
 IF r.status='PAID' OR c.id IS NOT NULL THEN
  IF r.status<>'PAID' OR c.id IS NULL OR c.amount<>r.amount THEN
   RAISE EXCEPTION 'Paid refund must have a matching immutable confirmation' USING ERRCODE='23514';
  END IF;
  SELECT booking_id INTO booking FROM finance_cancellations WHERE id=r.cancellation_id;
  SELECT COALESCE(sum(e.amount) FILTER(WHERE e.account='CASH_CLEARING' AND e.side='CREDIT'),0),
    COALESCE(sum(e.amount) FILTER(WHERE e.account='REFUND_PAYABLE' AND e.side='DEBIT'),0)
    INTO paid_out,payable FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
    WHERE j.id=c.journal_id AND j.kind='REFUND' AND j.booking_id=booking AND j.actor_id=c.actor_id;
  IF paid_out<>r.amount OR payable<>r.amount THEN
   RAISE EXCEPTION 'Refund confirmation must match its cash-return journal' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_refund_confirmation_status AFTER INSERT OR UPDATE ON finance_refunds
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_refund_validate_confirmation();
CREATE CONSTRAINT TRIGGER finance_refund_confirmation_source AFTER INSERT ON finance_refund_confirmations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_refund_validate_confirmation();
