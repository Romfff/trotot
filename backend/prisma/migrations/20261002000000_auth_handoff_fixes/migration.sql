BEGIN;
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;

-- Abort on duplicate identities. Never merge/delete accounts automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
    GROUP BY regexp_replace(regexp_replace(btrim(phone), '[[:space:]().-]', '', 'g'),
      '^(\+84|0084|84)([1-9][0-9]{8})$', '0\2')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phone normalization collision: resolve duplicate accounts before retrying this migration';
  END IF;
END $$;

UPDATE users SET phone = regexp_replace(regexp_replace(btrim(phone), '[[:space:]().-]', '', 'g'),
  '^(\+84|0084|84)([1-9][0-9]{8})$', '0\2');
ALTER TABLE users ADD CONSTRAINT users_phone_canonical CHECK (
  phone = regexp_replace(regexp_replace(btrim(phone), '[[:space:]().-]', '', 'g'),
    '^(\+84|0084|84)([1-9][0-9]{8})$', '0\2')
);
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
COMMIT;
