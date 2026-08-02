/**
 * Campus Hub — main app: batch selection, tabs, absences, chat, feedback, auth, theme.
 */

import {
  getSelectedBatch,
  setSelectedBatch,
  clearSelectedBatch,
  getTheme,
  setTheme
} from './storage.js';
import {
  getAbsencesForBatch,
  getUrgentForBatch,
  publishAbsence,
  formatAbsenceLine,
  formatDisplayDate,
  toISODate,
  seedDemoAbsencesIfEmpty,
  subscribeAbsences
} from './absences.js';
import { createTimetableAssistant } from './chatbot.js';
import {
  listFeedback,
  submitFeedback,
  upvoteFeedback,
  flagFeedback,
  formatRelativeTime,
  subscribeFeedback
} from './feedback.js';
import { STAFF_PASSWORD, STAFF_SESSION_KEY } from './config.js';
import { cloudEnabled } from './db.js';
import {
  enableNotifications,
  disableNotifications,
  getNotifyPref,
  permissionState,
  notificationsSupported,
  notifyNewUrgent,
  setupVisibilityTitleReset,
  absenceFromRealtime,
  markUrgentSeen
} from './notify.js';

const BATCHES = ['A Level Batch 2', 'Batch A', 'Batch B', 'Grade 10', 'Grade 11'];

const els = {
  landing: document.getElementById('batch-landing'),
  shell: document.getElementById('app-shell'),
  batchGrid: document.getElementById('batch-grid'),
  batchSelect: document.getElementById('batch-select'),
  batchContinue: document.getElementById('batch-continue'),
  batchBadge: document.getElementById('batch-badge'),
  changeBatch: document.getElementById('change-batch-btn'),
  urgentBanner: document.getElementById('urgent-banner'),
  absenceList: document.getElementById('absence-list'),
  absenceEmpty: document.getElementById('absence-empty'),
  chatMessages: document.getElementById('chat-messages'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  timetableForm: document.getElementById('timetable-form'),
  ttDayOptions: document.getElementById('tt-day-options'),
  ttDayFieldset: document.getElementById('tt-day-fieldset'),
  ttAnyDayWrap: document.getElementById('tt-any-day-wrap'),
  ttSubjectFieldset: document.getElementById('tt-subject-fieldset'),
  ttSubject: document.getElementById('tt-subject'),
  ttReset: document.getElementById('tt-reset'),
  ttResults: document.getElementById('tt-results'),
  ttResultsTitle: document.getElementById('tt-results-title'),
  ttResultsList: document.getElementById('tt-results-list'),
  ttResultsEmpty: document.getElementById('tt-results-empty'),
  feedbackForm: document.getElementById('feedback-form'),
  feedbackFeed: document.getElementById('feedback-feed'),
  feedbackEmpty: document.getElementById('feedback-empty'),
  feedbackLocked: document.getElementById('feedback-locked'),
  feedbackUnlocked: document.getElementById('feedback-unlocked'),
  unlockFeedBtn: document.getElementById('unlock-feed-btn'),
  adminBtn: document.getElementById('admin-toggle-btn'),
  staffLockBtn: document.getElementById('staff-lock-btn'),
  adminModal: document.getElementById('admin-modal'),
  authModal: document.getElementById('auth-modal'),
  authForm: document.getElementById('auth-form'),
  authError: document.getElementById('auth-error'),
  authDesc: document.getElementById('auth-modal-desc'),
  staffPassword: document.getElementById('staff-password'),
  absenceForm: document.getElementById('absence-form'),
  absBatch: document.getElementById('abs-batch'),
  absDate: document.getElementById('abs-date'),
  toast: document.getElementById('toast'),
  themeToggle: document.getElementById('theme-toggle'),
  themeToggleLanding: document.getElementById('theme-toggle-landing')
};

let selectedDraft = '';
let currentBatch = '';
let timetables = {};
let bot = null;
let toastTimer = null;
/** @type {null | 'publish' | 'feedback'} */
let pendingAuthAction = null;
let unsubAbsences = null;
let unsubFeedback = null;

init();

async function init() {
  setupTheme();
  seedDemoAbsencesIfEmpty(BATCHES);
  updateCloudBadge();
  await loadTimetables();
  setupBatchLanding();
  setupTabs();
  setupAuth();
  setupAdminModal();
  setupTimetableAssistant();
  setupFeedback();
  setupLiveSync();
  setupFlashyFx();
  setupNotifyUi();
  setupVisibilityTitleReset();
  updateStaffUi();

  const saved = getSelectedBatch();
  if (saved && BATCHES.includes(saved)) {
    enterApp(saved, { silent: true });
  } else {
    showLanding();
  }
}

function updateCloudBadge() {
  const el = document.getElementById('cloud-status');
  if (!el) return;
  if (cloudEnabled) {
    el.hidden = false;
    el.classList.remove('hidden', 'cloud-status--warn');
    el.classList.add('cloud-status--live');
    el.textContent = '● Live sync on';
  } else {
    el.hidden = false;
    el.classList.remove('hidden', 'cloud-status--live');
    el.classList.add('cloud-status--warn');
    el.textContent = '○ Local only — add Supabase keys to sync school-wide';
  }
}

function setupLiveSync() {
  if (unsubAbsences) unsubAbsences();
  if (unsubFeedback) unsubFeedback();
  unsubAbsences = subscribeAbsences((payload) => {
    if (currentBatch) renderAbsences({ fromRealtime: true, payload });
  });
  unsubFeedback = subscribeFeedback(() => {
    if (isStaffUnlocked()) renderFeedback();
  });
}

function setupNotifyUi() {
  const btn = document.getElementById('notify-toggle-btn');
  const hint = document.getElementById('notify-hint');
  if (!btn) return;

  const refresh = () => {
    if (!notificationsSupported()) {
      btn.disabled = true;
      btn.textContent = 'Alerts unsupported';
      if (hint) hint.textContent = 'This browser does not support notifications.';
      return;
    }
    const perm = permissionState();
    const on = getNotifyPref() && perm === 'granted';
    btn.classList.toggle('notify-btn--on', on);
    if (perm === 'denied') {
      btn.textContent = 'Alerts blocked';
      if (hint) {
        hint.textContent =
          'Notifications are blocked. Allow them in your browser site settings, then tap again.';
      }
    } else if (on) {
      btn.textContent = 'Alerts on';
      if (hint) {
        hint.textContent =
          'You’ll get a pop-up for urgent cancellations in your batch while Campus Hub is open (even in a background tab).';
      }
    } else {
      btn.textContent = 'Enable alerts';
      if (hint) {
        hint.textContent =
          'Turn on alerts to get a pop-up when an urgent cancellation is posted for your batch.';
      }
    }
  };

  btn.addEventListener('click', async () => {
    const perm = permissionState();
    if (getNotifyPref() && perm === 'granted') {
      disableNotifications();
      showToast('Alerts turned off');
      refresh();
      return;
    }
    const result = await enableNotifications();
    if (result.ok) {
      showToast('Urgent alerts enabled');
      // Re-check current urgents so permission + first notify can work
      if (currentBatch) renderAbsences({ announce: true });
    } else if (result.reason === 'denied') {
      showToast('Allow notifications in browser settings');
    } else if (result.reason === 'unsupported') {
      showToast('Notifications not supported here');
    } else {
      showToast('Could not enable alerts');
    }
    refresh();
  });

  refresh();
}

async function loadTimetables() {
  try {
    const res = await fetch('data/timetables.json', { cache: 'no-store' });
    if (res.ok) {
      timetables = await res.json();
    }
  } catch {
    timetables = Object.fromEntries(
      BATCHES.map((b) => [
        b,
        { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
      ])
    );
  }
}

/* —— Theme —— */

function setupTheme() {
  const saved = getTheme();
  if (saved === 'dark' || saved === 'light') {
    applyTheme(saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme('dark');
  } else {
    applyTheme('light');
  }

  const toggle = (e) => {
    const btn = e.currentTarget;
    btn.classList.remove('is-spinning');
    void btn.offsetWidth;
    btn.classList.add('is-spinning');
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  els.themeToggle?.addEventListener('click', toggle);
  els.themeToggleLanding?.addEventListener('click', toggle);
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  [els.themeToggle, els.themeToggleLanding].forEach((btn) => {
    if (!btn) return;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  });
}

/* —— Staff auth —— */

function isStaffUnlocked() {
  return sessionStorage.getItem(STAFF_SESSION_KEY) === '1';
}

function setStaffUnlocked(on) {
  if (on) sessionStorage.setItem(STAFF_SESSION_KEY, '1');
  else sessionStorage.removeItem(STAFF_SESSION_KEY);
  updateStaffUi();
  updateFeedbackGate();
}

function updateStaffUi() {
  const unlocked = isStaffUnlocked();
  if (els.staffLockBtn) {
    els.staffLockBtn.classList.toggle('hidden', !unlocked);
  }
  if (els.unlockFeedBtn) {
    els.unlockFeedBtn.textContent = unlocked ? 'Staff unlocked' : 'Unlock with staff password';
    els.unlockFeedBtn.disabled = unlocked;
    els.unlockFeedBtn.classList.toggle('opacity-60', unlocked);
  }
}

function setupAuth() {
  els.authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = els.staffPassword.value;
    if (entered === STAFF_PASSWORD) {
      setStaffUnlocked(true);
      closeAuthModal();
      showToast('Staff access unlocked');
      const action = pendingAuthAction;
      pendingAuthAction = null;
      if (action === 'publish') openAdminModal();
      if (action === 'feedback') updateFeedbackGate();
    } else {
      els.authError.classList.remove('hidden');
      els.staffPassword.select();
    }
  });

  els.authModal.querySelectorAll('[data-close-auth]').forEach((el) => {
    el.addEventListener('click', () => {
      pendingAuthAction = null;
      closeAuthModal();
    });
  });

  els.staffLockBtn?.addEventListener('click', () => {
    setStaffUnlocked(false);
    showToast('Staff session locked');
  });

  els.unlockFeedBtn?.addEventListener('click', () => {
    if (isStaffUnlocked()) return;
    requireStaff('feedback', 'Enter the staff password to view the feedback feed.');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.authModal.hidden) {
      pendingAuthAction = null;
      closeAuthModal();
    } else if (!els.adminModal.hidden) {
      closeAdminModal();
    }
  });
}

function requireStaff(action, description) {
  if (isStaffUnlocked()) {
    if (action === 'publish') openAdminModal();
    if (action === 'feedback') updateFeedbackGate();
    return;
  }
  pendingAuthAction = action;
  els.authDesc.textContent = description;
  els.authError.classList.add('hidden');
  els.authForm.reset();
  els.authModal.hidden = false;
  els.authModal.classList.remove('hidden');
  els.staffPassword.focus();
}

function closeAuthModal() {
  els.authModal.hidden = true;
  els.authModal.classList.add('hidden');
  els.authError.classList.add('hidden');
  els.authForm.reset();
}

function updateFeedbackGate() {
  const unlocked = isStaffUnlocked();
  if (els.feedbackLocked) {
    els.feedbackLocked.classList.toggle('hidden', unlocked);
    els.feedbackLocked.hidden = unlocked;
  }
  if (els.feedbackUnlocked) {
    els.feedbackUnlocked.classList.toggle('hidden', !unlocked);
    els.feedbackUnlocked.hidden = !unlocked;
  }
  if (unlocked) renderFeedback();
}

/* —— Batch landing —— */

function setupBatchLanding() {
  els.batchGrid.innerHTML = '';
  els.batchSelect.innerHTML = '<option value="">Or pick from list…</option>';

  BATCHES.forEach((batch) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'batch-card';
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', 'false');
    card.dataset.batch = batch;
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <span class="font-display text-lg font-semibold text-ink-900 dark:text-white">${escapeHtml(batch)}</span>
          <span class="block mt-1 text-sm text-ink-700/65 dark:text-ink-200/65">Absences · timetable · feedback</span>
        </div>
        <span class="batch-arrow" aria-hidden="true">→</span>
      </div>
    `;
    card.addEventListener('click', () => selectDraft(batch));
    els.batchGrid.appendChild(card);

    const opt = document.createElement('option');
    opt.value = batch;
    opt.textContent = batch;
    els.batchSelect.appendChild(opt);
  });

  els.batchSelect.addEventListener('change', () => {
    if (els.batchSelect.value) selectDraft(els.batchSelect.value);
  });

  els.batchContinue.addEventListener('click', () => {
    if (!selectedDraft) return;
    setSelectedBatch(selectedDraft);
    enterApp(selectedDraft, { burst: true });
  });

  els.changeBatch.addEventListener('click', () => {
    clearSelectedBatch();
    showLanding();
  });
}

function selectDraft(batch) {
  selectedDraft = batch;
  els.batchSelect.value = batch;
  els.batchContinue.disabled = false;
  els.batchGrid.querySelectorAll('.batch-card').forEach((card) => {
    const on = card.dataset.batch === batch;
    card.classList.toggle('selected', on);
    card.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function showLanding() {
  els.shell.hidden = true;
  els.landing.hidden = false;
  els.landing.classList.remove('landing-exit');
  if (els.themeToggleLanding) els.themeToggleLanding.classList.remove('hidden');
  selectedDraft = '';
  els.batchContinue.disabled = true;
  els.batchSelect.value = '';
  els.batchGrid.querySelectorAll('.batch-card').forEach((c) => {
    c.classList.remove('selected');
    c.setAttribute('aria-selected', 'false');
  });
}

function enterApp(batch, opts = {}) {
  currentBatch = batch;
  setSelectedBatch(batch);

  const finish = () => {
    els.landing.hidden = true;
    els.landing.classList.remove('landing-exit');
    els.shell.hidden = false;
    els.shell.classList.remove('is-entering');
    void els.shell.offsetWidth;
    els.shell.classList.add('is-entering');
    if (els.themeToggleLanding) els.themeToggleLanding.classList.add('hidden');
    els.batchBadge.textContent = batch;
    bot = createTimetableAssistant(timetables, batch);
    refreshTimetableControls();
    clearTimetableResults();
    renderAbsences();
    updateFeedbackGate();
    switchTab('absences');
    requestAnimationFrame(() => moveTabInk());
  };

  if (opts.burst) spawnBurst();

  if (!opts.silent && !els.landing.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.landing.classList.add('landing-exit');
    setTimeout(finish, 320);
  } else {
    finish();
  }
}

/* —— Tabs —— */

function setupTabs() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const header = document.querySelector('.app-header');
  if (header) {
    window.addEventListener(
      'scroll',
      () => {
        header.classList.toggle('scrolled', window.scrollY > 8);
      },
      { passive: true }
    );
  }

  window.addEventListener('resize', () => moveTabInk(), { passive: true });
}

function switchTab(name) {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.classList.toggle('tab-active', on);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const on = panel.id === `panel-${name}`;
    panel.classList.toggle('hidden', !on);
    panel.hidden = !on;
    if (on) {
      panel.style.animation = 'none';
      void panel.offsetWidth;
      panel.style.animation = '';
    }
  });
  moveTabInk();
}

function moveTabInk() {
  const ink = document.getElementById('tab-ink');
  const active = document.querySelector('.tab-btn.tab-active');
  const nav = document.querySelector('.tab-nav');
  if (!ink || !active || !nav || nav.closest('#app-shell')?.hidden) return;
  const width = active.offsetWidth * 0.55;
  ink.style.width = `${width}px`;
  ink.style.left = `${active.offsetLeft + (active.offsetWidth - width) / 2}px`;
}

/* —— Absences —— */

function renderAbsences(opts = {}) {
  if (!currentBatch || !els.absenceList) return;
  if (!opts.fromRealtime) {
    els.absenceList.innerHTML = `<p class="text-sm text-ink-700/60 dark:text-ink-200/60 px-1">Loading alerts…</p>`;
  }

  Promise.all([getAbsencesForBatch(currentBatch), getUrgentForBatch(currentBatch)])
    .then(([items, urgent]) => {
      if (urgent.length) {
        els.urgentBanner.hidden = false;
        els.urgentBanner.classList.remove('hidden');
        els.urgentBanner.innerHTML = urgent
          .map(
            (a) => `
      <div class="urgent-banner-inner mb-2 last:mb-0">
        <span class="text-lg" aria-hidden="true">⚠️</span>
        <div>
          <p class="font-semibold text-coral-600 text-sm uppercase tracking-wide">Urgent cancellation</p>
          <p class="text-ink-800 dark:text-ink-100 font-medium mt-0.5">${escapeHtml(formatAbsenceLine(a))}</p>
          ${a.cover ? `<p class="text-sm text-ink-700/75 dark:text-ink-200/75 mt-1">${escapeHtml(a.cover)}</p>` : ''}
        </div>
      </div>`
          )
          .join('');
      } else {
        els.urgentBanner.hidden = true;
        els.urgentBanner.classList.add('hidden');
        els.urgentBanner.innerHTML = '';
      }

      els.absenceList.innerHTML = '';
      if (!items.length) {
        els.absenceEmpty.classList.remove('hidden');
      } else {
        els.absenceEmpty.classList.add('hidden');
        items.forEach((a) => {
          const card = document.createElement('article');
          card.className = `alert-card${a.urgent ? ' urgent' : ''}`;
          card.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 class="font-semibold text-ink-900 dark:text-white">${escapeHtml(a.teacher)} · ${escapeHtml(a.subject)}</h3>
          <p class="text-sm text-ink-700/70 dark:text-ink-200/70 mt-0.5">${escapeHtml(a.batch)} · Absent on ${escapeHtml(formatDisplayDate(a.date))}</p>
        </div>
        ${a.urgent ? '<span class="rounded-md bg-coral-500/10 px-2 py-0.5 text-xs font-bold text-coral-600">URGENT</span>' : ''}
      </div>
      ${a.cover ? `<p class="mt-2 text-sm text-ink-700 dark:text-ink-200 border-t border-ink-100 dark:border-ink-700 pt-2">${escapeHtml(a.cover)}</p>` : ''}
    `;
          els.absenceList.appendChild(card);
        });
      }

      // Realtime urgent for this batch → notify immediately
      if (opts.fromRealtime && opts.payload?.eventType === 'INSERT') {
        const incoming = absenceFromRealtime(opts.payload);
        if (
          incoming &&
          incoming.urgent &&
          incoming.batch === currentBatch &&
          incoming.date === toISODate(new Date())
        ) {
          notifyNewUrgent([incoming]);
          if (getNotifyPref() && permissionState() === 'granted') {
            showToast(`Urgent: ${incoming.teacher} — ${incoming.subject}`);
          } else {
            showToast('New urgent alert for your batch');
          }
          return;
        }
      }

      // Normal load: alert only on unseen urgents (or after enabling alerts)
      if (opts.announce) {
        notifyNewUrgent(urgent, { force: true });
      } else if (!opts.fromRealtime) {
        // First paint after open: mark existing as seen so we don't spam, but flash title if tab hidden
        if (urgent.length) {
          markUrgentSeen(urgent.map((u) => u.id));
          if (document.hidden) notifyNewUrgent(urgent, { force: true });
        }
      } else {
        notifyNewUrgent(urgent);
      }
    })
    .catch((err) => {
      console.error(err);
      els.absenceList.innerHTML = '';
      els.absenceEmpty.classList.remove('hidden');
      els.absenceEmpty.textContent = 'Could not load absences. Check your Supabase setup.';
      showToast('Failed to load absences');
    });
}

/* —— Admin modal —— */

function setupAdminModal() {
  BATCHES.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    els.absBatch.appendChild(opt);
  });

  els.adminBtn.addEventListener('click', () => {
    requireStaff('publish', 'Enter the staff password to publish absence notices.');
  });

  els.adminModal.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeAdminModal);
  });

  els.absenceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isStaffUnlocked()) {
      showToast('Staff password required');
      requireStaff('publish', 'Enter the staff password to publish absence notices.');
      return;
    }
    try {
      // 1. Get values from the inputs
      const teacher = document.getElementById('abs-teacher').value;
      const subject = document.getElementById('abs-subject').value;
      const batch = document.getElementById('abs-batch').value;
      const date = document.getElementById('abs-date').value;
      const cover = document.getElementById('abs-cover').value;
      const urgent = document.getElementById('abs-urgent').checked;

      // 2. Publish to Supabase
      await publishAbsence({
        teacher,
        subject,
        batch,
        date,
        cover,
        urgent
      });

      // 🚨 ADD THIS LINE RIGHT HERE:
      triggerDiscordAlert(teacher, batch, date, cover);

      closeAdminModal();
      els.absenceForm.reset();
      showToast(cloudEnabled ? 'Published for everyone' : 'Saved on this device only');
      if (currentBatch) renderAbsences();
    } catch (err) {
      console.error(err);
      showToast('Publish failed — check Supabase setup');
    }
  });
}

  els.absenceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isStaffUnlocked()) {
      showToast('Staff password required');
      requireStaff('publish', 'Enter the staff password to publish absence notices.');
      return;
    }
    try {
      await publishAbsence({
        teacher: document.getElementById('abs-teacher').value,
        subject: document.getElementById('abs-subject').value,
        batch: document.getElementById('abs-batch').value,
        date: document.getElementById('abs-date').value,
        cover: document.getElementById('abs-cover').value,
        urgent: document.getElementById('abs-urgent').checked
      });
      closeAdminModal();
      els.absenceForm.reset();
      showToast(cloudEnabled ? 'Published for everyone' : 'Saved on this device only');
      if (currentBatch) renderAbsences();
    } catch (err) {
      console.error(err);
      showToast('Publish failed — check Supabase setup');
    }
  });
}

function openAdminModal() {
  els.absDate.value = toISODate(new Date());
  if (currentBatch) els.absBatch.value = currentBatch;
  els.adminModal.hidden = false;
  els.adminModal.classList.remove('hidden');
  document.getElementById('abs-teacher').focus();
}

function closeAdminModal() {
  els.adminModal.hidden = true;
  els.adminModal.classList.add('hidden');
}

/* —— Timetable assistant (structured picks, no typing) —— */

function setupTimetableAssistant() {
  if (!els.timetableForm) return;

  els.timetableForm.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.name === 'tt-mode') syncTimetableModeUi();
  });

  els.timetableForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runTimetableQuery();
  });

  els.ttReset?.addEventListener('click', () => {
    const dayRadio = els.timetableForm.querySelector('input[name="tt-mode"][value="day"]');
    if (dayRadio) dayRadio.checked = true;
    const today = els.timetableForm.querySelector('input[name="tt-day"][value="today"]');
    if (today) today.checked = true;
    if (els.ttSubject) els.ttSubject.value = '';
    syncTimetableModeUi();
    clearTimetableResults();
  });
}

function refreshTimetableControls() {
  if (!bot || !els.ttDayOptions) return;

  const dayChoices = bot.getDayChoices();
  els.ttDayOptions.innerHTML = dayChoices
    .map(
      (d, i) => `
    <label class="choice-chip day-chip">
      <input type="radio" name="tt-day" value="${escapeHtml(d.value)}" ${i === 0 ? 'checked' : ''} />
      <span class="day-label-full">${escapeHtml(d.label)}</span>
      <span class="day-label-short">${escapeHtml(d.short || d.label)}</span>
    </label>`
    )
    .join('');

  const subjects = bot.getSubjectChoices();
  if (els.ttSubject) {
    els.ttSubject.innerHTML =
      '<option value="">Select a subject…</option>' +
      subjects.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }

  syncTimetableModeUi();
}

function syncTimetableModeUi() {
  const mode = els.timetableForm?.querySelector('input[name="tt-mode"]:checked')?.value || 'day';
  const subjectMode = mode === 'subject';
  const showDay = mode === 'day' || mode === 'subject';

  if (els.ttDayFieldset) {
    els.ttDayFieldset.classList.toggle('hidden', !showDay);
    els.ttDayFieldset.hidden = !showDay;
  }

  if (els.ttSubjectFieldset) {
    els.ttSubjectFieldset.classList.toggle('hidden', !subjectMode);
    els.ttSubjectFieldset.hidden = !subjectMode;
    if (els.ttSubject) els.ttSubject.required = subjectMode;
  }

  if (els.ttAnyDayWrap) {
    els.ttAnyDayWrap.classList.toggle('hidden', !subjectMode);
    els.ttAnyDayWrap.hidden = !subjectMode;
  }

  // If leaving subject mode while "any" was selected, fall back to today
  if (!subjectMode) {
    const any = els.timetableForm?.querySelector('input[name="tt-day"][value="any"]');
    if (any?.checked) {
      const today = els.timetableForm.querySelector('input[name="tt-day"][value="today"]');
      if (today) today.checked = true;
    }
  }
}

function runTimetableQuery() {
  if (!bot) return;
  const mode = els.timetableForm.querySelector('input[name="tt-mode"]:checked')?.value || 'day';
  const dayValue = els.timetableForm.querySelector('input[name="tt-day"]:checked')?.value || 'today';
  const subject = els.ttSubject?.value || '';

  if (mode === 'subject' && !subject) {
    showToast('Select a subject first');
    els.ttSubject?.focus();
    return;
  }

  const result = bot.query({ mode, dayValue, subject });
  renderTimetableResults(result);
}

function renderTimetableResults(result) {
  els.ttResults.hidden = false;
  els.ttResults.classList.remove('hidden');
  els.ttResults.classList.remove('is-visible');
  void els.ttResults.offsetWidth;
  els.ttResults.classList.add('is-visible');
  els.ttResultsTitle.textContent = result.title || 'Results';
  els.ttResultsList.innerHTML = '';

  let delay = 0;
  const stampDelay = (el) => {
    el.style.animationDelay = `${delay}s`;
    delay += 0.04;
  };

  if (result.sections?.length) {
    els.ttResultsEmpty.classList.add('hidden');
    result.sections.forEach((section) => {
      const heading = document.createElement('li');
      heading.className = 'tt-result-day';
      heading.textContent = section.day;
      stampDelay(heading);
      els.ttResultsList.appendChild(heading);
      section.lines.forEach((line) => {
        const li = document.createElement('li');
        li.className = 'tt-result-row';
        li.textContent = line;
        stampDelay(li);
        els.ttResultsList.appendChild(li);
      });
    });
    return;
  }

  const looksEmpty =
    result.empty ||
    !result.lines?.length ||
    result.lines.every((l) => /no .+|enjoy the break|select a subject|no timetable/i.test(l));

  if (looksEmpty) {
    els.ttResultsEmpty.classList.remove('hidden');
    els.ttResultsEmpty.textContent = result.lines?.[0] || 'Nothing found for that selection.';
    return;
  }

  els.ttResultsEmpty.classList.add('hidden');
  result.lines.forEach((line) => {
    const li = document.createElement('li');
    li.className = 'tt-result-row';
    li.textContent = line;
    stampDelay(li);
    els.ttResultsList.appendChild(li);
  });
}

function clearTimetableResults() {
  if (!els.ttResults) return;
  els.ttResults.hidden = true;
  els.ttResults.classList.add('hidden');
  els.ttResultsList.innerHTML = '';
  els.ttResultsEmpty.classList.add('hidden');
  els.ttResultsTitle.textContent = '';
}

/* —— Feedback —— */

function setupFeedback() {
  els.feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = document.getElementById('feedback-category').value;
    const message = document.getElementById('feedback-message').value;
    if (!category || !message.trim()) return;
    try {
      await submitFeedback({ category, message });
      els.feedbackForm.reset();
      showToast(cloudEnabled ? 'Posted for staff to review' : 'Saved on this device only');
      if (isStaffUnlocked()) renderFeedback();
    } catch (err) {
      console.error(err);
      showToast('Submit failed — check Supabase setup');
    }
  });
}

function renderFeedback() {
  if (!isStaffUnlocked()) return;
  els.feedbackFeed.innerHTML = `<p class="text-sm text-ink-700/60 dark:text-ink-200/60">Loading feedback…</p>`;

  listFeedback()
    .then((items) => {
      els.feedbackFeed.innerHTML = '';
      if (!items.length) {
        els.feedbackEmpty.classList.remove('hidden');
        return;
      }
      els.feedbackEmpty.classList.add('hidden');

      items.forEach((f) => {
        const hueBg = document.documentElement.classList.contains('dark')
          ? `hsl(${f.avatarHue} 35% 22%)`
          : `hsl(${f.avatarHue} 45% 90%)`;
        const card = document.createElement('article');
        card.className = 'feedback-card';
        card.innerHTML = `
      <div class="flex gap-3">
        <div class="avatar-badge" style="background: ${hueBg}" aria-hidden="true">${f.avatarEmoji}</div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-semibold text-ink-900 dark:text-white">${escapeHtml(f.avatarLabel)}</span>
            <span class="rounded-md bg-ink-100 dark:bg-ink-700 px-2 py-0.5 text-xs font-semibold text-ink-700 dark:text-ink-100">${escapeHtml(f.category)}</span>
            <time class="text-xs text-ink-700/50 dark:text-ink-200/50" datetime="${escapeHtml(f.createdAt)}">${escapeHtml(formatRelativeTime(f.createdAt))}</time>
          </div>
          <p class="mt-2 text-ink-800 dark:text-ink-100 whitespace-pre-wrap">${escapeHtml(f.message)}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="action-btn${f.votedLocal ? ' active' : ''}" data-upvote="${escapeHtml(f.id)}" aria-pressed="${f.votedLocal ? 'true' : 'false'}">
              ▲ Upvote <span>${f.upvotes || 0}</span>
            </button>
            <button type="button" class="action-btn${f.flagged ? ' flagged' : ''}" data-flag="${escapeHtml(f.id)}" aria-pressed="${f.flagged ? 'true' : 'false'}">
              ⚑ ${f.flagged ? 'Flagged' : 'Flag'}
            </button>
          </div>
        </div>
      </div>
    `;
        els.feedbackFeed.appendChild(card);
      });

      els.feedbackFeed.querySelectorAll('[data-upvote]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await upvoteFeedback(btn.dataset.upvote);
            renderFeedback();
          } catch (err) {
            console.error(err);
            showToast('Vote failed');
          }
        });
      });
      els.feedbackFeed.querySelectorAll('[data-flag]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await flagFeedback(btn.dataset.flag);
            renderFeedback();
          } catch (err) {
            console.error(err);
            showToast('Flag failed');
          }
        });
      });
    })
    .catch((err) => {
      console.error(err);
      els.feedbackFeed.innerHTML = '';
      els.feedbackEmpty.classList.remove('hidden');
      els.feedbackEmpty.textContent = 'Could not load feedback. Check your Supabase setup.';
    });
}

/* —— Utils —— */

function setupFlashyFx() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.addEventListener(
    'click',
    (e) => {
      const host = e.target.closest(
        '.btn-primary, .batch-card, .choice-chip, .tab-btn, .action-btn, #admin-toggle-btn, #unlock-feed-btn, #batch-continue'
      );
      if (!host) return;
      spawnRipple(host, e);
    },
    true
  );
}

function spawnRipple(host, event) {
  host.classList.add('ripple-host');
  const rect = host.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = (event.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (event.clientY || rect.top + rect.height / 2) - rect.top - size / 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  if (!host.classList.contains('btn-primary') && !host.classList.contains('tab-btn')) {
    ripple.classList.add('ripple-dark');
  }
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  host.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
}

function spawnBurst() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.getElementById('fx-burst');
  if (!layer) return;
  const colors = ['#3da86e', '#f0b429', '#e85d4c', '#5fbf8a', '#2f8a58'];
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.42;
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('span');
    p.className = 'fx-particle';
    const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
    const dist = 80 + Math.random() * 140;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
    p.style.width = p.style.height = `${6 + Math.random() * 7}px`;
    layer.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  els.toast.classList.remove('show');
  void els.toast.offsetWidth;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.add('hidden');
    els.toast.classList.remove('show');
  }, 2400);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}



// Adding the Discord Bot announcement function

const DISCORD_WEBHOOK_URL = "https://discordapp.com/api/webhooks/1533518199109451897/MMJrHFTN4orWUBqyWKauPj_kIZFISARFa6wIHsTfRR8eHtgauVslbBhQ9NOt_9HCaL_j"; 

async function triggerDiscordAlert(teacher, batch, date, notes) {
  // Check if webhook URL exists
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === "YOUR_DISCORD_WEBHOOK_URL_HERE") return;

  const payload = {
    username: "Campus Hub Alerts",
    avatar_url: "https://ascend-dashboard-six.vercel.app/favicon.ico",
    content: "@everyone 🚨 **New Teacher Absence Alert**",
    embeds: [
      {
        title: `Teacher Absence: ${teacher}`,
        description: `A new absence notice has been published for **Batch ${batch}**.`,
        color: 15548997,
        fields: [
          { name: "Batch", value: String(batch), inline: true },
          { name: "Date", value: String(date), inline: true },
          { name: "Notes / Details", value: notes || "No additional notes provided." }
        ],
        footer: {
          text: "Campus Hub • Ascend Dashboard"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("Failed to post alert to Discord:", err);
  }
}
