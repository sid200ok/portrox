-- Visitor-supplied payment reference. WRITE-ONCE and never marks anything paid.
-- Only the admin (Management API) may set status paid/confirmed. The status
-- CHECK allows pending|paid|confirmed|cancelled - there is no 'verified' state,
-- so a reference leaves the row at 'pending'.
create or replace function public.portrox_payment_ref(p_appointment uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, portrox_private
as $fn$
declare
  a public.appointments%rowtype;
  v_ref text;
begin
  v_ref := btrim(coalesce(p_ref, ''));
  if length(v_ref) < 4 or length(v_ref) > 120 then
    return jsonb_build_object('ok', false, 'error', 'bad_reference_length');
  end if;
  if v_ref !~ '^[A-Za-z0-9 _./:#-]+$' then
    return jsonb_build_object('ok', false, 'error', 'bad_reference_chars');
  end if;

  select * into a from public.appointments where id = p_appointment;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_appointment');
  end if;
  if not exists (select 1 from public.sites s where s.id = a.site_id and s.is_published) then
    return jsonb_build_object('ok', false, 'error', 'site_not_published');
  end if;
  if a.payment_ref is not null then
    return jsonb_build_object('ok', false, 'error', 'reference_already_submitted');
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  update public.appointments set payment_ref = v_ref where id = a.id;
  -- status deliberately unchanged: a reference is a CLAIM, not a payment.
  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', 'pending');
end;
$fn$;

revoke all on function public.portrox_payment_ref(uuid, text) from public;
grant execute on function public.portrox_payment_ref(uuid, text) to anon, authenticated;
