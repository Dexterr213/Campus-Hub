/**
 * Campus Hub — storage helpers (device-local only; no IPs or identities).
 */

const KEYS = {
  batch: 'campusHub.selectedBatch',
  absences: 'campusHub.absences'
};

export function getSelectedBatch() {
  return localStorage.getItem(KEYS.batch);
}

export function setSelectedBatch(batch) {
  localStorage.setItem(KEYS.batch, batch);
}

export function clearSelectedBatch() {
  localStorage.removeItem(KEYS.batch);
}

export function loadAbsences() {
  try {
    const raw = localStorage.getItem(KEYS.absences);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAbsences(list) {
  localStorage.setItem(KEYS.absences, JSON.stringify(list));
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
