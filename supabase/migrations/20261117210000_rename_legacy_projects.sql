-- A4 FIX: free the name `public.projects` for Portrox's multi-tenant table.
-- Reversible: alter table public.legacy_projects rename to projects;
do $$
begin
  if to_regclass('public.projects') is not null
     and to_regclass('public.legacy_projects') is null
     and exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='status')
     and not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='site_id')
  then
    execute 'alter table public.projects rename to legacy_projects';
    raise notice 'renamed public.projects -> public.legacy_projects';
  else
    raise notice 'no legacy projects rename needed';
  end if;
end $$;
