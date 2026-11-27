-- The intake limiter must not depend on anything the caller controls.
--
-- MEASURED, not assumed (scripts/audit-xff.mjs):
--   forged "203.0.113.7"               -> stored 203.0.113.7/32   (14 chars)
--   forged "198.51.100.9"              -> stored 198.51.100.9/32  (15 chars)
--   forged "203.0.113.7, 198.51.100.9" -> stored 203.0.113.7/32   (same as case 1)
-- The stored address is a pure function of the client-supplied FIRST hop, so
-- "email OR ip" was bypassable by rotating both. That is unbounded unauthenticated
-- inserts: inbox flooding and storage exhaustion.
--
-- NEW MODEL, three ceilings, none of them header-derived:
--   per email : 5 per hour        (unchanged threshold, the original intent)
--   per site  : 40 per hour       (stops email rotation)
--   per site  : 200 per 24 hours  (stops slow rotation)
-- The IP is still recorded, from the LAST hop, for forensics ONLY. It is explicitly
-- untrusted and is never used in a limit. All three ceilings count LIVE rows, so
-- deleting probes resets them - which is why the gates can use the real door.
--
-- Validation, honeypot behaviour, error names and the INSERT column list are
-- preserved exactly as they were.

create or replace function public.portrox_submit(
  p_site text, p_kind text, p_full_name text, p_email text, p_message text,
  p_slot text default null, p_honeypot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, portrox_private
as $fn$
declare
  v_ip inet; v_id uuid; v_xff text; v_parts text[];
  v_email_recent int; v_site_hour int; v_site_day int;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then
    return jsonb_build_object('ok', true, 'id', null);
  end if;
  if not exists (select 1 from public.sites where id = p_site and is_published) then
    return jsonb_build_object('ok', false, 'error', 'unknown_site');
  end if;
  if p_kind not in ('contact','booking') then return jsonb_build_object('ok',false,'error','bad_kind'); end if;
  if p_full_name is null or btrim(p_full_name)='' or char_length(p_full_name)>120 then
    return jsonb_build_object('ok',false,'error','invalid_name'); end if;
  if p_email is null or char_length(p_email)>254 or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    return jsonb_build_object('ok',false,'error','invalid_email'); end if;
  if p_message is null or btrim(p_message)='' or char_length(p_message)>5000 then
    return jsonb_build_object('ok',false,'error','invalid_message'); end if;

  -- Forensics only. The LAST hop is the nearest trusted proxy in the append model
  -- and the only entry in the rewrite model. Either way it is NOT a security input.
  v_ip := null;
  begin
    v_xff := nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-forwarded-for';
    if v_xff is not null then
      v_parts := string_to_array(v_xff, ',');
      v_ip := btrim(v_parts[array_length(v_parts, 1)])::inet;
    end if;
  exception when others then v_ip := null; end;

  -- Ceiling 1: per email, per hour. No header involved.
  select count(*) into v_email_recent from public.submissions
   where site_id = p_site and created_at > now() - interval '1 hour'
     and lower(email) = lower(btrim(p_email));
  if v_email_recent >= 5 then
    return jsonb_build_object('ok',false,'error','rate_limited');
  end if;

  -- Ceiling 2: per site, per hour. Rotating emails cannot escape this.
  select count(*) into v_site_hour from public.submissions
   where site_id = p_site and created_at > now() - interval '1 hour';
  if v_site_hour >= 40 then
    return jsonb_build_object('ok',false,'error','site_busy');
  end if;

  -- Ceiling 3: per site, per day. Rotating slowly cannot escape this either.
  select count(*) into v_site_day from public.submissions
   where site_id = p_site and created_at > now() - interval '24 hours';
  if v_site_day >= 200 then
    return jsonb_build_object('ok',false,'error','site_busy');
  end if;

  insert into public.submissions (site_id, kind, full_name, email, message, slot, ip, honeypot)
  values (p_site, p_kind, btrim(p_full_name), lower(btrim(p_email)), btrim(p_message),
          nullif(btrim(coalesce(p_slot,'')),''), v_ip, null)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

revoke all on function public.portrox_submit(text, text, text, text, text, text, text) from public;
grant execute on function public.portrox_submit(text, text, text, text, text, text, text) to anon, authenticated;
