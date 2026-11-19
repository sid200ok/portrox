-- Defence in depth. contact_messages and legacy_projects already have NO grants
-- for anon or authenticated, so their policies are unreachable. But two of them
-- are wide open: contact_messages_anon_insert with_check true, and
-- "Allow authenticated users full access" ALL qual true with_check true.
-- If anyone ever re-grants on those tables, the hole returns instantly.
-- Dropping the policies removes the latent risk. Data is untouched and backed up.
-- Catalog driven and idempotent. Pure ASCII.

do $portrox$
declare
  p record;
  n int := 0;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('contact_messages', 'legacy_projects')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    n := n + 1;
    raise notice 'dropped dormant policy % on %', p.policyname, p.tablename;
  end loop;
  raise notice 'legacy policies dropped %', n;
end $portrox$;
