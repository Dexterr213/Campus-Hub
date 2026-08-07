/**
 * Structured timetable queries — no free-text parsing.
 * Slot shape: { time, subject, room, teacher, updatedAt? }
 */

import { isRecentlyUpdated } from './timetables.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * @param {object} timetables
 * @param {string} batch
 */
export function createTimetableAssistant(timetables, batch) {
  return {
    setBatch(nextBatch) {
      batch = nextBatch;
    },
    getBatchData() {
      return timetables?.[batch] || null;
    },
    /** Day choices for the UI (built-in only). */
    getDayChoices() {
      return [
        { value: 'today', label: 'Today', short: 'Today' },
        { value: 'tomorrow', label: 'Tomorrow', short: 'Tmrw' },
        { value: 'Monday', label: 'Monday', short: 'Mon' },
        { value: 'Tuesday', label: 'Tuesday', short: 'Tue' },
        { value: 'Wednesday', label: 'Wednesday', short: 'Wed' },
        { value: 'Thursday', label: 'Thursday', short: 'Thu' },
        { value: 'Friday', label: 'Friday', short: 'Fri' }
      ];
    },
    /**
     * @param {{ mode: 'day' | 'week', dayValue?: string }} query
     */
    query(query) {
      const batchData = timetables?.[batch];
      if (!batchData) {
        return {
          title: 'No timetable',
          lines: [`No timetable is loaded for ${batch} yet.`],
          slots: [],
          empty: true
        };
      }

      if (query.mode === 'week') {
        return formatFullWeek(batchData);
      }

      if (query.mode === 'day') {
        const day = resolveDayValue(query.dayValue);
        return formatDayResult(batchData, day);
      }

      return { title: 'Choose an option', lines: ['Select a full day or the full week.'], slots: [], empty: true };
    }
  };
}

function formatFullWeek(batchData) {
  const sections = [];
  const lines = [];
  let anySlots = false;

  for (const day of WEEKDAYS) {
    const raw = batchData[day] || [];
    const slots = raw.map(normalizeSlot);
    const dayLines = slots.length
      ? slots.map((s) => formatSlot(s))
      : ['No periods listed'];
    if (slots.length) anySlots = true;
    sections.push({ day, lines: dayLines, slots });
    lines.push(`${day}`);
    dayLines.forEach((l) => lines.push(l));
  }

  return {
    title: 'Full week schedule',
    lines,
    empty: !anySlots,
    sections
  };
}

function resolveDayValue(dayValue) {
  if (dayValue === 'today') return DAYS[new Date().getDay()];
  if (dayValue === 'tomorrow') return DAYS[(new Date().getDay() + 1) % 7];
  if (WEEKDAYS.includes(dayValue)) return dayValue;
  return DAYS[new Date().getDay()];
}

function formatDayResult(batchData, day) {
  if (day === 'Saturday' || day === 'Sunday') {
    return {
      title: day,
      lines: [`It's ${day} — enjoy the break!`],
      slots: [],
      empty: true
    };
  }

  const slots = (batchData[day] || []).map(normalizeSlot);
  if (!slots.length) {
    return {
      title: day,
      lines: [`No periods listed for ${day} yet.`],
      slots: [],
      empty: true
    };
  }

  return {
    title: day,
    lines: slots.map((s) => `• ${formatSlot(s)}`),
    slots,
    empty: false
  };
}

function normalizeSlot(slot) {
  return {
    id: slot.id || null,
    time: slot.time || '',
    subject: slot.subject || '',
    room: slot.room || '',
    teacher: slot.teacher || '',
    updatedAt: slot.updatedAt || slot.updated_at || null,
    recentlyUpdated: isRecentlyUpdated(slot.updatedAt || slot.updated_at || null)
  };
}

export function formatSlot(slot) {
  const bits = [slot.time, slot.subject];
  if (slot.room) bits.push(slot.room);
  if (slot.teacher) bits.push(slot.teacher);
  return bits.filter(Boolean).join(' · ');
}
