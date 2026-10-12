-- S5 backup/restore regression: transaction identity is a one-time insertion check,
-- not an immutable property of a stored row. Keep historical txids byte-for-byte.
-- pg_dump restores data before triggers. No application/session trigger bypass.
BEGIN;
CREATE FUNCTION finance_validate_creation_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_txid IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION 'Financial proof must be created in the current transaction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

DO $$
DECLARE relation_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'finance_journals','finance_complaint_resolutions','finance_complaint_refunds',
    'finance_host_debts','finance_debt_settlements','finance_debt_offsets',
    'finance_debt_offset_reversals','finance_admin_late_cases'
  ] LOOP
    -- Exact known volatile CHECK only; all balance, amount, FK, uniqueness,
    -- append-only and same-transaction source guards are retained.
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',relation_name,relation_name||'_created_txid_check');
    EXECUTE format('CREATE TRIGGER finance_creation_transaction BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION finance_validate_creation_transaction()',relation_name);
  END LOOP;
END; $$;
COMMIT;
