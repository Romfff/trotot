BEGIN;
CREATE TABLE finance_host_debts (
 refund_id UUID PRIMARY KEY REFERENCES finance_refunds(id) ON DELETE RESTRICT,
 paid_item_id UUID NOT NULL REFERENCES finance_payout_items(id) ON DELETE RESTRICT,
 host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 journal_id UUID NOT NULL UNIQUE REFERENCES finance_journals(id) ON DELETE RESTRICT,
 amount NUMERIC NOT NULL CHECK(amount>0 AND amount=trunc(amount) AND amount<10000000000000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current())
);
CREATE INDEX finance_host_debts_fifo ON finance_host_debts(host_id,created_at,refund_id);
CREATE FUNCTION finance_host_debt_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a finance_complaint_refunds%ROWTYPE; i finance_payout_items%ROWTYPE; f finance_refunds%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('bank:'||NEW.host_id::text,0));
 SELECT * INTO f FROM finance_refunds WHERE id=NEW.refund_id;
 SELECT * INTO a FROM finance_complaint_refunds WHERE complaint_id=f.complaint_id;
 SELECT * INTO i FROM finance_payout_items WHERE id=NEW.paid_item_id;
 IF a.booking_id IS DISTINCT FROM NEW.booking_id OR a.reversal_journal_id IS DISTINCT FROM NEW.journal_id
  OR a.host_reduction IS DISTINCT FROM NEW.amount OR a.created_txid<>txid_current()
  OR i.booking_id IS DISTINCT FROM NEW.booking_id OR i.status IS DISTINCT FROM 'ACTIVE'
  OR NOT EXISTS(SELECT 1 FROM finance_payout_batches b JOIN finance_payout_paid_items x ON x.item_id=i.id
    WHERE b.id=i.batch_id AND b.host_id=NEW.host_id AND b.status='PAID' AND finance_payout_journal_verified(x.journal_id))
  OR NEW.amount+coalesce((SELECT sum(amount) FROM finance_host_debts WHERE paid_item_id=i.id),0)>i.amount
  OR NOT EXISTS(SELECT 1 FROM finance_entries e WHERE e.journal_id=NEW.journal_id GROUP BY e.journal_id
    HAVING coalesce(sum(amount) FILTER(WHERE account='HOST_DEBT' AND side='DEBIT'),0)=NEW.amount
    AND coalesce(sum(amount) FILTER(WHERE account='HOST_PAYABLE'),0)=0)
  OR NOT EXISTS(SELECT 1 FROM finance_journals j JOIN finance_complaint_resolutions r ON r.complaint_id=a.complaint_id
    WHERE j.id=NEW.journal_id AND j.host_id=NEW.host_id AND j.actor_id=r.actor_id AND j.created_txid=txid_current()) THEN
  RAISE EXCEPTION 'Host debt requires unique refund and verified PAID allocation' USING ERRCODE='23514';
 END IF;
 NEW.created_at=clock_timestamp();RETURN NEW;
END; $$;
CREATE TRIGGER finance_host_debt_source BEFORE INSERT ON finance_host_debts FOR EACH ROW EXECUTE FUNCTION finance_host_debt_source();
CREATE TRIGGER finance_host_debts_append_only BEFORE UPDATE OR DELETE ON finance_host_debts FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
CREATE TRIGGER finance_host_debts_no_truncate BEFORE TRUNCATE ON finance_host_debts FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation();
CREATE FUNCTION finance_host_debt_committed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=NEW.reversal_journal_id AND account='HOST_DEBT')
  AND NOT EXISTS(SELECT 1 FROM finance_host_debts d JOIN finance_refunds f ON f.id=d.refund_id
    WHERE f.complaint_id=NEW.complaint_id AND d.journal_id=NEW.reversal_journal_id AND d.amount=NEW.host_reduction) THEN
  RAISE EXCEPTION 'Post-payout refund must commit with debt proof' USING ERRCODE='23514';
 END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_host_debt_committed AFTER INSERT ON finance_complaint_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_host_debt_committed();
COMMIT;
