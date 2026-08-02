# Ascend Dashboard (Campus Hub)

Dashboard for AIS students — timetable assistant, teacher absence announcements, and anonymous feedback.

Secrets (staff password, Discord webhook, Supabase service key) live in **Vercel environment variables** and serverless functions under `/api`. They are not in the browser bundle.

## Vercel environment variables

In Vercel → Project → **Settings → Environment Variables**, add:

| Name | Value |
|------|--------|
| `STAFF_PASSWORD` | Your staff password (e.g. `AscendIntl2026`) |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | anon/public key (or prefer service role below) |
| `SUPABASE_SERVICE_ROLE_KEY` | *(recommended)* service_role key for server inserts |

Redeploy after saving env vars.

## API routes

| Route | Purpose |
|-------|---------|
| `POST /api/verify-staff` | Check staff password (unlock UI) |
| `POST /api/publish-absence` | Password check + insert absence in Supabase |
| `POST /api/discord-alert` | Send Discord embed (webhook only on server) |

## Supabase setup

1. Run `supabase/schema.sql` once  
2. *(Recommended)* Run `supabase/lock-absence-inserts.sql` so browsers can no longer insert absences directly  
3. Keep anon key in `js/supabase-config.js` for **read + realtime** only  

## Deploy

Push to GitHub → Vercel auto-deploys. Share the Vercel URL.

## Local note

`python -m http.server` will **not** run `/api/*`. Use:

```bash
npx vercel dev
```

## Staff password

Set only in Vercel as `STAFF_PASSWORD`. Staff unlock/publish go through the API — students cannot read the password from `js/app.js`.

## Urgent browser alerts

On **Absence Alerts**, tap **Enable alerts** for OS notifications while the tab is open.
