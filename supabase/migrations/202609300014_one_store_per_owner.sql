-- Merchant setup, billing and the admin dashboard all address one store per
-- account. Enforce that invariant even across tabs, retries and direct inserts.
-- NULL owners remain allowed for the showcase and retained deleted accounts.
-- Existing duplicates must be reviewed and resolved before applying this;
-- never choose or delete a merchant's store automatically in a migration.
alter table public.stores
  add constraint stores_owner_id_key unique (owner_id);
