-- Inbox triage. Additive and idempotent. No assumption about existing columns.
alter table public.submissions add column if not exists triage text not null default 'new';
alter table public.submissions add column if not exists triaged_at timestamptz;
do $portrox$
begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_triage_allowed') then
    alter table public.submissions add constraint submissions_triage_allowed
      check (triage in ('new','read','replied','archived'));
  end if;
end $portrox$;
create index if not exists submissions_triage_idx on public.submissions (site_id, triage, created_at desc);
