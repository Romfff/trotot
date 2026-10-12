BEGIN;
CREATE FUNCTION finance_mixed_settlement_review(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM finance_debt_offsets o WHERE o.booking_id=target
   AND NOT EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.offset_id=o.id))
  AND EXISTS(SELECT 1 FROM finance_payout_items i JOIN finance_payout_batches b ON b.id=i.batch_id
   JOIN finance_payout_paid_items p ON p.item_id=i.id WHERE i.booking_id=target AND i.status='ACTIVE'
    AND b.status='PAID' AND finance_payout_journal_verified(p.journal_id))
$$;
CREATE FUNCTION finance_mixed_review_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='RESOLVED' AND OLD.status='OPEN' AND finance_mixed_settlement_review(OLD.booking_id) THEN
  RAISE EXCEPTION 'Mixed offset and paid source requires a separately approved resolution contract' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finance_mixed_review_lock BEFORE UPDATE ON finance_complaints FOR EACH ROW EXECUTE FUNCTION finance_mixed_review_lock();
COMMIT;
