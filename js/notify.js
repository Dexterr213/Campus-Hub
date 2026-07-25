/**
 * Urgent absence alerts via browser Notifications + tab title flash.
 * Works while Campus Hub is open (including background tabs).
 * Full closed-browser push needs extra mobile setup later.
 */

const SEEN_KEY = 'campusHub.seenUrgentIds';
const PREF_KEY = 'campusHub.notifyEnabled';
const BASE_TITLE = 'Campus Hub — School Portal';

let titleTimer = null;
let titleOn = false;

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotifyPref() {
  return localStorage.getItem(PREF_KEY) === '1';
}

export function setNotifyPref(on) {
  localStorage.setItem(PREF_KEY, on ? '1' : '0');
}

export function permissionState() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/** Ask the browser for permission (must be from a user click). */
export async function enableNotifications() {
  if (!notificationsSupported()) {
    return { ok: false, reason: 'unsupported' };
  }
  if (Notification.permission === 'granted') {
    setNotifyPref(true);
    return { ok: true, reason: 'granted' };
  }
  if (Notification.permission === 'denied') {
    setNotifyPref(false);
    return { ok: false, reason: 'denied' };
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    setNotifyPref(true);
    return { ok: true, reason: 'granted' };
  }
  setNotifyPref(false);
  return { ok: false, reason: result };
}

export function disableNotifications() {
  setNotifyPref(false);
  clearTitleFlash();
  document.title = BASE_TITLE;
}

function loadSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  const list = [...set].slice(-80);
  localStorage.setItem(SEEN_KEY, JSON.stringify(list));
}

export function markUrgentSeen(ids) {
  const seen = loadSeen();
  ids.forEach((id) => seen.add(String(id)));
  saveSeen(seen);
}

/**
 * Notify for urgent absences the student hasn't been alerted about yet.
 * @param {Array} urgentItems absences already filtered to batch + urgent + today
 * @param {{ force?: boolean }} opts
 */
export function notifyNewUrgent(urgentItems, opts = {}) {
  if (!urgentItems?.length) {
    clearTitleFlash();
    if (document.title.startsWith('⚠️')) document.title = BASE_TITLE;
    return;
  }

  const seen = loadSeen();
  const fresh = urgentItems.filter((a) => a.id && !seen.has(String(a.id)));
  if (!fresh.length && !opts.force) {
    // Still keep banner; title flash if tab hidden and any urgent today
    if (document.hidden) startTitleFlash(urgentItems.length);
    return;
  }

  const toAlert = fresh.length ? fresh : opts.force ? urgentItems : [];
  if (!toAlert.length) return;

  toAlert.forEach((a) => seen.add(String(a.id)));
  saveSeen(seen);

  const prefOn = getNotifyPref() && permissionState() === 'granted';
  if (prefOn) {
    toAlert.forEach((a) => showBrowserNotification(a));
  }

  if (document.hidden) {
    startTitleFlash(urgentItems.length);
  } else if (fresh.length) {
    // Soft in-page cue handled by caller toast
  }
}

function showBrowserNotification(absence) {
  try {
    const title = '⚠️ Urgent class alert';
    const body = `${absence.teacher} — ${absence.subject} (${absence.batch})`;
    const n = new Notification(title, {
      body,
      tag: `urgent-${absence.id}`,
      renotify: true,
      requireInteraction: true
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (err) {
    console.warn('Notification failed', err);
  }
}

export function startTitleFlash(count) {
  clearTitleFlash();
  const alertTitle = count > 1 ? `⚠️ ${count} urgent alerts` : '⚠️ Urgent alert';
  titleTimer = setInterval(() => {
    titleOn = !titleOn;
    document.title = titleOn ? alertTitle : BASE_TITLE;
  }, 1200);
}

export function clearTitleFlash() {
  if (titleTimer) {
    clearInterval(titleTimer);
    titleTimer = null;
  }
  titleOn = false;
}

export function setupVisibilityTitleReset() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clearTitleFlash();
      document.title = BASE_TITLE;
    }
  });
}

/** Map a realtime INSERT payload row into our absence shape if possible. */
export function absenceFromRealtime(payload) {
  const row = payload?.new;
  if (!row) return null;
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
