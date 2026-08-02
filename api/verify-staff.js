/**
 * POST /api/verify-staff
 * Body: { password }
 * Confirms staff password without exposing it in client source.
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

  const { password } = req.body || {};
  if (!password || password !== staffPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(200).json({ ok: true });
}
