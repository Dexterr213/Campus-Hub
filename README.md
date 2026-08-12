# Campus Hub

School dashboard for Ascend International — live teacher absence alerts and weekly timetables in one place.

**Live:** [ascend-dashboard-six.vercel.app](https://ascend-dashboard-six.vercel.app)

## Problem

Students were checking cancellations and schedules in scattered places. Staff needed a simple way to publish absences and update periods without a heavyweight school system.

## What it does

- Batch-based **live absence alerts** (with optional urgent banner)
- **Timetable assistant** — full day or full week views
- **Staff tools** (password-gated): publish absence notices, edit periods
- Student-facing flow: pick batch → see alerts + schedule

## Stack

- HTML · CSS · JavaScript
- Deployed on Vercel

## How I built it

- Started from a real school need (Ascend A-Level batches), not a generic CRUD demo
- Separated student view vs staff publish/edit flows
- Kept the UI fast to scan on phone during the school day
- Shipped live so classmates and staff can actually use it

## Run locally

```bash
npx serve
```

Author
Kyaw Zin Win · GitHub: Dexterr213
Contact: kyawzinwin.software@gmail.com
