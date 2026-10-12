BEGIN;
-- Retain the immutable bank, item, audit and exact ledger proof. Registered
-- offsets are supported provenance, not an unverified manual adjustment.
CREATE OR REPLACE FUNCTION finance_payout_paid_proof(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT finance_payout_paid_proof_before_provenance(target)
  AND NOT EXISTS(SELECT 1 FROM finance_payout_paid_items l JOIN finance_journals j ON j.id=l.journal_id
   JOIN finance_payout_confirmations c ON c.batch_id=l.batch_id WHERE l.batch_id=target AND j.created_txid<>c.created_txid)
  AND NOT EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
   JOIN finance_payout_batches b ON b.host_id=j.host_id WHERE b.id=target
    AND ((e.account='HOST_DEBT' AND NOT finance_debt_journal_verified(j.id))
      OR (j.kind='ADJUSTMENT' AND NOT finance_offset_journal_verified(j.id))))
$$;
COMMIT;
