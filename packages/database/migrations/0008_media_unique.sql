-- The natural key for media is (site_id, storage_path), NOT storage_path alone:
-- two sites can both own assets/media/avatar.png. A global unique constraint
-- would be wrong. This index makes the upsert valid and enforces per-site keys.
create unique index if not exists media_site_path_uniq on public.media (site_id, storage_path);
