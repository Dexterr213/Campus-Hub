/**
 * Structured timetable queries — no free-text parsing.
 * Timetable JSON shape:
 * {
 *   "A Level Batch 2": {
 *     "Monday": [{ "time": "08:00 - 09:30", "subject": "Mechanics", "room": "", "teacher": "" }]
 *   }
 * }
 */

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
     * @returns {{ title: string, lines: string[], empty: boolean, sections?: { day: string, lines: string[] }[] }}
     */
    query(query) {
      const batchData = timetables?.[batch];
      if (!batchData) {
        return {
          title: 'No timetable',
          lines: [`No timetable is loaded for ${batch} yet.`],
          empty: true
        };
      }

      if (query.mode === 'week') {
        return formatFullWeek(batchData);
      }

      if (query.mode === 'day') {
        const day = resolveDayValue(query.dayValue);
        return toResult(formatDaySchedule(batchData, day), day);
      }

      return { title: 'Choose an option', lines: ['Select a full day or the full week.'], empty: true };
    }
  };
}

function formatFullWeek(batchData) {
  const sections = [];
  const lines = [];
  let anySlots = false;

  for (const day of WEEKDAYS) {
    const slots = batchData[day] || [];
    const dayLines = slots.length
      ? slots.map((s) => formatSlot(s))
      : ['No periods listed'];
    if (slots.length) anySlots = true;
    sections.push({ day, lines: dayLines });
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

function toResult(text, title) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const empty = lines.length === 0 || /no periods|no class|enjoy the break|not listed/i.test(lines.join(' '));
  return { title, lines: lines.length ? lines : ['Nothing scheduled.'], empty };
}

function formatDaySchedule(batchData, day) {
  if (day === 'Saturday' || day === 'Sunday') {
    return `It's ${day} — enjoy the break!`;
  }
  const slots = batchData[day] || [];
  if (!slots.length) {
    return `No periods listed for ${day} yet.`;
  }
  return slots.map((s) => `• ${formatSlot(s)}`).join('\n');
}

function formatSlot(slot) {
  const bits = [slot.time, slot.subject];
  if (slot.room) bits.push(slot.room);
  if (slot.teacher) bits.push(slot.teacher);
  return bits.filter(Boolean).join(' · ');
}
