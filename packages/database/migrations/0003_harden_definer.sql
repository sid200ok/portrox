-- Security hardening driven entirely by the live catalog.
-- Postgres grants EXECUTE to PUBLIC on every new function by default.
-- Three SECURITY DEFINER routines were therefore callable by visitors.
--   rls_auto_enable    event trigger helper that enables RLS
--   portrox_is_live    RLS policy internal, confirmed reachable HTTP 200
--   portrox_is_member  RLS policy internal, confirmed reachable HTTP 200
-- portrox_submit and portrox_book MUST stay anon executable because they are
-- the rate limited intake door. Their advisor lints are an ACCEPTED exception.
-- Comments here contain no semicolons and no double quotes, and the transport
-- strips comments anyway, because the endpoint splits statements naively.
-- Idempotent. A second run finds no public helpers and does nothing.

create schema if not exists portrox_private;
revoke all on schema portrox_private from public;
grant usage on schema portrox_private to anon, authenticated, service_role;
comment on schema portrox_private is
  'RLS policy internals. NOT exposed by PostgREST. Callable only inside policies.';

do $portrox$
declare
  f record;
  pol record;
  d text;
  q text;
  wc text;
  stmt text;
  pat text := '(public\.)?portrox_is_(live|member)[[:space:]]*\(';
  rep text := 'portrox_private.portrox_is_\2(';
  moved int := 0;
  repointed int := 0;
  skipped int := 0;
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
    order by p.proname
  loop
    begin
      d := pg_get_functiondef(f.oid);
    exception when others then
      skipped := skipped + 1;
      raise notice 'SKIP % % : %', f.proname, f.args, sqlerrm;
      continue;
    end;

    if f.proname in ('portrox_is_live', 'portrox_is_member') then
      execute regexp_replace(d, 'FUNCTION[[:space:]]+public\.', 'FUNCTION portrox_private.', 'i');
      execute format('revoke all on function portrox_private.%I(%s) from public, anon, authenticated', f.proname, f.args);
      execute format('grant execute on function portrox_private.%I(%s) to anon, authenticated, service_role', f.proname, f.args);
      moved := moved + 1;
      raise notice 'moved helper % % to portrox_private', f.proname, f.args;

    elsif d ~ pat then
      execute regexp_replace(d, pat, rep, 'g');
      repointed := repointed + 1;
      raise notice 'repointed body of % %', f.proname, f.args;

    elsif f.proname = 'rls_auto_enable' then
      execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
      execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
      raise notice 'revoked visitor EXECUTE on rls_auto_enable %', f.args;

    elsif f.proname in ('portrox_submit', 'portrox_book') then
      execute format('comment on function public.%I(%s) is %L', f.proname, f.args,
        'ACCEPTED anon and authenticated EXECUTE. Rate limited public intake. Direct table INSERT is denied. This RPC is the only door.');
      raise notice 'recorded accepted exception % %', f.proname, f.args;
    end if;
  end loop;

  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    q := pol.qual;
    wc := pol.with_check;
    if q is not null then q := regexp_replace(q, pat, rep, 'g'); end if;
    if wc is not null then wc := regexp_replace(wc, pat, rep, 'g'); end if;
    stmt := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if wc is not null then stmt := stmt || ' with check (' || wc || ')'; end if;
    execute stmt;
    raise notice 'repointed policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  end loop;

  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('portrox_is_live', 'portrox_is_member')
  loop
    execute format('drop function public.%I(%s)', f.proname, f.args);
    raise notice 'dropped exposed helper public.% %', f.proname, f.args;
  end loop;

  raise notice 'harden summary moved=% repointed=% skipped=%', moved, repointed, skipped;
end $portrox$;
