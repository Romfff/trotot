CREATE TABLE address_catalog_metadata (
  id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
  version varchar(80) NOT NULL,
  as_of date NOT NULL,
  source_url text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
