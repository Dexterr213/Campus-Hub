/**
 * POST /api/delete-absence
 * Body: { password, id }
 */

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
  const { password, id } = body;

  if (!password || password !== staffPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Supabase is not configured on the server (SUPABASE_URL + key)'
    });
  }

  try {
    const delRes = await fetch(
      `${supabaseUrl}/rest/v1/absences?id=eq.${encodeURIComponent(String(id))}`,
      {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal'
        }
      }
    );

    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      console.error('Supabase delete failed', delRes.status, text);
      return res.status(502).json({ error: 'Failed to delete absence' });
    }

    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error('delete-absence error', err);
    return res.status(500).json({ error: 'Server error deleting absence' });
  }
}
