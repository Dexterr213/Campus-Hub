# Ascend Dashboard (Campus Hub)

Dashboard for AIS students — timetable assistant, teacher absence announcements, and anonymous feedback.

Built with HTML, Tailwind, and JavaScript. Optional **Supabase** for shared live data and **Vercel** for hosting.

## What syncs school-wide

| Data | Where |
|------|--------|
| Absence alerts | Supabase (live for everyone) |
| Anonymous feedback | Supabase (live for staff viewers) |
| Timetable | `data/timetables.json` (update file + redeploy) |
| Batch / theme preference | Each device’s localStorage |

## 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) → New project  
2. Open **SQL Editor** → paste and run everything in `supabase/schema.sql`  
3. Open **Project Settings → API** and copy:
   - Project URL  
   - `anon` `public` key  

4. Put them in `js/supabase-config.js`:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

When configured, the header shows **● Live sync on**.

## 2. Deploy to Vercel (share one link)

1. Push this folder to GitHub (`Dexterr213/Ascend-Dashboard`)  
2. In Vercel, import that repo (or reconnect if the project already exists)  
3. Deploy (no build command needed — static site)  
4. Share the Vercel URL with your school  

## 3. Staff password

Default in `js/config.js`: `AscendIntl2026`  
Change it before sharing widely.

## Local test

```bash
python -m http.server 3000
```

Open http://localhost:3000

## Urgent alert notifications

On the **Absence Alerts** tab, tap **Enable alerts** and allow browser notifications.

- Pop-up when an **urgent** absence is posted for your batch (site can be in a background tab)
- Tab title flashes `⚠️ Urgent alert` if the tab is hidden
- Needs **Supabase live sync** so phones/laptops receive the update in real time

Note: if the browser is fully closed, OS push requires extra setup (service worker + push service). The current alerts cover the normal “Campus Hub left open / in a tab” case.
