/**
 * GET/POST /api/cleanup-absences
 * Deletes absences whose date is before the start of the current month
 * (Asia/Yangon calendar — Ascend school timezone).
 *
 * Auth (either):
 * - Authorization: Bearer <CRON_SECRET>  (Vercel Cron)
 * - Body/query: { password } matching STAFF_PASSWORD (manual staff run)
 */

function startOfMonthYangonISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}-01`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const staffPassword = process.env.STAFF_PASSWORD;
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const body = req.body || {};
  const queryPassword = typeof req.query?.password === 'string' ? req.query.password : '';
  const password = body.password || queryPassword || '';

  const cronOk = Boolean(cronSecret) && bearer === cronSecret;
  const staffOk = Boolean(staffPassword) && password === staffPassword;

  if (!cronOk && !staffOk) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Supabase is not configured on the server (SUPABASE_URL + key)'
    });
  }

  const cutoff = startOfMonthYangonISO();

  try {
    const delRes = await fetch(
      `${supabaseUrl}/rest/v1/absences?absence_date=lt.${encodeURIComponent(cutoff)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=representation'
        }
      }
    );

    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      console.error('cleanup-absences failed', delRes.status, text);
      return res.status(502).json({ error: 'Failed to clean up absences' });
    }

    let deleted = [];
    try {
      deleted = await delRes.json();
    } catch {
      deleted = [];
    }
    const count = Array.isArray(deleted) ? deleted.length : 0;

    return res.status(200).json({
      ok: true,
      cutoff,
      deleted: count,
      message:
        count > 0
          ? `Removed ${count} absence(s) from before ${cutoff}.`
          : `No absences older than ${cutoff}.`
    });
  } catch (err) {
    console.error('cleanup-absences error', err);
    return res.status(500).json({ error: 'Server error cleaning absences' });
  }
}
