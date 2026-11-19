-- Performance hardening. Catalog driven and idempotent.
-- auth_rls_initplan: a policy calling auth.uid() directly re-evaluates it for
-- every row. A scalar subquery makes it an InitPlan evaluated once per
-- statement. The sentinel round trip keeps repeated runs unchanged.
-- unindexed_foreign_keys: create a leading-column index for every FK lacking
-- one. Pure ASCII. No semicolons or parentheses inside comments or notices.

do $portrox$
declare
  pol record;
  fk record;
  q text;
  wc text;
  stmt text;
  cols text;
  idxname text;
  has_idx boolean;
  n_pol int := 0;
  n_idx int := 0;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ilike '%auth.uid()%' or coalesce(with_check, '') ilike '%auth.uid()%')
  loop
    q := pol.qual;
    wc := pol.with_check;
    if q is not null then
      q := regexp_replace(q, 'select[[:space:]]+auth\.uid\(\)', '__PXUID__', 'gi');
      q := regexp_replace(q, 'auth\.uid\(\)', '(select auth.uid())', 'gi');
      q := replace(q, '__PXUID__', 'select auth.uid()');
    end if;
    if wc is not null then
      wc := regexp_replace(wc, 'select[[:space:]]+auth\.uid\(\)', '__PXUID__', 'gi');
      wc := regexp_replace(wc, 'auth\.uid\(\)', '(select auth.uid())', 'gi');
      wc := replace(wc, '__PXUID__', 'select auth.uid()');
    end if;
    if q is distinct from pol.qual or wc is distinct from pol.with_check then
      stmt := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
      if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
      if wc is not null then stmt := stmt || ' with check (' || wc || ')'; end if;
      execute stmt;
      n_pol := n_pol + 1;
      raise notice 'initplan policy % on %', pol.policyname, pol.tablename;
    end if;
  end loop;

  for fk in
    select c.conrelid, c.conkey, rel.relname
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where c.contype = 'f' and ns.nspname = 'public'
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into cols
      from unnest(fk.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum;
    select exists (
      select 1 from pg_index i
      where i.indrelid = fk.conrelid
        and (i.indkey::smallint[])[0:array_length(fk.conkey,1)-1] = fk.conkey
    ) into has_idx;
    if has_idx then continue; end if;
    idxname := left('idx_' || fk.relname || '_' || replace(cols, ', ', '_') || '_fk', 60);
    execute format('create index if not exists %I on public.%I (%s)', idxname, fk.relname, cols);
    n_idx := n_idx + 1;
    raise notice 'fk index % on %', idxname, fk.relname;
  end loop;

  raise notice 'perf summary policies=% indexes=%', n_pol, n_idx;
end $portrox$;
