-- Portrox multi-tenant schema — SUPABASE ONLY. Uses core gen_random_uuid() (PG13+).
-- Requires auth.users / auth.uid() / service_role. NOT vanilla-Postgres compatible.
-- Idempotent: safe to re-run.

create or replace function public.portrox_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$ begin new.updated_at := now(); return new; end $$;

create table if not exists public.sites (
  id           text primary key,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  is_published boolean not null default false,
  pages_mode   text not null default 'project' check (pages_mode in ('user','project','org','custom')),
  repo         text,
  base_path    text not null default '',
  cname        text,
  seo          jsonb not null default '{}'::jsonb,
  nav          jsonb not null default '{"services":true,"appointments":true,"about":true,"client_auth":false}'::jsonb,
  flags        jsonb not null default '{"available_for_hire":true,"paid_booking":false,"auto_email":false}'::jsonb,
  theme        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.sites add column if not exists is_published boolean not null default false;
drop trigger if exists sites_touch on public.sites;
create trigger sites_touch before update on public.sites for each row execute function public.portrox_touch();

create table if not exists public.site_members (
  site_id text not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role    text not null default 'owner' check (role in ('owner','editor','viewer')),
  primary key (site_id, user_id)
);

create or replace function public.portrox_is_member(p_site text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from public.site_members m where m.site_id = p_site and m.user_id = auth.uid());
$$;
create or replace function public.portrox_is_live(p_site text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from public.sites s where s.id = p_site and s.is_published);
$$;
revoke all on function public.portrox_is_member(text), public.portrox_is_live(text) from public;
grant execute on function public.portrox_is_member(text), public.portrox_is_live(text) to anon, authenticated;

create table if not exists public.profiles (
  site_id text primary key references public.sites(id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  headline text, location text, hourly_rate text, avatar_path text,
  overview_md text, skills jsonb not null default '[]'::jsonb, links jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.portrox_touch();

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  kind text not null check (kind in ('avatar','cover','background','attachment')),
  storage_path text not null, is_active boolean not null default false, alt text,
  created_at timestamptz not null default now()
);
create index if not exists media_site_kind_idx on public.media(site_id, kind);

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  role text not null, org text, period text, location text, summary text,
  stack jsonb not null default '[]'::jsonb, sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists exp_site_idx on public.experiences(site_id, sort_order);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  title text not null, summary text, url text,
  stack jsonb not null default '[]'::jsonb, is_public boolean not null default true,
  sort_order int not null default 0, created_at timestamptz not null default now()
);
create index if not exists proj_site_idx on public.projects(site_id, sort_order);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  title text not null, description text, price text, currency text default 'USD',
  deliverables jsonb not null default '[]'::jsonb, payment_url text,
  is_active boolean not null default true, sort_order int not null default 0
);

create table if not exists public.availability (
  site_id text primary key references public.sites(id) on delete cascade,
  timezone text not null default 'UTC',
  duration_minutes int not null default 30 check (duration_minutes between 5 and 240),
  weekly jsonb not null default '[]'::jsonb, paid_booking boolean not null default false
);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  form_kind text not null check (form_kind in ('contact','booking')),
  label text not null,
  field_type text not null check (field_type in ('text','email','textarea','select','checkbox','number')),
  options jsonb not null default '[]'::jsonb, required boolean not null default false,
  sort_order int not null default 0
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  kind text not null default 'contact' check (kind in ('contact','booking')),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  message text not null check (char_length(btrim(message)) between 1 and 5000),
  slot text check (slot is null or char_length(slot) <= 80),
  extra jsonb not null default '{}'::jsonb, honeypot text, ip inet, user_agent text,
  is_read boolean not null default false, archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sub_site_created_idx on public.submissions(site_id, created_at desc);
create index if not exists sub_email_idx on public.submissions(lower(email));
create index if not exists sub_ip_idx on public.submissions(ip, created_at desc);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  starts_at timestamptz not null, duration_minutes int not null default 30,
  status text not null default 'pending' check (status in ('pending','paid','confirmed','cancelled')),
  payment_ref text, created_at timestamptz not null default now()
);
create unique index if not exists appt_slot_unique
  on public.appointments(site_id, starts_at) where status in ('paid','confirmed');

create table if not exists public.system_pages (
  slug text primary key, title text not null, body_md text not null,
  is_locked boolean not null default true, updated_at timestamptz not null default now()
);

alter table public.sites          enable row level security;
alter table public.site_members   enable row level security;
alter table public.profiles       enable row level security;
alter table public.media          enable row level security;
alter table public.experiences    enable row level security;
alter table public.projects       enable row level security;
alter table public.services       enable row level security;
alter table public.availability   enable row level security;
alter table public.form_fields    enable row level security;
alter table public.submissions    enable row level security;
alter table public.appointments   enable row level security;
alter table public.system_pages   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sites','site_members','profiles','media','experiences','projects',
                           'services','availability','form_fields','submissions','appointments','system_pages']
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on public.sites, public.profiles, public.media, public.experiences,
  public.projects, public.services, public.availability, public.form_fields, public.system_pages
  to anon, authenticated;
-- NO direct INSERT for anon: the RPC is the only write door (rate-limit cannot be bypassed).
grant select, update, delete on public.submissions to authenticated;
grant insert on public.submissions to authenticated;
grant insert, update, delete on public.sites, public.profiles, public.media,
  public.experiences, public.projects, public.services, public.availability,
  public.form_fields, public.appointments to authenticated;
grant select, insert, update, delete on public.site_members to authenticated;
grant all on all tables in schema public to service_role;

-- Public reads are gated on is_published AND tenant membership. No cross-tenant leak.
drop policy if exists sites_public_read on public.sites;
create policy sites_public_read on public.sites for select to anon, authenticated
  using (is_published or owner_id = auth.uid() or public.portrox_is_member(id));
drop policy if exists sites_owner_write on public.sites;
create policy sites_owner_write on public.sites for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists members_self_read on public.site_members;
create policy members_self_read on public.site_members for select to authenticated
  using (user_id = auth.uid() or public.portrox_is_member(site_id));
drop policy if exists members_owner_write on public.site_members;
create policy members_owner_write on public.site_members for all to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['profiles','media','experiences','services','availability','form_fields']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated
      using (public.portrox_is_live(site_id) or public.portrox_is_member(site_id))', t || '_public_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_write', t);
    execute format('create policy %I on public.%I for all to authenticated
      using (public.portrox_is_member(site_id)) with check (public.portrox_is_member(site_id))', t || '_member_write', t);
  end loop;
end $$;

drop policy if exists projects_public_read on public.projects;
create policy projects_public_read on public.projects for select to anon, authenticated
  using ((is_public and public.portrox_is_live(site_id)) or public.portrox_is_member(site_id));
drop policy if exists projects_member_write on public.projects;
create policy projects_member_write on public.projects for all to authenticated
  using (public.portrox_is_member(site_id)) with check (public.portrox_is_member(site_id));

drop policy if exists sub_anon_insert on public.submissions;   -- removed: RPC-only
drop policy if exists sub_member_insert on public.submissions;
create policy sub_member_insert on public.submissions for insert to authenticated
  with check (public.portrox_is_member(site_id));
drop policy if exists sub_member_read on public.submissions;
create policy sub_member_read on public.submissions for select to authenticated
  using (public.portrox_is_member(site_id));
drop policy if exists sub_member_update on public.submissions;
create policy sub_member_update on public.submissions for update to authenticated
  using (public.portrox_is_member(site_id)) with check (public.portrox_is_member(site_id));
drop policy if exists sub_member_delete on public.submissions;
create policy sub_member_delete on public.submissions for delete to authenticated
  using (public.portrox_is_member(site_id));

drop policy if exists appt_member_all on public.appointments;
create policy appt_member_all on public.appointments for all to authenticated
  using (public.portrox_is_member(site_id)) with check (public.portrox_is_member(site_id));

drop policy if exists system_pages_read on public.system_pages;
create policy system_pages_read on public.system_pages for select to anon, authenticated using (true);

-- Rate-limited intake. Only write path for anon.
create or replace function public.portrox_submit(
  p_site text, p_kind text, p_full_name text, p_email text,
  p_message text, p_slot text default null, p_honeypot text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_ip inet; v_recent int; v_id uuid; v_xff text;
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

  -- XFF may be "client, proxy1, proxy2": take the FIRST hop only.
  v_ip := null;
  begin
    v_xff := nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-forwarded-for';
    if v_xff is not null then v_ip := btrim(split_part(v_xff, ',', 1))::inet; end if;
  exception when others then v_ip := null; end;

  select count(*) into v_recent from public.submissions
   where site_id = p_site and created_at > now() - interval '1 hour'
     and (lower(email) = lower(p_email) or (v_ip is not null and ip = v_ip));
  if v_recent >= 5 then return jsonb_build_object('ok',false,'error','rate_limited'); end if;

  insert into public.submissions (site_id, kind, full_name, email, message, slot, ip, honeypot)
  values (p_site, p_kind, btrim(p_full_name), lower(btrim(p_email)), btrim(p_message),
          nullif(btrim(coalesce(p_slot,'')),''), v_ip, null)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.portrox_submit(text,text,text,text,text,text,text) from public;
grant execute on function public.portrox_submit(text,text,text,text,text,text,text) to anon, authenticated;

-- Booking with a real slot lock (uses appt_slot_unique).
create or replace function public.portrox_book(
  p_site text, p_full_name text, p_email text, p_message text,
  p_starts_at timestamptz, p_minutes int default 30
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_sub jsonb; v_sid uuid; v_aid uuid;
begin
  v_sub := public.portrox_submit(p_site,'booking',p_full_name,p_email,p_message,
                                 to_char(p_starts_at,'YYYY-MM-DD HH24:MI'), null);
  if coalesce((v_sub->>'ok')::boolean,false) = false then return v_sub; end if;
  v_sid := nullif(v_sub->>'id','')::uuid;
  if v_sid is null then return jsonb_build_object('ok',true,'id',null); end if;
  if p_starts_at < now() then return jsonb_build_object('ok',false,'error','past_slot'); end if;
  begin
    insert into public.appointments (site_id, submission_id, starts_at, duration_minutes, status)
    values (p_site, v_sid, p_starts_at, greatest(5,least(240,p_minutes)), 'confirmed')
    returning id into v_aid;
  exception when unique_violation then
    return jsonb_build_object('ok',false,'error','slot_taken');
  end;
  return jsonb_build_object('ok',true,'appointment_id',v_aid,'submission_id',v_sid);
end $$;
revoke all on function public.portrox_book(text,text,text,text,timestamptz,int) from public;
grant execute on function public.portrox_book(text,text,text,text,timestamptz,int) to anon, authenticated;

-- Seed the locked system page so the DB lock is real, not decorative.
insert into public.system_pages (slug, title, body_md, is_locked)
values ('about-website','About this website',
        'This site was generated by Portrox, a self-hostable portfolio engine by Siddhant Kumar. This page is locked and cannot be edited by site owners.',
        true)
on conflict (slug) do nothing;
