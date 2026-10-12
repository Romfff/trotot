BEGIN;
CREATE TABLE finance_debt_settlements (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),host_id UUID NOT NULL REFERENCES users(id),actor_id UUID NOT NULL REFERENCES users(id),
 cutoff TIMESTAMPTZ NOT NULL,reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 gross_eligible NUMERIC NOT NULL CHECK(gross_eligible>0 AND gross_eligible=trunc(gross_eligible) AND gross_eligible<1000000000000000000),
 debt_offset NUMERIC NOT NULL CHECK(debt_offset>=0 AND debt_offset=trunc(debt_offset)),
 net_payout NUMERIC NOT NULL CHECK(net_payout>=0 AND net_payout=trunc(net_payout)),
 batch_id UUID UNIQUE REFERENCES finance_payout_batches(id),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current()),
 CHECK(gross_eligible=debt_offset+net_payout),CHECK((net_payout=0 AND batch_id IS NULL) OR(net_payout>0 AND batch_id IS NOT NULL))
);
CREATE TABLE finance_debt_offsets (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),settlement_id UUID NOT NULL REFERENCES finance_debt_settlements(id),
 refund_id UUID NOT NULL REFERENCES finance_host_debts(refund_id),booking_id UUID NOT NULL REFERENCES bookings(id),
 journal_id UUID NOT NULL UNIQUE REFERENCES finance_journals(id),amount NUMERIC NOT NULL CHECK(amount>0 AND amount=trunc(amount) AND amount<1000000000000000000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current())
);
CREATE TABLE finance_debt_offset_reversals (
 offset_id UUID PRIMARY KEY REFERENCES finance_debt_offsets(id),journal_id UUID NOT NULL UNIQUE REFERENCES finance_journals(id),
 actor_id UUID NOT NULL REFERENCES users(id),reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),created_txid BIGINT NOT NULL DEFAULT txid_current() CHECK(created_txid=txid_current())
);
CREATE FUNCTION finance_debt_remaining(target UUID) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
 SELECT d.amount-coalesce((SELECT sum(o.amount) FROM finance_debt_offsets o WHERE o.refund_id=d.refund_id
   AND NOT EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.offset_id=o.id)),0) FROM finance_host_debts d WHERE d.refund_id=target;
$$;
CREATE FUNCTION finance_offset_journal_verified(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM finance_debt_offsets o WHERE o.journal_id=target)
  OR EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.journal_id=target);
$$;
CREATE FUNCTION finance_host_ledger_supported(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM finance_journals j WHERE j.id=target AND (j.kind='PAYMENT' OR finance_payout_journal_verified(j.id)
   OR finance_refund_journal_supported(j.id) OR finance_offset_journal_verified(j.id)));
$$;
CREATE FUNCTION finance_earning_valid(target UUID,host UUID,ignore_journal UUID DEFAULT NULL) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
  JOIN finance_journals j ON j.booking_id=b.id AND j.kind='PAYMENT'
  WHERE b.id=target AND p.host_id=host AND j.host_id=host AND b.payment_status IN('PAID','REFUNDED')
  AND (SELECT count(*) FROM finance_journals s WHERE s.booking_id=b.id AND s.kind='PAYMENT')=1
  AND NOT EXISTS(SELECT 1 FROM finance_journals s WHERE s.booking_id=b.id AND s.id IS DISTINCT FROM ignore_journal
    AND (s.host_id<>host OR NOT finance_host_ledger_supported(s.id)))
  AND EXISTS(SELECT 1 FROM finance_entries e WHERE e.journal_id=j.id GROUP BY e.journal_id HAVING
    bool_and((side='DEBIT' AND account='CASH_CLEARING') OR(side='CREDIT' AND account IN('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE')))
    AND coalesce(sum(amount) FILTER(WHERE side='DEBIT' AND account='CASH_CLEARING'),0)=b.total_amount
    AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='HOST_PAYABLE'),0)=b.host_payout_amount
    AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_COMMISSION'),0)=b.commission_amount
    AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='PLATFORM_SERVICE'),0)=b.service_fee
    AND coalesce(sum(amount) FILTER(WHERE side='CREDIT' AND account='TAX_PAYABLE'),0)=b.tax_amount));
$$;
CREATE FUNCTION finance_earning_balance(target UUID) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
 SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0) FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
  WHERE j.booking_id=target AND e.account='HOST_PAYABLE';
$$;
CREATE FUNCTION finance_settlement_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('bank:'||NEW.host_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE)
  OR NEW.cutoff>clock_timestamp() OR extract(isodow FROM NEW.cutoff AT TIME ZONE 'Asia/Ho_Chi_Minh')<>1
  OR (NEW.cutoff AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<>time '09:00:00'
  OR (NEW.batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_payout_batches b WHERE b.id=NEW.batch_id AND b.host_id=NEW.host_id
   AND b.status='DRAFT' AND b.created_txid=txid_current() AND b.cutoff=NEW.cutoff AND b.amount=NEW.net_payout)) THEN
  RAISE EXCEPTION 'Settlement requires active Admin weekly cutoff and exact batch' USING ERRCODE='23514';
 END IF;NEW.created_at=clock_timestamp();RETURN NEW;
END; $$;
CREATE TRIGGER finance_settlement_source BEFORE INSERT ON finance_debt_settlements FOR EACH ROW EXECUTE FUNCTION finance_settlement_source();
CREATE FUNCTION finance_offset_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s finance_debt_settlements%ROWTYPE; d finance_host_debts%ROWTYPE; j finance_journals%ROWTYPE; first_debt UUID; first_earning UUID; available NUMERIC; remaining NUMERIC;
BEGIN
 SELECT * INTO s FROM finance_debt_settlements WHERE id=NEW.settlement_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank:'||s.host_id::text,0));
 SELECT * INTO d FROM finance_host_debts WHERE refund_id=NEW.refund_id;
 SELECT * INTO j FROM finance_journals WHERE id=NEW.journal_id;
 PERFORM id FROM bookings WHERE id=NEW.booking_id FOR UPDATE;
 SELECT refund_id INTO first_debt FROM finance_host_debts WHERE host_id=s.host_id AND finance_debt_remaining(refund_id)>0 ORDER BY created_at,refund_id LIMIT 1;
 SELECT b.id INTO first_earning FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
  WHERE p.host_id=s.host_id AND finance_payout_hold_start(b.id)+interval '72 hours'<=s.cutoff
   AND NOT EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=b.id AND c.status='OPEN')
   AND NOT EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.booking_id=b.id AND i.status='ACTIVE')
   AND finance_earning_valid(b.id,s.host_id,NEW.journal_id)
   AND finance_earning_balance(b.id)+CASE WHEN b.id=NEW.booking_id THEN NEW.amount ELSE 0 END>0
  ORDER BY finance_payout_hold_start(b.id),b.id LIMIT 1;
 available=finance_earning_balance(NEW.booking_id)+NEW.amount;remaining=finance_debt_remaining(NEW.refund_id);
 IF s.created_txid<>txid_current() OR d.host_id IS DISTINCT FROM s.host_id OR j.host_id IS DISTINCT FROM s.host_id
  OR j.booking_id IS DISTINCT FROM NEW.booking_id OR j.kind IS DISTINCT FROM 'ADJUSTMENT' OR j.actor_id IS DISTINCT FROM s.actor_id
  OR j.reason IS DISTINCT FROM s.reason OR j.created_txid<>txid_current()
  OR first_debt IS DISTINCT FROM NEW.refund_id OR first_earning IS DISTINCT FROM NEW.booking_id
  OR remaining IS NULL OR available<=0 OR NEW.amount IS DISTINCT FROM least(remaining,available)
  OR (SELECT count(*) FROM finance_entries WHERE journal_id=j.id)<>2
  OR NOT EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=j.id AND account='HOST_PAYABLE' AND side='DEBIT' AND amount=NEW.amount)
  OR NOT EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=j.id AND account='HOST_DEBT' AND side='CREDIT' AND amount=NEW.amount) THEN
  RAISE EXCEPTION 'Offset requires same-Host FIFO capped funds and exact journal' USING ERRCODE='23514';
 END IF;NEW.created_at=clock_timestamp();RETURN NEW;
END; $$;
CREATE TRIGGER finance_offset_source BEFORE INSERT ON finance_debt_offsets FOR EACH ROW EXECUTE FUNCTION finance_offset_source();
CREATE FUNCTION finance_offset_reversal_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o finance_debt_offsets%ROWTYPE; s finance_debt_settlements%ROWTYPE; j finance_journals%ROWTYPE;
BEGIN
 SELECT * INTO o FROM finance_debt_offsets WHERE id=NEW.offset_id;SELECT * INTO s FROM finance_debt_settlements WHERE id=o.settlement_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank:'||s.host_id::text,0));
 SELECT * INTO j FROM finance_journals WHERE id=NEW.journal_id;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='ADMIN' AND status='ACTIVE' FOR SHARE)
  OR (s.batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_payout_batches WHERE id=s.batch_id AND status='CANCELLED'))
  OR j.host_id IS DISTINCT FROM s.host_id OR j.booking_id IS DISTINCT FROM o.booking_id OR j.kind IS DISTINCT FROM 'ADJUSTMENT'
  OR j.actor_id IS DISTINCT FROM NEW.actor_id OR j.reason IS DISTINCT FROM NEW.reason OR j.created_txid<>txid_current()
  OR (SELECT count(*) FROM finance_entries WHERE journal_id=j.id)<>2
  OR NOT EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=j.id AND account='HOST_DEBT' AND side='DEBIT' AND amount=o.amount)
  OR NOT EXISTS(SELECT 1 FROM finance_entries WHERE journal_id=j.id AND account='HOST_PAYABLE' AND side='CREDIT' AND amount=o.amount) THEN
  RAISE EXCEPTION 'Offset reversal requires same-Host evidence and untransferred settlement' USING ERRCODE='23514';
 END IF;NEW.created_at=clock_timestamp();RETURN NEW;
END; $$;
CREATE TRIGGER finance_offset_reversal_source BEFORE INSERT ON finance_debt_offset_reversals FOR EACH ROW EXECUTE FUNCTION finance_offset_reversal_source();
CREATE FUNCTION finance_settlement_committed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.debt_offset IS DISTINCT FROM (SELECT coalesce(sum(amount),0) FROM finance_debt_offsets WHERE settlement_id=NEW.id)
  OR (NEW.batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_payout_batches b WHERE b.id=NEW.batch_id AND b.amount=NEW.net_payout
    AND b.amount=(SELECT sum(i.amount) FROM finance_payout_items i WHERE i.batch_id=b.id))) THEN
  RAISE EXCEPTION 'Settlement must commit exact offsets and residual batch' USING ERRCODE='23514';
 END IF;RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER finance_settlement_committed AFTER INSERT ON finance_debt_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_settlement_committed();
DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['finance_debt_settlements','finance_debt_offsets','finance_debt_offset_reversals'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation()',t||'_append_only',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION finance_forbid_mutation()',t||'_no_truncate',t);
END LOOP;END; $$;
COMMIT;
