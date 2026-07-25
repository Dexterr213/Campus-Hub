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

-- Anonymous feedback (no names / IPs)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  message text not null,
  avatar_label text not null,
  avatar_emoji text not null,
  avatar_hue integer not null default 160,
  upvotes integer not null default 0,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx
  on public.feedback (created_at desc);

-- Public school portal access (tighten later with Edge Functions if needed)
alter table public.absences enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "Public read absences" on public.absences;
create policy "Public read absences"
  on public.absences for select
  to anon, authenticated
  using (true);

drop policy if exists "Public insert absences" on public.absences;
create policy "Public insert absences"
  on public.absences for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Public read feedback" on public.feedback;
create policy "Public read feedback"
  on public.feedback for select
  to anon, authenticated
  using (true);

drop policy if exists "Public insert feedback" on public.feedback;
create policy "Public insert feedback"
  on public.feedback for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Public update feedback" on public.feedback;
create policy "Public update feedback"
  on public.feedback for update
  to anon, authenticated
  using (true)
  with check (true);

-- Realtime (ignore error if already added)
do $$
begin
  alter publication supabase_realtime add table public.absences;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.feedback;
exception when duplicate_object then null;
end $$;
