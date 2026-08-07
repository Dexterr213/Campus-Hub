-- Campus Hub — editable timetable slots with per-slot updated_at
-- Run once in Supabase: SQL Editor → New query → Run
-- After this, optionally run seed-timetable.sql to import static JSON data.

create table if not exists public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  batch text not null,
  day text not null,
  slot_index integer not null,
  time text not null default '',
  subject text not null default '',
  room text not null default '',
  teacher text not null default '',
  updated_at timestamptz,
  constraint timetable_slots_day_check
    check (day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')),
  constraint timetable_slots_batch_day_idx unique (batch, day, slot_index)
);

create index if not exists timetable_slots_batch_day_idx
  on public.timetable_slots (batch, day, slot_index);

alter table public.timetable_slots enable row level security;

drop policy if exists "Public read timetable slots" on public.timetable_slots;
create policy "Public read timetable slots"
  on public.timetable_slots for select
  to anon, authenticated
  using (true);

-- Writes go through /api/save-timetable-day with the service role key (no public insert/update/delete)

do $$
begin
  alter publication supabase_realtime add table public.timetable_slots;
exception when duplicate_object then null;
end $$;
