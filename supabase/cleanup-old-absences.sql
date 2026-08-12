-- Optional: monthly absence cleanup in Supabase (alternative to Vercel Cron).
-- Deletes absences dated before the first day of the current month (UTC date).
-- Prefer the Vercel cron hitting /api/cleanup-absences (uses Asia/Yangon).

-- Example one-off run:
-- delete from public.absences
-- where absence_date < date_trunc('month', (now() at time zone 'Asia/Yangon'))::date;
