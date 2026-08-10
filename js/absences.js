/**
 * Teacher absence alerts — shared via Supabase (with local fallback).
 */

import { loadAbsences, saveAbsences, uid } from './storage.js';
import { cloudEnabled, supabase } from './db.js';

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

function sortAbsences(list) {
  return [...list].sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return String(b.date).localeCompare(String(a.date));
  });
}

export async function fetchAbsences() {
  if (!cloudEnabled) {
    return sortAbsences(loadAbsences());
  }
  const { data, error } = await supabase
    .from('absences')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return sortAbsences((data || []).map(mapRow));
}

export async function getAbsencesForBatch(batch) {
  const all = await fetchAbsences();
  return all.filter((a) => a.batch === batch);
}

export async function getUrgentForBatch(batch, todayISO = toISODate(new Date())) {
  const items = await getAbsencesForBatch(batch);
  return items.filter((a) => a.urgent && a.date === todayISO);
}

export async function publishAbsence({
  password,
  teacher,
  subject,
  batch,
  date,
  cover,
  urgent
}) {
  const res = await fetch('/api/publish-absence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      password,
      teacher: String(teacher || '').trim(),
      subject: String(subject || '').trim(),
      batch,
      date,
      cover: String(cover || '').trim(),
      urgent: Boolean(urgent)
    })
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401) {
    const err = new Error(data?.error || 'Unauthorized');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error || 'Failed to publish absence');
    err.code = 'PUBLISH_FAILED';
    throw err;
  }

  return data?.absence || null;
}

export function formatAbsenceLine(a) {
  const dateLabel = formatDisplayDate(a.date);
  return `${a.teacher} — ${a.subject} — ${a.batch} — Absent on ${dateLabel}`;
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDisplayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/** Local-only demo seed when cloud is not configured. */
export function seedDemoAbsencesIfEmpty(batches) {
  if (cloudEnabled) return;
  if (loadAbsences().length) return;
  const today = toISODate(new Date());
  const primary = batches[0] || 'A Level Batch 2';
  saveAbsences([
    {
      id: uid('abs'),
      teacher: 'Mr. Smith',
      subject: 'Physics',
      batch: primary,
      date: today,
      cover: 'Self-study in Lab 2. Worksheet on Chapter 4.',
      urgent: true,
      createdAt: new Date().toISOString()
    },
    {
      id: uid('abs'),
      teacher: 'Ms. Patel',
      subject: 'English',
      batch: batches[1] || primary,
      date: today,
      cover: 'Cover teacher: Mr. Jones — Room 204.',
      urgent: false,
      createdAt: new Date().toISOString()
    }
  ]);
}

/**
 * Subscribe to live absence changes. Returns unsubscribe fn.
 * @param {() => void} onChange
 */
export function subscribeAbsences(onChange) {
  if (!cloudEnabled || !supabase) return () => {};
  const channel = supabase
    .channel('absences-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, (payload) =>
      onChange(payload)
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
