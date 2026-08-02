/**
 * POST /api/discord-alert
 * Body: { teacher, subject?, batch, date, notes?, urgent? }
 * Uses process.env.DISCORD_WEBHOOK_URL (never exposed to the browser).
 */

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    return res.status(500).json({ error: 'Discord webhook is not configured on the server' });
  }

  const { teacher, subject, batch, date, notes, urgent } = req.body || {};
  if (!teacher || !batch || !date) {
    return badRequest(res, 'teacher, batch, and date are required');
  }

  const noteText = String(notes || '').trim() || 'No additional notes provided.';
  const payload = {
    username: 'Campus Hub Alerts',
    avatar_url: 'https://ascend-dashboard-six.vercel.app/favicon.ico',
    content: urgent
      ? '@everyone 🚨 **Urgent Teacher Absence Alert**'
      : '@everyone 📢 **New Teacher Absence Alert**',
    embeds: [
      {
        title: `Teacher Absence: ${teacher}`,
        description: `A new absence notice has been published for **${batch}**.`,
        color: urgent ? 15548997 : 5763719,
        fields: [
          { name: 'Subject', value: String(subject || '—'), inline: true },
          { name: 'Batch', value: String(batch), inline: true },
          { name: 'Date', value: String(date), inline: true },
          { name: 'Notes / Details', value: noteText }
        ],
        footer: { text: 'Campus Hub • Ascend Dashboard' },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const discordRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!discordRes.ok) {
      const text = await discordRes.text().catch(() => '');
      console.error('Discord webhook failed', discordRes.status, text);
      return res.status(502).json({ error: 'Failed to deliver Discord alert' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Discord alert error', err);
    return res.status(500).json({ error: 'Server error sending Discord alert' });
  }
}
