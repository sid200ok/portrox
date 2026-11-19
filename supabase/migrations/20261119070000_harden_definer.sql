-- Security hardening, driven entirely by the live catalog (no guessed names).
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default. That left
-- three SECURITY DEFINER functions callable by anonymous visitors:
--   * rls_auto_enable    — event-trigger helper that enables RLS. Never a visitor API.
--   * portrox_is_live    — RLS policy internal, exposed as /rest/v1/rpc/...
--   * portrox_is_member  — RLS policy internal; exposes a membership oracle.
--
-- portrox_submit / portrox_book MUST stay anon-executable: they are the
-- rate-limited intake door. Their advisor lints are an ACCEPTED exception.
--
-- Strategy: move the policy internals into a schema PostgREST does not expose,
-- repoint every function body and policy, then drop the public copies.
-- Idempotent: a second run finds nothing to move and does nothing.

create schema if not exists portrox_private;
revoke all on schema portrox_private from public;
grant usage on schema portrox_private to anon, authenticated, service_role;
comment on schema portrox_private is
  'RLS policy internals. NOT exposed by PostgREST. Callable only inside policies.';

do $$
declare
  f record;
  pol record;
  d text;
  q text;
  wc text;
  stmt text;
begin
  -- 1. Create private copies of the policy helpers.
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('portrox_is_live', 'portrox_is_member')
  loop
    d := pg_get_functiondef(f.oid);
    d := regexp_replace(d, 'FUNCTION\s+public\.', 'FUNCTION portrox_private.', 'i');
    execute d;
    execute format('revoke all on function portrox_private.%I(%s) from public, anon, authenticated', f.proname, f.args);
    -- EXECUTE is still required: policies evaluate as the querying role.
    execute format('grant execute on function portrox_private.%I(%s) to anon, authenticated, service_role', f.proname, f.args);
    raise notice 'moved helper % (%) to portrox_private', f.proname, f.args;
  end loop;

  -- 2. Repoint EVERY public function body that references the helpers
  --    (portrox_submit / portrox_book call them internally).
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_functiondef(p.oid) ~ '(public\.)?portrox_is_(live|member)\s*\('
  loop
    d := pg_get_functiondef(f.oid);
    d := regexp_replace(d, '(public\.)?portrox_is_(live|member)\s*\(', 'portrox_private.portrox_is_\2(', 'g');
    execute d;  -- CREATE OR REPLACE preserves the existing ACL
    raise notice 'repointed body of % (%)', f.proname, f.args;
  end loop;

  -- 3. Repoint every policy expression.
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ '(public\.)?portrox_is_(live|member)\s*\('
        or coalesce(with_check, '') ~ '(public\.)?portrox_is_(live|member)\s*\(')
  loop
    q := pol.qual;
    wc := pol.with_check;
    if q is not null then
      q := regexp_replace(q, '(public\.)?portrox_is_(live|member)\s*\(', 'portrox_private.portrox_is_\2(', 'g');
    end if;
    if wc is not null then
      wc := regexp_replace(wc, '(public\.)?portrox_is_(live|member)\s*\(', 'portrox_private.portrox_is_\2(', 'g');
    end if;
    stmt := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if wc is not null then stmt := stmt || ' with check (' || wc || ')'; end if;
    execute stmt;
    raise notice 'repointed policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  end loop;

  -- 4. Drop the exposed copies. NO CASCADE: if anything still depends on them
  --    the statement fails and the whole migration rolls back.
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('portrox_is_live', 'portrox_is_member')
  loop
    execute format('drop function public.%I(%s)', f.proname, f.args);
    raise notice 'dropped exposed helper public.% (%)', f.proname, f.args;
  end loop;

  -- 5. rls_auto_enable is an event-trigger helper. Event triggers fire as their
  --    owner, so revoking visitor EXECUTE cannot break them.
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
    raise notice 'revoked visitor EXECUTE on rls_auto_enable (%)', f.args;
  end loop;
end $$;

-- Accepted exceptions, recorded so the remaining advisor count is meaningful.
comment on function public.portrox_submit(text, text, text, text, text) is
  'ACCEPTED anon/authenticated EXECUTE: rate-limited public intake. Direct table INSERT is denied; this is the only door.';
