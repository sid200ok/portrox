-- portrox_book creates appointments as 'confirmed' (free booking flow), so the
-- previous guard status<>'pending' rejected EVERY real booking. A reference is a
-- claim about money and is valid on any live booking; only cancelled is refused.
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
  if a.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'cancelled');
  end if;
  update public.appointments set payment_ref = v_ref where id = a.id;
  -- status deliberately unchanged: a reference is a CLAIM, not a payment.
  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', a.status);
end;
$fn$;
revoke all on function public.portrox_payment_ref(uuid, text) from public;
grant execute on function public.portrox_payment_ref(uuid, text) to anon, authenticated;
