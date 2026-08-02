-- Harden absences: only the server (service role / secured API) should insert.
-- Run in Supabase SQL Editor AFTER relying on /api/publish-absence.

drop policy if exists "Public insert absences" on public.absences;

-- Keep public read so students can still load the feed + realtime
-- (select policy from schema.sql remains)
