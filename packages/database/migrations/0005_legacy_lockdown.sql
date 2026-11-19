-- Closes a real, open write path and a slot-leak bug. Catalog driven, idempotent.
--
-- Evidence from has_table_privilege:
--   contact_messages  anon SELECT + anon INSERT + authenticated INSERT
--   legacy_projects   anon SELECT + anon INSERT
-- These came from the sample site's old migrations. verify-rpc only ever tested
-- submissions, so the hole was invisible. Anyone could insert unlimited rows
-- into contact_messages, bypassing the rate limited intake RPC entirely, and
-- possibly READ submitted messages. Neither table is used by Portrox.
-- Revoking grants denies access regardless of any permissive policy, and is
-- reversible. Data is preserved and already backed up.
--
-- Second bug: deleting a submission left its appointment behind with a dangling
-- submission_id, permanently blocking that slot. The FK is now ON DELETE CASCADE
-- and existing orphans are removed.
--
-- Pure ASCII. No semicolons or parentheses inside comments or notices.

do $portrox$
declare
  t text;
  fk record;
  n_orphan int := 0;
  n_revoked int := 0;
begin
  -- 1. Revoke every grant on the unused legacy tables.
  foreach t in array array['contact_messages', 'legacy_projects'] loop
    if exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
               where ns.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      execute format('revoke all on table public.%I from anon, authenticated, public', t);
      n_revoked := n_revoked + 1;
      raise notice 'revoked all grants on %', t;
    end if;
  end loop;

  -- 2. Remove appointments whose submission no longer exists.
  with gone as (
    delete from public.appointments a
    where a.submission_id is null
       or not exists (select 1 from public.submissions s where s.id = a.submission_id)
    returning 1
  )
  select count(*) into n_orphan from gone;
  raise notice 'removed orphan appointments %', n_orphan;

  -- 3. Rebuild the submissions FK with ON DELETE CASCADE so a deleted lead
  --    frees its slot instead of blocking it forever.
  for fk in
    select c.conname, c.confdelete_type_placeholder
    from (select conname, confdeltype as confdelete_type_placeholder
          from pg_constraint
          where conrelid = 'public.appointments'::regclass and contype = 'f') c
  loop
    if fk.confdelete_type_placeholder <> 'c' then
      execute format('alter table public.appointments drop constraint %I', fk.conname);
      execute format('alter table public.appointments add constraint %I foreign key (submission_id) references public.submissions(id) on delete cascade', fk.conname);
      raise notice 'cascaded FK %', fk.conname;
    else
      raise notice 'FK % already cascades', fk.conname;
    end if;
  end loop;

  raise notice 'lockdown summary revoked=% orphans_removed=%', n_revoked, n_orphan;
end $portrox$;
