-- Two defects in portrox_book:
-- 1. The past-slot check ran AFTER portrox_submit had already INSERTED a
--    submission, so every rejected past-slot attempt left an orphan row. That is
--    a cheap inbox-pollution and storage-growth vector. Validate BEFORE writing.
-- 2. status was hardcoded 'confirmed', so cfg.flags.paid_booking - which the
--    renderer prints as "Paid booking" - was cosmetic. Honour sites.flags.
create or replace function public.portrox_book(
  p_site text, p_full_name text, p_email text, p_message text,
  p_starts_at timestamptz, p_minutes integer DEFAULT 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, portrox_private
as $fn$
declare
  v_sub jsonb; v_sid uuid; v_aid uuid; v_paid boolean;
begin
  -- Validate FIRST. No row is written for an invalid slot.
  if p_starts_at is null or p_starts_at < now() then
    return jsonb_build_object('ok', false, 'error', 'past_slot');
  end if;

  select coalesce((s.flags->>'paid_booking')::boolean, false) into v_paid
  from public.sites s where s.id = p_site and s.is_published;
  if v_paid is null then
    return jsonb_build_object('ok', false, 'error', 'site_not_published');
  end if;

  v_sub := public.portrox_submit(p_site, 'booking', p_full_name, p_email, p_message,
                                 to_char(p_starts_at, 'YYYY-MM-DD HH24:MI'), null);
  if coalesce((v_sub->>'ok')::boolean, false) = false then return v_sub; end if;
  v_sid := nullif(v_sub->>'id', '')::uuid;
  if v_sid is null then return jsonb_build_object('ok', true, 'id', null); end if;

  begin
    insert into public.appointments (site_id, submission_id, starts_at, duration_minutes, status)
    values (p_site, v_sid, p_starts_at, greatest(5, least(240, p_minutes)),
            case when v_paid then 'pending' else 'confirmed' end)
    returning id into v_aid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end;

  return jsonb_build_object('ok', true, 'appointment_id', v_aid, 'submission_id', v_sid,
                           'status', case when v_paid then 'pending' else 'confirmed' end);
end;
$fn$;
revoke all on function public.portrox_book(text, text, text, text, timestamptz, integer) from public;
grant execute on function public.portrox_book(text, text, text, text, timestamptz, integer) to anon, authenticated;
