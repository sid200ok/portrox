-- Availability enforcement, overlap guard, server-owned duration, honest clock.
--
-- REWRITE NOTE: the first version of this file used a GiST EXCLUDE constraint on
-- tstzrange(starts_at, starts_at + make_interval(...)). Postgres refused it with
-- 42P17: timestamptz + interval is STABLE, not IMMUTABLE, because interval
-- arithmetic on a timestamptz depends on the session TimeZone. Index expressions
-- must be IMMUTABLE. The version was NEVER recorded, so rewriting is legitimate.
-- Overlap is now a BEFORE trigger under an advisory lock: no immutability
-- requirement, no extension dependency, identical on vanilla Postgres.
--
-- Five defects, all read from 20261126030000_book_validate_first.sql:
--   1. weekly windows were RENDERED but never checked. The DB audit's own probe
--      booked 2027-05-16T09:00Z = Sunday 14:30 Asia/Kolkata and it was ACCEPTED.
--   2. appt_slot_unique is UNIQUE(site_id, starts_at) WHERE status IN
--      ('paid','confirmed'): overlapping ranges with distinct starts_at both
--      passed, and a 'pending' booking held nothing at all.
--   3. duration was CLAMPED by greatest(5, least(240, p_minutes)), so a visitor
--      could take a four-hour slot and the reply never reported it.
--   4. to_char(p_starts_at, ...) rendered in the DATABASE session timezone (UTC),
--      so the inbox showed a wall clock 5:30 away from the visitor's pick.
--   5. the slot_taken path returned ok:false AFTER portrox_submit had inserted a
--      submission - the same orphan defect 0011 fixed for past_slot.
--
-- Rules live in public.availability, synced from sites/<id>/data/availability.json
-- by scripts/sync-availability.mjs. No row => FAIL CLOSED.

create schema if not exists portrox_private;

-- 1. Overlap guard. Serialized per site so two concurrent inserts cannot both
--    pass the check. Raises 23P01, which portrox_book already handles.
create or replace function portrox_private.portrox_appt_guard()
returns trigger
language plpgsql
security definer
set search_path = public, portrox_private
as $fn$
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('portrox_appt:' || new.site_id)::bigint);

  -- half-open overlap: [s1,e1) intersects [s2,e2) iff s1 < e2 and s2 < e1
  if exists (
    select 1 from public.appointments a
    where a.site_id = new.site_id
      and a.id <> new.id
      and a.status <> 'cancelled'
      and a.starts_at < new.starts_at + make_interval(mins => new.duration_minutes)
      and new.starts_at < a.starts_at + make_interval(mins => a.duration_minutes)
  ) then
    raise exception 'overlapping appointment for site %', new.site_id
      using errcode = '23P01';
  end if;

  return new;
end;
$fn$;

-- A trigger function does not need EXECUTE granted to the writing role, so
-- revoke it: otherwise Postgres' default PUBLIC grant makes it an anon-callable
-- SECURITY DEFINER routine and the security advisor rightly flags it.
revoke all on function portrox_private.portrox_appt_guard() from public, anon, authenticated;

drop trigger if exists portrox_appt_guard on public.appointments;
create trigger portrox_appt_guard
  before insert or update of starts_at, duration_minutes, status, site_id
  on public.appointments
  for each row execute function portrox_private.portrox_appt_guard();

-- 2. The intake door, with every validation before any write.
create or replace function public.portrox_book(
  p_site text, p_full_name text, p_email text, p_message text,
  p_starts_at timestamptz, p_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, portrox_private
as $fn$
declare
  v_sub jsonb; v_sid uuid; v_aid uuid; v_paid boolean;
  v_tz text; v_dur integer; v_weekly jsonb;
  v_local timestamp; v_dow integer; v_day text;
  v_min integer; v_end integer; v_from integer; v_to integer;
  v_rule jsonb; v_fit boolean := false; v_in_window boolean := false;
  v_status text; v_hold integer; v_slot_txt text;
begin
  -- past slot: still first, still writes nothing
  if p_starts_at is null or p_starts_at < now() then
    return jsonb_build_object('ok', false, 'error', 'past_slot');
  end if;

  select coalesce((s.flags->>'paid_booking')::boolean, false) into v_paid
  from public.sites s where s.id = p_site and s.is_published;
  if v_paid is null then
    return jsonb_build_object('ok', false, 'error', 'site_not_published');
  end if;

  -- rules must exist: a site that never synced cannot take bookings
  select a.timezone, a.duration_minutes, a.weekly into v_tz, v_dur, v_weekly
  from public.availability a where a.site_id = p_site;
  if v_tz is null or v_dur is null then
    return jsonb_build_object('ok', false, 'error', 'availability_not_configured');
  end if;
  if jsonb_typeof(v_weekly) <> 'array' or jsonb_array_length(v_weekly) = 0 then
    return jsonb_build_object('ok', false, 'error', 'availability_no_rules');
  end if;

  begin
    v_local := p_starts_at at time zone v_tz;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'availability_bad_timezone');
  end;

  -- duration is SERVER-owned, never clamped
  if p_minutes is distinct from v_dur then
    return jsonb_build_object('ok', false, 'error', 'bad_duration', 'expected_minutes', v_dur);
  end if;

  if extract(second from v_local) <> 0 then
    return jsonb_build_object('ok', false, 'error', 'off_grid');
  end if;

  v_dow := extract(dow from v_local)::integer;
  v_day := case v_dow when 0 then 'sun' when 1 then 'mon' when 2 then 'tue'
                      when 3 then 'wed' when 4 then 'thu' when 5 then 'fri'
                      else 'sat' end;
  v_min := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_end := v_min + v_dur;

  for v_rule in select value from jsonb_array_elements(v_weekly) loop
    if lower(left(coalesce(v_rule->>'day', ''), 3)) <> v_day then continue; end if;
    if coalesce(v_rule->>'from', '') !~ '^[0-9]{1,2}:[0-9]{2}$'
       or coalesce(v_rule->>'to', '') !~ '^[0-9]{1,2}:[0-9]{2}$' then
      return jsonb_build_object('ok', false, 'error', 'availability_bad_rule');
    end if;
    v_from := split_part(v_rule->>'from', ':', 1)::integer * 60
            + split_part(v_rule->>'from', ':', 2)::integer;
    v_to   := split_part(v_rule->>'to', ':', 1)::integer * 60
            + split_part(v_rule->>'to', ':', 2)::integer;
    if v_to <= v_from or v_from > 1439 or v_to > 1440 then
      return jsonb_build_object('ok', false, 'error', 'availability_bad_rule');
    end if;
    if v_min >= v_from and v_min < v_to then
      v_in_window := true;
      if v_end <= v_to and ((v_min - v_from) % v_dur) = 0 then
        v_fit := true;
        exit;
      end if;
    end if;
  end loop;

  if not v_fit then
    return jsonb_build_object('ok', false,
      'error', case when v_in_window then 'off_grid' else 'outside_availability' end,
      'timezone', v_tz, 'local', to_char(v_local, 'YYYY-MM-DD HH24:MI'));
  end if;

  -- overlap: pending holds a slot too, cancelled does not
  if exists (
    select 1 from public.appointments a
    where a.site_id = p_site
      and a.status in ('pending', 'paid', 'confirmed')
      and a.starts_at < p_starts_at + make_interval(mins => v_dur)
      and p_starts_at < a.starts_at + make_interval(mins => a.duration_minutes)
  ) then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end if;

  -- an unpaid requester must not be able to freeze the calendar
  select count(*) into v_hold
  from public.appointments a
  join public.submissions s on s.id = a.submission_id
  where a.site_id = p_site and a.status = 'pending'
    and lower(btrim(s.email)) = lower(btrim(coalesce(p_email, '')));
  if v_hold >= 3 then
    return jsonb_build_object('ok', false, 'error', 'too_many_pending');
  end if;

  v_status   := case when v_paid then 'pending' else 'confirmed' end;
  -- the inbox must read the VISITOR's wall clock, not the DB session's UTC
  v_slot_txt := to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz;

  v_sub := public.portrox_submit(p_site, 'booking', p_full_name, p_email, p_message,
                                 v_slot_txt, null);
  if coalesce((v_sub->>'ok')::boolean, false) = false then return v_sub; end if;
  v_sid := nullif(v_sub->>'id', '')::uuid;
  if v_sid is null then return jsonb_build_object('ok', true, 'id', null); end if;

  begin
    insert into public.appointments (site_id, submission_id, starts_at, duration_minutes, status)
    values (p_site, v_sid, p_starts_at, v_dur, v_status)
    returning id into v_aid;
  exception when unique_violation or exclusion_violation then
    -- the loser of the race must not leave an orphan submission behind
    delete from public.submissions where id = v_sid;
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'appointment_id', v_aid, 'submission_id', v_sid,
                            'status', v_status, 'duration_minutes', v_dur,
                            'starts_at', p_starts_at, 'local', v_slot_txt);
end;
$fn$;

revoke all on function public.portrox_book(text, text, text, text, timestamptz, integer) from public;
grant execute on function public.portrox_book(text, text, text, text, timestamptz, integer) to anon, authenticated;
