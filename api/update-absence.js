/**
 * POST /api/update-absence
 * Body: { password, id, teacher, subject, batch, date, cover?, urgent? }
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
  const { password, id, teacher, subject, batch, date, cover, urgent } = body;

  if (!password || password !== staffPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!id || !teacher || !subject || !batch || !date) {
    return res.status(400).json({ error: 'id, teacher, subject, batch, and date are required' });
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
    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/absences?id=eq.${encodeURIComponent(String(id))}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!updateRes.ok) {
      const text = await updateRes.text().catch(() => '');
      console.error('Supabase update failed', updateRes.status, text);
      return res.status(502).json({ error: 'Failed to update absence' });
    }

    const rows = await updateRes.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) {
      return res.status(404).json({ error: 'Absence not found' });
    }
    return res.status(200).json({ ok: true, absence: mapRow(row) });
  } catch (err) {
    console.error('update-absence error', err);
    return res.status(500).json({ error: 'Server error updating absence' });
  }
}
