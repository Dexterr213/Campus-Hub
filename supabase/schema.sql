-- Campus Hub — run this once in Supabase: SQL Editor → New query → Run

-- Absences (shared for all students)
create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  teacher text not null,
  subject text not null,
  batch text not null,
  absence_date date not null,
  cover text not null default '',
  urgent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists absences_batch_date_idx
  on public.absences (batch, absence_date desc);

-- Public school portal access (tighten later with Edge Functions if needed)
alter table public.absences enable row level security;

drop policy if exists "Public read absences" on public.absences;
create policy "Public read absences"
  on public.absences for select
  to anon, authenticated
  using (true);

-- Prefer lock-absence-inserts.sql in production so only the server can insert
drop policy if exists "Public insert absences" on public.absences;
create policy "Public insert absences"
  on public.absences for insert
  to anon, authenticated
  with check (true);

-- Realtime (ignore error if already added)
do $$
begin
  alter publication supabase_realtime add table public.absences;
exception when duplicate_object then null;
end $$;

-- Also run supabase/timetable-slots.sql for staff-editable timetables + Updated badges.
