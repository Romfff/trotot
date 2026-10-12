-- Explicit composite identity for Prisma's one-to-one ownership relation.
CREATE UNIQUE INDEX finance_bank_states_host_id_account_id_key
  ON finance_bank_states(host_id, account_id);
