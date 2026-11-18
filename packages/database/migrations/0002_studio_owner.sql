-- The Studio is a local single-administrator tool. It connects as the database
-- administrator, so an auth.users row is NOT a prerequisite for owning a site.
-- Public visitors are still confined by RLS + the rate-limited intake RPC.
alter table public.sites alter column owner_id drop not null;
alter table public.sites add column if not exists studio_owner text;
create index if not exists sites_studio_owner_idx on public.sites(studio_owner);
comment on column public.sites.studio_owner is
  'Local Studio administrator that owns this tenant. owner_id is reserved for optional Supabase Auth linkage.';
