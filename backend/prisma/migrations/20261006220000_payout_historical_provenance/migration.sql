BEGIN;
-- Historical proof is intentionally separate from present-day payment eligibility.
-- A bank change or later dispute must not erase the fact a transfer was recorded.
CREATE FUNCTION finance_payout_journal_verified(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM finance_journals j
  JOIN finance_payout_paid_items l ON l.journal_id=j.id
  JOIN finance_payout_items i ON i.id=l.item_id AND i.batch_id=l.batch_id
  JOIN finance_payout_batches b ON b.id=i.batch_id
  JOIN finance_payout_confirmations c ON c.batch_id=b.id
  WHERE j.id=target AND j.kind='PAYOUT' AND b.status='PAID' AND b.version=c.version_before+1
   AND j.host_id=b.host_id AND j.booking_id=i.booking_id AND j.actor_id=c.actor_id AND j.reason=c.reason
   AND j.created_txid=c.created_txid AND j.event_key='payout-paid:'||b.id::text||':'||i.id::text
   AND i.status='ACTIVE'
   AND EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=b.id AND e.action='CREATED')
   AND EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=b.id AND e.action='APPROVED' AND e.version_before=c.version_before-1)
   AND EXISTS(SELECT 1 FROM finance_payout_events e WHERE e.batch_id=b.id AND e.action='PAID' AND e.version_before=c.version_before AND e.actor_id=c.actor_id AND e.reason=c.reason AND e.created_txid=c.created_txid)
   AND (SELECT count(*) FROM finance_entries e WHERE e.journal_id=j.id)=2
   AND EXISTS(SELECT 1 FROM finance_entries e WHERE e.journal_id=j.id AND e.account='HOST_PAYABLE' AND e.side='DEBIT' AND e.amount=i.amount)
   AND EXISTS(SELECT 1 FROM finance_entries e WHERE e.journal_id=j.id AND e.account='CASH_CLEARING' AND e.side='CREDIT' AND e.amount=i.amount)
 )
$$;
CREATE OR REPLACE FUNCTION finance_payout_ready(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM finance_payout_batches b
  JOIN finance_bank_states s ON s.host_id=b.host_id
  JOIN finance_bank_accounts a ON a.id=s.account_id
  WHERE b.id=target AND b.status IN('DRAFT','APPROVED')
   AND a.status='VERIFIED' AND s.account_id=b.bank_account_id AND s.version=b.bank_version
   AND ROW(a.host_id,a.bank_code,a.account_number,a.account_name)=ROW(b.host_id,b.bank_code,b.account_number,b.account_name)
   AND EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE')
   AND b.amount=(SELECT sum(i.amount) FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE')
   AND (b.amount>=200000 OR b.cutoff>=(SELECT min(i.eligible_at)+interval '60 days' FROM finance_payout_items i WHERE i.batch_id=b.id AND i.status='ACTIVE'))
   AND NOT EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
     WHERE j.host_id=b.host_id AND (e.account='HOST_DEBT' OR (j.kind='ADJUSTMENT' OR (j.kind='PAYOUT' AND NOT finance_payout_journal_verified(j.id)))))
   AND NOT EXISTS(
    SELECT 1 FROM finance_payout_items i JOIN bookings k ON k.id=i.booking_id
    JOIN homestay_units u ON u.id=k.homestay_unit_id JOIN properties p ON p.id=u.property_id
    JOIN finance_journals j ON j.id=i.source_journal_id
    WHERE i.batch_id=b.id AND (
     i.status<>'ACTIVE' OR p.host_id<>b.host_id OR k.payment_status NOT IN('PAID','REFUNDED')
     OR j.booking_id IS DISTINCT FROM k.id OR j.host_id<>b.host_id OR j.kind<>'PAYMENT'
     OR (SELECT count(*) FROM finance_journals x WHERE x.booking_id=k.id AND x.kind='PAYMENT')<>1
     OR finance_payout_hold_start(k.id) IS NULL
     OR i.eligible_at IS DISTINCT FROM finance_payout_hold_start(k.id)+interval '72 hours' OR i.eligible_at>b.cutoff
     OR EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=k.id AND c.status='OPEN')
     OR i.amount IS DISTINCT FROM (SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0)
       FROM finance_entries e JOIN finance_journals x ON x.id=e.journal_id WHERE x.booking_id=k.id AND e.account='HOST_PAYABLE')
     OR EXISTS(SELECT 1 FROM finance_journals x WHERE x.booking_id=k.id AND (x.host_id<>b.host_id OR NOT(
      x.kind='PAYMENT' OR (x.kind='REFUND' AND (
       EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.booking_id=k.id AND c.reversal_journal_id=x.id)
       OR EXISTS(SELECT 1 FROM finance_refund_confirmations f JOIN finance_refunds r ON r.id=f.refund_id JOIN finance_cancellations c ON c.id=r.cancellation_id WHERE f.journal_id=x.id AND c.booking_id=k.id)
      ))
     )))
    )
   )
 )
$$;

COMMIT;

