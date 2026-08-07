/**
 * POST /api/save-timetable-day
 * Body: {
 *   password, batch, day,
 *   slots: [{ time, subject, room, teacher, markUpdated?, previousUpdatedAt? }],
 *   fullWeekSeed?: { Monday: Slot[], ... } // used only when this batch has no cloud rows yet
 * }
 * Replaces all slots for batch+day. Sets updated_at only for marked/changed slots.
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKDAY_SET = new Set(WEEKDAYS);

function mapRow(row) {
  return {
    id: row.id,
    batch: row.batch,
    day: row.day,
    slotIndex: row.slot_index,
    time: row.time || '',
    subject: row.subject || '',
    room: row.room || '',
    teacher: row.teacher || '',
    updatedAt: row.updated_at || null
  };
}

function normalizeSlotPayload(slot, batch, day, index, nowIso) {
  const markUpdated = Boolean(slot?.markUpdated);
  let updatedAt = null;
  if (markUpdated) {
    updatedAt = nowIso;
  } else if (slot?.previousUpdatedAt) {
    updatedAt = String(slot.previousUpdatedAt);
  } else if (slot?.updatedAt) {
    updatedAt = String(slot.updatedAt);
  }

  return {
    batch,
    day,
    slot_index: index,
    time: String(slot?.time || '').trim(),
    subject: String(slot?.subject || '').trim(),
    room: String(slot?.room || '').trim(),
    teacher: String(slot?.teacher || '').trim(),
    updated_at: updatedAt
  };
}

async function supabaseFetch(url, key, path, options = {}) {
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
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
  const { password, batch, day, slots, fullWeekSeed } = body;

  if (!password || password !== staffPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const batchName = String(batch || '').trim();
  if (!batchName || !WEEKDAY_SET.has(day)) {
    return res.status(400).json({ error: 'batch and a weekday (Monday–Friday) are required' });
  }

  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: 'slots must be an array' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Supabase is not configured on the server (SUPABASE_URL + key)'
    });
  }

  const nowIso = new Date().toISOString();

  try {
    const existingRes = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      `timetable_slots?batch=eq.${encodeURIComponent(batchName)}&select=id&limit=1`
    );
    if (!existingRes.ok) {
      const text = await existingRes.text().catch(() => '');
      console.error('Supabase timetable lookup failed', existingRes.status, text);
      return res.status(502).json({ error: 'Failed to read timetable' });
    }
    const existing = await existingRes.json();
    const isFirstSave = !Array.isArray(existing) || existing.length === 0;

    if (isFirstSave && fullWeekSeed && typeof fullWeekSeed === 'object') {
      const seedRows = [];
      for (const wd of WEEKDAYS) {
        if (wd === day) continue;
        const daySlots = Array.isArray(fullWeekSeed[wd]) ? fullWeekSeed[wd] : [];
        daySlots.forEach((slot, index) => {
          seedRows.push(normalizeSlotPayload(slot, batchName, wd, index, nowIso));
        });
      }
      if (seedRows.length) {
        const seedRes = await supabaseFetch(supabaseUrl, supabaseKey, 'timetable_slots', {
          method: 'POST',
          body: JSON.stringify(seedRows)
        });
        if (!seedRes.ok) {
          const text = await seedRes.text().catch(() => '');
          console.error('Supabase timetable seed failed', seedRes.status, text);
          return res.status(502).json({ error: 'Failed to seed timetable week' });
        }
      }
    }

    const delRes = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      `timetable_slots?batch=eq.${encodeURIComponent(batchName)}&day=eq.${encodeURIComponent(day)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    );

    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      console.error('Supabase timetable delete failed', delRes.status, text);
      return res.status(502).json({ error: 'Failed to update timetable' });
    }

    const payload = slots.map((slot, index) =>
      normalizeSlotPayload(slot, batchName, day, index, nowIso)
    );

    if (payload.length === 0) {
      // Keep a zero-slot footprint for this day by storing nothing;
      // batch is already cloud-owned after first save. Empty day stays empty.
      return res.status(200).json({ ok: true, slots: [], seeded: isFirstSave });
    }

    const insertRes = await supabaseFetch(supabaseUrl, supabaseKey, 'timetable_slots', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!insertRes.ok) {
      const text = await insertRes.text().catch(() => '');
      console.error('Supabase timetable insert failed', insertRes.status, text);
      return res.status(502).json({ error: 'Failed to save timetable slots' });
    }

    const rows = await insertRes.json();
    const mapped = (Array.isArray(rows) ? rows : [rows]).map(mapRow);
    return res.status(200).json({ ok: true, slots: mapped, seeded: isFirstSave });
  } catch (err) {
    console.error('save-timetable-day error', err);
    return res.status(500).json({ error: 'Server error saving timetable' });
  }
}
