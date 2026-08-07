/**
 * Timetable load/save — Supabase slots overlay static JSON seed.
 */

import { cloudEnabled, supabase } from './db.js';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const UPDATED_BADGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Fixed period times for the staff timetable editor. */
export const TIME_SLOT_OPTIONS = [
  '08:00 - 09:30',
  '09:30 - 11:00',
  '11:00 - 12:30',
  '13:00 - 14:30',
  '14:30 - 16:00'
];

/** Next unused fixed time slot, or the first option if all are taken. */
export function nextAvailableTimeSlot(usedTimes = []) {
  const used = new Set((usedTimes || []).filter(Boolean));
  return TIME_SLOT_OPTIONS.find((t) => !used.has(t)) || TIME_SLOT_OPTIONS[0];
}

function emptyWeek() {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, []]));
}

function mapSlot(row) {
  return {
    id: row.id || null,
    time: row.time || '',
    subject: row.subject || '',
    room: row.room || '',
    teacher: row.teacher || '',
    updatedAt: row.updated_at || row.updatedAt || null,
    slotIndex: typeof row.slot_index === 'number' ? row.slot_index : row.slotIndex
  };
}

/** True when updated_at is within the last 7 days. */
export function isRecentlyUpdated(updatedAt, now = Date.now()) {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= 0 && age <= UPDATED_BADGE_MS;
}

export function slotFingerprint(slot) {
  return [slot.time || '', slot.subject || '', slot.room || '', slot.teacher || ''].join('\u0001');
}

/**
 * Build { [batch]: { Monday: Slot[], ... } } from flat Supabase rows.
 * Any batch present in cloud becomes fully cloud-sourced (missing days = []).
 */
export function rowsToTimetableMap(rows) {
  const map = {};
  for (const row of rows || []) {
    const batch = row.batch;
    const day = row.day;
    if (!batch || !WEEKDAYS.includes(day)) continue;
    if (!map[batch]) map[batch] = emptyWeek();
    map[batch][day].push(mapSlot(row));
  }
  for (const batch of Object.keys(map)) {
    for (const day of WEEKDAYS) {
      map[batch][day].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    }
  }
  return map;
}

/**
 * Overlay cloud batch weeks onto a static JSON seed (keeps meta + empty batches).
 */
export function mergeTimetables(base, cloudMap) {
  const out = structuredClone(base || {});
  for (const [batch, week] of Object.entries(cloudMap || {})) {
    out[batch] = week;
  }
  return out;
}

export async function fetchStaticTimetables() {
  const res = await fetch('data/timetables.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load timetables.json');
  return res.json();
}

export async function fetchCloudTimetableRows() {
  if (!cloudEnabled) return [];
  const { data, error } = await supabase
    .from('timetable_slots')
    .select('*')
    .order('slot_index', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Load static JSON, then overlay any Supabase timetable_slots.
 */
export async function loadMergedTimetables(batches = []) {
  let base = {};
  try {
    base = await fetchStaticTimetables();
  } catch {
    base = Object.fromEntries(batches.map((b) => [b, emptyWeek()]));
  }

  if (!cloudEnabled) return base;

  try {
    const rows = await fetchCloudTimetableRows();
    if (!rows.length) return base;
    return mergeTimetables(base, rowsToTimetableMap(rows));
  } catch (err) {
    console.warn('Cloud timetable load failed; using static JSON', err);
    return base;
  }
}

/**
 * Replace one batch/day in Supabase. Only markUpdated slots get a fresh updated_at.
 * fullWeekSeed seeds other weekdays on the first cloud save for a batch.
 */
export async function saveTimetableDay({ password, batch, day, slots, fullWeekSeed }) {
  const res = await fetch('/api/save-timetable-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      password,
      batch,
      day,
      slots: (slots || []).map((s) => ({
        time: s.time,
        subject: s.subject,
        room: s.room,
        teacher: s.teacher,
        markUpdated: Boolean(s.markUpdated),
        previousUpdatedAt: s.previousUpdatedAt || s.updatedAt || null
      })),
      fullWeekSeed: fullWeekSeed || undefined
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
    const err = new Error(data?.error || 'Failed to save timetable');
    err.code = 'SAVE_FAILED';
    throw err;
  }

  return data;
}
