/**
 * POST /api/publish-absence
 * Body: { password, teacher, subject, batch, date, cover?, urgent? }
 * Checks process.env.STAFF_PASSWORD, then inserts into Supabase on the server.
 */

function mapRow(row) {
  return {
    id: row.id,
    teacher: row.teacher,
    subject: row.subject,
    batch: row.batch,
    date: row.absence_date,
    cover: row.cover || '',
    urgent: Boolean(row.urgent),
    createdAt: row.created_at
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const staffPassword = process.env.STAFF_PASSWORD;
  if (!staffPassword) {
    return res.status(500).json({ error: 'Staff password is not configured on the server' });
  }

  const body = req.body || {};
  const { password, teacher, subject, batch, date, cover, urgent } = body;

  if (!password || password !== staffPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!teacher || !subject || !batch || !date) {
    return res.status(400).json({ error: 'teacher, subject, batch, and date are required' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Supabase is not configured on the server (SUPABASE_URL + key)'
    });
  }

  const payload = {
    teacher: String(teacher).trim(),
    subject: String(subject).trim(),
    batch: String(batch).trim(),
    absence_date: String(date).trim(),
    cover: String(cover || '').trim(),
    urgent: Boolean(urgent)
  };

  try {
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/absences`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    });

    if (!insertRes.ok) {
      const text = await insertRes.text().catch(() => '');
      console.error('Supabase insert failed', insertRes.status, text);
      return res.status(502).json({ error: 'Failed to save absence' });
    }

    const rows = await insertRes.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return res.status(200).json({ ok: true, absence: mapRow(row) });
  } catch (err) {
    console.error('publish-absence error', err);
    return res.status(500).json({ error: 'Server error publishing absence' });
  }
}
