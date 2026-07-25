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
    /** Subject labels for dropdown/checkboxes (splits "A / B" electives). */
    getSubjectChoices() {
      return collectSubjectChoices(timetables?.[batch]);
    },
    /**
     * @param {{ mode: 'day' | 'week' | 'subject', dayValue?: string, subject?: string }} query
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

      if (query.mode === 'subject') {
        const subject = String(query.subject || '').trim();
        if (!subject) {
          return { title: 'Pick a subject', lines: ['Select a subject to continue.'], empty: true };
        }
        if (query.dayValue && query.dayValue !== 'any') {
          const day = resolveDayValue(query.dayValue);
          return toResult(formatSubjectOnDay(batchData, day, subject), `${subject} · ${day}`);
        }
        return toResult(formatSubjectAcrossWeek(batchData, subject), `${subject} · this week`);
      }

      return { title: 'Choose an option', lines: ['Select day schedule, full week, or find a subject.'], empty: true };
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
    sections,
    empty: !anySlots
  };
}

function toResult(text, title) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/^•\s*/, '').trim())
    .filter(Boolean);
  // Prefer body lines after a header like "Monday schedule:"
  const body =
    lines.length > 1 && /schedule:|this week:|on (Monday|Tuesday|Wednesday|Thursday|Friday):/i.test(lines[0])
      ? lines.slice(1)
      : lines;
  const empty = /no periods listed|no .+ found|no .+ class on|Enjoy the break|no weekday classes/i.test(text);
  return { title, lines: body, empty };
}

function resolveDayValue(value) {
  if (value === 'today') return DAYS[new Date().getDay()];
  if (value === 'tomorrow') return DAYS[(new Date().getDay() + 1) % 7];
  if (WEEKDAYS.includes(value) || DAYS.includes(value)) return value;
  return DAYS[new Date().getDay()];
}

function collectSubjectChoices(batchData) {
  if (!batchData) return [];
  const set = new Set();
  for (const day of WEEKDAYS) {
    for (const slot of batchData[day] || []) {
      if (!slot.subject) continue;
      const raw = slot.subject.trim();
      if (/^lunch$/i.test(raw)) continue;
      // Full cell label
      set.add(raw);
      // Split concurrent electives: "Chem / Eco" → Chem, Eco
      raw.split('/').forEach((part) => {
        const p = part.trim();
        if (p) set.add(p);
      });
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function slotMatchesSubject(slot, subject) {
  if (!slot.subject || !subject) return false;
  const target = subject.toLowerCase().trim();
  const full = slot.subject.toLowerCase().trim();
  if (full === target) return true;
  const parts = full.split('/').map((p) => p.trim());
  if (parts.includes(target)) return true;
  // Light alias: Chem ↔ Chemistry
  if (target === 'chem' && parts.some((p) => p === 'chemistry' || p === 'chem')) return true;
  if (target === 'chemistry' && parts.some((p) => p === 'chemistry' || p === 'chem')) return true;
  if (target === 'bio' && parts.some((p) => p === 'bio' || p.startsWith('bio'))) return true;
  if (target === 'eco' && parts.some((p) => p === 'eco' || p.startsWith('eco'))) return true;
  return parts.some((p) => p === target || p.includes(target) || target.includes(p));
}

function formatSlot(slot) {
  const bits = [slot.time, slot.subject];
  if (slot.room) bits.push(slot.room);
  if (slot.teacher) bits.push(slot.teacher);
  return bits.join(' · ');
}

function formatDaySchedule(batchData, day) {
  if (day === 'Saturday' || day === 'Sunday') {
    return `${day} — no weekday classes scheduled. Enjoy the break!`;
  }
  const slots = batchData[day] || [];
  if (!slots.length) {
    return `${day}: no periods listed yet for this batch.`;
  }
  return `${day} schedule:\n${slots.map((s) => `• ${formatSlot(s)}`).join('\n')}`;
}

function formatSubjectOnDay(batchData, day, subject) {
  if (day === 'Saturday' || day === 'Sunday') {
    return `No ${subject} class on ${day}.`;
  }
  const matches = (batchData[day] || []).filter((s) => slotMatchesSubject(s, subject));
  if (!matches.length) {
    return `No ${subject} class found on ${day}.`;
  }
  return `${subject} on ${day}:\n${matches.map((s) => `• ${formatSlot(s)}`).join('\n')}`;
}

function formatSubjectAcrossWeek(batchData, subject) {
  const lines = [];
  for (const day of WEEKDAYS) {
    const matches = (batchData[day] || []).filter((s) => slotMatchesSubject(s, subject));
    for (const slot of matches) {
      lines.push(
        `• ${day}: ${slot.time}${slot.room ? ` · ${slot.room}` : ''}${slot.teacher ? ` · ${slot.teacher}` : ''} · ${slot.subject}`
      );
    }
  }
  if (!lines.length) {
    return `No ${subject} periods found in this batch timetable yet.`;
  }
  return `${subject} this week:\n${lines.join('\n')}`;
}

export { DAYS, WEEKDAYS, collectSubjectChoices, resolveDayValue };
