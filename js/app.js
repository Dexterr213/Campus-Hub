/**
 * Campus Hub — main app: batch selection, tabs, absences, timetable, auth.
 */

import {
  getSelectedBatch,
  setSelectedBatch,
  clearSelectedBatch
} from './storage.js';
import {
  getAbsencesForBatch,
  getUrgentForBatch,
  publishAbsence,
  updateAbsence,
  deleteAbsence,
  formatAbsenceLine,
  formatDisplayDate,
  toISODate,
  seedDemoAbsencesIfEmpty,
  subscribeAbsences
} from './absences.js';
import { createTimetableAssistant, formatSlot } from './chatbot.js';
import { STAFF_SESSION_KEY } from './config.js';
import { cloudEnabled } from './db.js';
import {
  loadMergedTimetables,
  saveTimetableDay,
  slotFingerprint,
  WEEKDAYS,
  TIME_SLOT_OPTIONS,
  nextAvailableTimeSlot
} from './timetables.js';
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

const BATCHES = ['A Level Batch 2'];

const els = {
  landing: document.getElementById('batch-picker'),
  shell: document.getElementById('app-shell'),
  batchGrid: document.getElementById('batch-grid'),
  batchBadge: document.getElementById('batch-badge'),
  batchHeading: document.getElementById('batch-heading'),
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
  ttReset: document.getElementById('tt-reset'),
  ttResults: document.getElementById('tt-results'),
  ttResultsTitle: document.getElementById('tt-results-title'),
  ttResultsList: document.getElementById('tt-results-list'),
  ttResultsEmpty: document.getElementById('tt-results-empty'),
  editTimetableBtn: document.getElementById('edit-timetable-btn'),
  ttEditModal: document.getElementById('tt-edit-modal'),
  ttEditForm: document.getElementById('tt-edit-form'),
  ttEditDay: document.getElementById('tt-edit-day'),
  ttEditSlots: document.getElementById('tt-edit-slots'),
  ttEditEmpty: document.getElementById('tt-edit-empty'),
  ttEditAddSlot: document.getElementById('tt-edit-add-slot'),
  ttEditBatchLabel: document.getElementById('tt-edit-batch-label'),
  ttEditSave: document.getElementById('tt-edit-save'),
  adminBtn: document.getElementById('admin-toggle-btn'),
  staffLockBtn: document.getElementById('staff-lock-btn'),
  adminModal: document.getElementById('admin-modal'),
  authModal: document.getElementById('auth-modal'),
  authForm: document.getElementById('auth-form'),
  authError: document.getElementById('auth-error'),
  authDesc: document.getElementById('auth-modal-desc'),
  staffPassword: document.getElementById('staff-password'),
  togglePassword: document.getElementById('toggle-password'),
  absenceForm: document.getElementById('absence-form'),
  absBatch: document.getElementById('abs-batch'),
  absDate: document.getElementById('abs-date'),
  absCover: document.getElementById('abs-cover'),
  absCoverOtherWrap: document.getElementById('abs-cover-other-wrap'),
  absCoverOther: document.getElementById('abs-cover-other'),
  toast: document.getElementById('toast')
};

let currentBatch = '';
let timetables = {};
let bot = null;
let toastTimer = null;
/** @type {null | 'publish' | 'edit-timetable'} */
let pendingAuthAction = null;
let unsubAbsences = null;
/** Staff password kept in memory only after /api/verify-staff succeeds. */
let staffPasswordSession = '';
/** @type {{ day: string, slots: object[] } | null} */
let ttEditDraft = null;
/** @type {string | null} */
let editingAbsenceId = null;

const COVER_PRESETS = [
  'Feeling Unwell',
  'Medical Appointment',
  'Personal / Family Emergency'
];

init();

async function init() {
  // Password is memory-only; clear stale unlock flags after refresh
  if (sessionStorage.getItem(STAFF_SESSION_KEY) === '1' && !staffPasswordSession) {
    sessionStorage.removeItem(STAFF_SESSION_KEY);
  }
  seedDemoAbsencesIfEmpty(BATCHES);
  updateCloudBadge();
  await loadTimetables();
  setupBatchLanding();
  setupTabs();
  setupAuth();
  setupAdminModal();
  setupTimetableAssistant();
  setupTimetableEditor();
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
  unsubAbsences = subscribeAbsences((payload) => {
    if (currentBatch) renderAbsences({ fromRealtime: true, payload });
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
    timetables = await loadMergedTimetables(BATCHES);
  } catch {
    timetables = Object.fromEntries(
      BATCHES.map((b) => [
        b,
        { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
      ])
    );
  }
}

function rebuildTimetableAssistant() {
  if (!currentBatch) {
    bot = null;
    return;
  }
  bot = createTimetableAssistant(timetables, currentBatch);
  refreshTimetableControls();
}

/* —— Staff auth —— */

function isStaffUnlocked() {
  return sessionStorage.getItem(STAFF_SESSION_KEY) === '1' && Boolean(staffPasswordSession);
}

function setStaffUnlocked(on, password = '') {
  if (on) {
    sessionStorage.setItem(STAFF_SESSION_KEY, '1');
    staffPasswordSession = password;
  } else {
    sessionStorage.removeItem(STAFF_SESSION_KEY);
    staffPasswordSession = '';
  }
  updateStaffUi();
}

function updateStaffUi() {
  const unlocked = isStaffUnlocked();
  if (els.staffLockBtn) {
    els.staffLockBtn.classList.toggle('hidden', !unlocked);
  }
  if (els.editTimetableBtn) {
    els.editTimetableBtn.classList.toggle('hidden', !unlocked);
    els.editTimetableBtn.hidden = !unlocked;
  }
  document.body.classList.toggle('staff-unlocked', unlocked);
  // Refresh cards so Edit/Delete appear immediately after unlock
  if (currentBatch) renderAbsences({ fromRealtime: true });
}

function setPasswordVisible(visible) {
  if (!els.staffPassword || !els.togglePassword) return;
  els.staffPassword.type = visible ? 'text' : 'password';
  els.togglePassword.setAttribute('aria-pressed', visible ? 'true' : 'false');
  els.togglePassword.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  const showIcon = els.togglePassword.querySelector('.password-icon-show');
  const hideIcon = els.togglePassword.querySelector('.password-icon-hide');
  showIcon?.classList.toggle('hidden', visible);
  hideIcon?.classList.toggle('hidden', !visible);
}

function setupAuth() {
  els.togglePassword?.addEventListener('click', () => {
    const showing = els.staffPassword.type === 'text';
    setPasswordVisible(!showing);
  });

  els.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entered = els.staffPassword.value;
    els.authError.classList.add('hidden');

    try {
      const res = await fetch('/api/verify-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: entered })
      });

      if (res.status === 401) {
        els.authError.classList.remove('hidden');
        els.staffPassword.select();
        showToast('Invalid staff password');
        return;
      }

      if (!res.ok) {
        showToast('Could not verify staff password (server error)');
        return;
      }

      const next = pendingAuthAction;
      pendingAuthAction = null;
      setStaffUnlocked(true, entered);
      closeAuthModal();
      showToast(
        next === 'publish'
          ? 'Staff unlocked — close Publish, then use Edit/Delete on cards'
          : 'Staff access unlocked'
      );
      if (next === 'publish') openAdminModal();
      if (next === 'edit-timetable') openTimetableEditor();
    } catch (err) {
      console.error(err);
      showToast('Staff verify failed — use the Vercel site URL');
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

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.authModal.hidden) {
      pendingAuthAction = null;
      closeAuthModal();
    } else if (els.ttEditModal && !els.ttEditModal.hidden) {
      closeTimetableEditor();
    } else if (!els.adminModal.hidden) {
      closeAdminModal();
    }
  });
}

function requireStaff(action, description) {
  if (isStaffUnlocked()) {
    if (action === 'publish') openAdminModal();
    if (action === 'edit-timetable') openTimetableEditor();
    return;
  }
  pendingAuthAction = action;
  if (els.authDesc) els.authDesc.textContent = description;
  els.authError.classList.add('hidden');
  els.authForm.reset();
  setPasswordVisible(false);
  els.authModal.hidden = false;
  els.authModal.classList.remove('hidden');
  els.staffPassword.focus();
}

function closeAuthModal() {
  els.authModal.hidden = true;
  els.authModal.classList.add('hidden');
  els.authError.classList.add('hidden');
  els.authForm.reset();
  setPasswordVisible(false);
}

/* —— Batch landing —— */

function setupBatchLanding() {
  if (!els.batchGrid) return;

  els.batchGrid.innerHTML = '';
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
          <span class="batch-card-title">${escapeHtml(batch)}</span>
          <span class="batch-card-sub">Absences · timetable</span>
        </div>
        <span class="batch-arrow" aria-hidden="true">→</span>
      </div>
    `;
    els.batchGrid.appendChild(card);
  });

  els.batchGrid.onclick = (e) => {
    const card = e.target.closest('.batch-card');
    if (!card || !els.batchGrid.contains(card)) return;
    const batch = card.dataset.batch;
    if (!batch) return;

    els.batchGrid.querySelectorAll('.batch-card').forEach((c) => {
      const on = c === card;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    setSelectedBatch(batch);
    enterApp(batch, { burst: true });
  };

  if (els.changeBatch) {
    els.changeBatch.onclick = () => {
      clearSelectedBatch();
      showLanding();
    };
  }
}

function showLanding() {
  document.body.classList.remove('has-batch');
  els.landing?.classList.remove('is-collapsed');
  els.shell.hidden = true;
  els.shell.classList.add('hidden');
  if (els.batchHeading) els.batchHeading.textContent = 'Pick your batch to jump in';
  els.batchGrid?.querySelectorAll('.batch-card').forEach((c) => {
    c.classList.remove('selected');
    c.setAttribute('aria-selected', 'false');
  });
  playLandingEntrance();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function playLandingEntrance() {
  const hero = document.querySelector('.landing-hero');
  if (!hero) return;
  hero.classList.remove('is-entered');
  void hero.offsetWidth;
  requestAnimationFrame(() => hero.classList.add('is-entered'));
}

function enterApp(batch, opts = {}) {
  currentBatch = batch;
  setSelectedBatch(batch);

  els.batchGrid.querySelectorAll('.batch-card').forEach((card) => {
    const on = card.dataset.batch === batch;
    card.classList.toggle('selected', on);
    card.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  if (els.batchHeading) els.batchHeading.textContent = `You’re in ${batch}`;
  els.batchBadge.textContent = batch;

  document.body.classList.add('has-batch');
  els.landing?.classList.add('is-collapsed');
  els.shell.hidden = false;
  els.shell.classList.remove('hidden');
  els.shell.classList.remove('is-entering');
  void els.shell.offsetWidth;
  els.shell.classList.add('is-entering');

  bot = createTimetableAssistant(timetables, batch);
  refreshTimetableControls();
  clearTimetableResults();
  renderAbsences();
  switchTab('absences');
  requestAnimationFrame(() => moveTabInk());

  if (opts.burst) spawnBurst();

  if (!opts.silent) {
    requestAnimationFrame(() => {
      els.shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

/* —— Tabs —— */

function setupTabs() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const header = document.querySelector('.app-toolbar');
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
  if (!ink || !active || !nav || els.shell?.hidden) return;
  const width = Math.max(28, active.offsetWidth * 0.45);
  ink.style.width = `${width}px`;
  ink.style.left = `${active.offsetLeft + (active.offsetWidth - width) / 2}px`;
}

/* —— Absences —— */

function renderAbsences(opts = {}) {
  if (!currentBatch || !els.absenceList) return;
  if (!opts.fromRealtime) {
    els.absenceList.innerHTML = `<p class="text-sm text-ascend-muted px-1">Loading alerts…</p>`;
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
          <p class="font-semibold text-ascend-accent text-sm uppercase tracking-wide">Urgent cancellation</p>
          <p class="text-ascend-soft font-medium mt-0.5">${escapeHtml(formatAbsenceLine(a))}</p>
          ${a.cover ? `<p class="text-sm text-ascend-muted mt-1">${escapeHtml(a.cover)}</p>` : ''}
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
          card.className = `alert-card${a.urgent ? ' is-urgent' : ''}`;
          card.dataset.absenceId = a.id;
          const cover = String(a.cover || '').trim();
          const staffOn = isStaffUnlocked();
          card.innerHTML = `
      <div class="alert-card-top">
        <div class="alert-card-heading">
          <h3 class="alert-card-title">${escapeHtml(a.teacher)}</h3>
          <p class="alert-card-subject">${escapeHtml(a.subject)}</p>
        </div>
        <span class="alert-status ${a.urgent ? 'alert-status--urgent' : 'alert-status--notice'}">${
          a.urgent ? 'Urgent' : 'Notice'
        }</span>
      </div>
      <div class="alert-card-meta">
        <span class="alert-meta-chip">${escapeHtml(a.batch)}</span>
        <span class="alert-meta-chip alert-meta-chip--date">Absent ${escapeHtml(formatDisplayDate(a.date))}</span>
      </div>
      <div class="alert-card-body">
        <p class="alert-body-label">Cover / reason</p>
        <p class="alert-body-text">${cover ? escapeHtml(cover) : 'No extra notes for this absence.'}</p>
      </div>
      <div class="alert-card-actions${staffOn ? ' is-visible' : ''}">
        <button type="button" class="alert-action-btn" data-absence-edit="${escapeHtml(a.id)}">Edit</button>
        <button type="button" class="alert-action-btn alert-action-btn--danger" data-absence-delete="${escapeHtml(a.id)}">Delete</button>
      </div>
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

function syncCoverOtherField() {
  const isOther = els.absCover?.value === '__other__';
  els.absCoverOtherWrap?.classList.toggle('hidden', !isOther);
  if (els.absCoverOther) {
    els.absCoverOther.required = isOther;
    if (!isOther) els.absCoverOther.value = '';
  }
}

function getCoverValue() {
  const selected = els.absCover?.value || '';
  if (selected === '__other__') {
    return String(els.absCoverOther?.value || '').trim();
  }
  return selected;
}

function setCoverFields(cover = '') {
  const value = String(cover || '').trim();
  if (!els.absCover) return;
  if (!value) {
    els.absCover.value = '';
    if (els.absCoverOther) els.absCoverOther.value = '';
  } else if (COVER_PRESETS.includes(value)) {
    els.absCover.value = value;
    if (els.absCoverOther) els.absCoverOther.value = '';
  } else {
    els.absCover.value = '__other__';
    if (els.absCoverOther) els.absCoverOther.value = value;
  }
  syncCoverOtherField();
}

function setAbsenceModalMode(mode) {
  const title = document.getElementById('admin-modal-title');
  const submitBtn = els.absenceForm?.querySelector('button[type="submit"]');
  if (mode === 'edit') {
    if (title) title.textContent = 'Edit absence notice';
    if (submitBtn) submitBtn.textContent = 'Save changes';
  } else {
    if (title) title.textContent = 'Publish absence notice';
    if (submitBtn) submitBtn.textContent = 'Publish';
  }
}

function setupAdminModal() {
  BATCHES.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    els.absBatch.appendChild(opt);
  });

  els.absCover?.addEventListener('change', syncCoverOtherField);

  els.adminBtn.addEventListener('click', () => {
    if (isStaffUnlocked() && currentBatch) {
      renderAbsences({ fromRealtime: true });
    }
    requireStaff('publish', 'Enter the staff password to publish absence notices.');
  });

  els.adminModal.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeAdminModal);
  });

  els.absenceList?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-absence-edit]');
    const deleteBtn = e.target.closest('[data-absence-delete]');
    if (!editBtn && !deleteBtn) return;

    if (!isStaffUnlocked() || !staffPasswordSession) {
      showToast('Staff password required');
      requireStaff('publish', 'Enter the staff password to manage absence notices.');
      return;
    }

    if (editBtn) {
      const id = editBtn.getAttribute('data-absence-edit');
      await openEditAbsenceModal(id);
      return;
    }

    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-absence-delete');
      await handleDeleteAbsence(id);
    }
  });

  els.absenceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isStaffUnlocked() || !staffPasswordSession) {
      showToast('Staff password required');
      requireStaff('publish', 'Enter the staff password to publish absence notices.');
      return;
    }

    const cover = getCoverValue();
    if (els.absCover?.value === '__other__' && !cover) {
      showToast('Please specify the cover reason');
      els.absCoverOther?.focus();
      return;
    }

    const teacher = document.getElementById('abs-teacher').value;
    const subject = document.getElementById('abs-subject').value;
    const batch = document.getElementById('abs-batch').value;
    const date = document.getElementById('abs-date').value;
    const urgent = document.getElementById('abs-urgent').checked;
    const isEdit = Boolean(editingAbsenceId);

    try {
      if (isEdit) {
        await updateAbsence({
          password: staffPasswordSession,
          id: editingAbsenceId,
          teacher,
          subject,
          batch,
          date,
          cover,
          urgent
        });
        closeAdminModal();
        showToast('Absence updated');
      } else {
        await publishAbsence({
          password: staffPasswordSession,
          teacher,
          subject,
          batch,
          date,
          cover,
          urgent
        });
        await triggerDiscordAlert({ teacher, subject, batch, date, notes: cover, urgent });
        closeAdminModal();
        showToast('Published for everyone');
      }
      if (currentBatch) renderAbsences();
    } catch (err) {
      console.error(err);
      if (err?.code === 'UNAUTHORIZED') {
        setStaffUnlocked(false);
        showToast('Invalid staff password');
        requireStaff('publish', 'Enter the staff password to manage absence notices.');
        return;
      }
      showToast(err?.message || (isEdit ? 'Update failed' : 'Publish failed — check Vercel env / Supabase'));
    }
  });
}

async function openEditAbsenceModal(id) {
  try {
    const items = await getAbsencesForBatch(currentBatch);
    const absence = items.find((a) => a.id === id);
    if (!absence) {
      showToast('Absence not found');
      return;
    }

    editingAbsenceId = absence.id;
    setAbsenceModalMode('edit');
    document.getElementById('abs-teacher').value = absence.teacher || '';
    document.getElementById('abs-subject').value = absence.subject || '';
    els.absBatch.value = absence.batch || currentBatch;
    els.absDate.value = absence.date || toISODate(new Date());
    document.getElementById('abs-urgent').checked = Boolean(absence.urgent);
    setCoverFields(absence.cover);

    els.adminModal.hidden = false;
    els.adminModal.classList.remove('hidden');
    document.getElementById('abs-teacher').focus();
  } catch (err) {
    console.error(err);
    showToast('Could not open absence for editing');
  }
}

async function handleDeleteAbsence(id) {
  const ok = window.confirm('Delete this absence notice? Students will no longer see it.');
  if (!ok) return;

  try {
    await deleteAbsence({ password: staffPasswordSession, id });
    showToast('Absence deleted');
    if (currentBatch) renderAbsences();
  } catch (err) {
    console.error(err);
    if (err?.code === 'UNAUTHORIZED') {
      setStaffUnlocked(false);
      showToast('Invalid staff password');
      requireStaff('publish', 'Enter the staff password to manage absence notices.');
      return;
    }
    showToast(err?.message || 'Delete failed');
  }
}

function openAdminModal() {
  editingAbsenceId = null;
  setAbsenceModalMode('publish');
  els.absenceForm?.reset();
  els.absDate.value = toISODate(new Date());
  if (currentBatch) els.absBatch.value = currentBatch;
  setCoverFields('');
  els.adminModal.hidden = false;
  els.adminModal.classList.remove('hidden');
  document.getElementById('abs-teacher').focus();
}

function closeAdminModal() {
  els.adminModal.hidden = true;
  els.adminModal.classList.add('hidden');
  editingAbsenceId = null;
  setAbsenceModalMode('publish');
  els.absenceForm?.reset();
  setCoverFields('');
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
    syncTimetableModeUi();
    clearTimetableResults();
  });
}

function setupTimetableEditor() {
  if (!els.editTimetableBtn || !els.ttEditModal) return;

  els.editTimetableBtn.addEventListener('click', () => {
    if (!currentBatch) {
      showToast('Pick a batch first');
      return;
    }
    requireStaff('edit-timetable', 'Enter the staff password to edit the timetable.');
  });

  els.ttEditModal.querySelectorAll('[data-close-tt-edit]').forEach((el) => {
    el.addEventListener('click', () => closeTimetableEditor());
  });

  els.ttEditDay?.addEventListener('change', () => {
    loadTimetableEditorDay(els.ttEditDay.value);
  });

  els.ttEditAddSlot?.addEventListener('click', () => {
    if (!ttEditDraft) return;
    const time = nextAvailableTimeSlot(ttEditDraft.slots.map((s) => s.time));
    ttEditDraft.slots.push({
      time,
      subject: '',
      room: '',
      teacher: '',
      updatedAt: null,
      originalFingerprint: null,
      dirty: true
    });
    renderTimetableEditorSlots();
  });

  const syncSlotField = (e) => {
    const input = e.target.closest('[data-field]');
    if (!input || !ttEditDraft) return;
    const card = input.closest('[data-slot-index]');
    if (!card) return;
    const index = Number(card.dataset.slotIndex);
    const slot = ttEditDraft.slots[index];
    if (!slot) return;
    slot[input.dataset.field] = input.value;
    slot.dirty = slot.originalFingerprint == null || slotFingerprint(slot) !== slot.originalFingerprint;
  };

  els.ttEditSlots?.addEventListener('input', syncSlotField);
  els.ttEditSlots?.addEventListener('change', syncSlotField);

  els.ttEditSlots?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-slot]');
    if (!btn || !ttEditDraft) return;
    const index = Number(btn.dataset.removeSlot);
    ttEditDraft.slots.splice(index, 1);
    renderTimetableEditorSlots();
  });

  els.ttEditForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveTimetableEditor();
  });
}

function openTimetableEditor() {
  if (!currentBatch) {
    showToast('Pick a batch first');
    return;
  }
  if (!cloudEnabled) {
    showToast('Supabase is required to edit timetables');
    return;
  }

  if (els.ttEditBatchLabel) els.ttEditBatchLabel.textContent = currentBatch;
  const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date().getDay()
  ];
  const startDay = WEEKDAYS.includes(todayName) ? todayName : 'Monday';
  if (els.ttEditDay) els.ttEditDay.value = startDay;
  loadTimetableEditorDay(startDay);

  els.ttEditModal.hidden = false;
  els.ttEditModal.classList.remove('hidden');
}

function closeTimetableEditor() {
  if (!els.ttEditModal) return;
  els.ttEditModal.hidden = true;
  els.ttEditModal.classList.add('hidden');
  ttEditDraft = null;
  if (els.ttEditSlots) els.ttEditSlots.innerHTML = '';
}

function loadTimetableEditorDay(day) {
  const week = timetables?.[currentBatch] || {};
  const slots = (week[day] || []).map((s) => {
    const time = TIME_SLOT_OPTIONS.includes(s.time) ? s.time : '';
    const slot = {
      time,
      subject: s.subject || '',
      room: s.room || '',
      teacher: s.teacher || '',
      updatedAt: s.updatedAt || s.updated_at || null,
      originalFingerprint: null,
      dirty: false
    };
    slot.originalFingerprint = slotFingerprint({
      time: s.time || '',
      subject: s.subject || '',
      room: s.room || '',
      teacher: s.teacher || ''
    });
    // If legacy time isn't in the fixed list, force a re-pick before save stays clean only if remapped
    if (!time && (s.time || '')) slot.dirty = true;
    return slot;
  });
  ttEditDraft = { day, slots };
  renderTimetableEditorSlots();
}

function timeSlotOptionsHtml(selected) {
  const options = TIME_SLOT_OPTIONS.map(
    (t) =>
      `<option value="${escapeHtml(t)}" ${t === selected ? 'selected' : ''}>${escapeHtml(t)}</option>`
  );
  if (!selected) {
    options.unshift('<option value="" selected disabled>Select time</option>');
  }
  return options.join('');
}

function renderTimetableEditorSlots() {
  if (!els.ttEditSlots || !ttEditDraft) return;
  const { slots } = ttEditDraft;
  els.ttEditEmpty?.classList.toggle('hidden', slots.length > 0);

  els.ttEditSlots.innerHTML = slots
    .map(
      (slot, index) => `
    <div class="tt-edit-card" data-slot-index="${index}">
      <div class="tt-edit-card-head">
        <span class="tt-edit-card-title">Period ${index + 1}</span>
        <button type="button" class="tt-edit-remove" data-remove-slot="${index}">Remove</button>
      </div>
      <div class="tt-edit-grid">
        <div>
          <label for="tt-slot-time-${index}">Time</label>
          <select id="tt-slot-time-${index}" data-field="time" required class="touch-field surface-field w-full rounded-xl px-4 py-3">
            ${timeSlotOptionsHtml(slot.time)}
          </select>
        </div>
        <div>
          <label for="tt-slot-subject-${index}">Subject</label>
          <input id="tt-slot-subject-${index}" data-field="subject" value="${escapeHtml(slot.subject)}" placeholder="Subject" class="touch-field surface-field w-full rounded-lg px-3 py-2.5" />
        </div>
        <div>
          <label for="tt-slot-room-${index}">Room</label>
          <input id="tt-slot-room-${index}" data-field="room" value="${escapeHtml(slot.room)}" placeholder="Optional" class="touch-field surface-field w-full rounded-lg px-3 py-2.5" />
        </div>
        <div>
          <label for="tt-slot-teacher-${index}">Teacher</label>
          <input id="tt-slot-teacher-${index}" data-field="teacher" value="${escapeHtml(slot.teacher)}" placeholder="Optional" class="touch-field surface-field w-full rounded-lg px-3 py-2.5" />
        </div>
      </div>
    </div>`
    )
    .join('');
}

async function saveTimetableEditor() {
  if (!ttEditDraft || !currentBatch) return;
  if (!isStaffUnlocked() || !staffPasswordSession) {
    requireStaff('edit-timetable', 'Enter the staff password to edit the timetable.');
    return;
  }

  const day = els.ttEditDay?.value || ttEditDraft.day;
  const slots = ttEditDraft.slots.map((s) => ({
    time: String(s.time || '').trim(),
    subject: String(s.subject || '').trim(),
    room: String(s.room || '').trim(),
    teacher: String(s.teacher || '').trim(),
    markUpdated: Boolean(s.dirty) || s.originalFingerprint == null,
    previousUpdatedAt: s.updatedAt || null
  }));

  if (slots.some((s) => !TIME_SLOT_OPTIONS.includes(s.time))) {
    showToast('Pick a time slot for every period');
    return;
  }

  const blank = slots.filter((s) => !s.subject);
  if (blank.length) {
    showToast('Fill in subject, or remove empty periods');
    return;
  }

  const week = timetables?.[currentBatch] || {};
  const fullWeekSeed = Object.fromEntries(
    WEEKDAYS.map((d) => [
      d,
      (week[d] || []).map((s) => ({
        time: s.time || '',
        subject: s.subject || '',
        room: s.room || '',
        teacher: s.teacher || '',
        updatedAt: s.updatedAt || s.updated_at || null,
        markUpdated: false,
        previousUpdatedAt: s.updatedAt || s.updated_at || null
      }))
    ])
  );

  if (els.ttEditSave) els.ttEditSave.disabled = true;

  try {
    await saveTimetableDay({
      password: staffPasswordSession,
      batch: currentBatch,
      day,
      slots,
      fullWeekSeed
    });

    await loadTimetables();
    rebuildTimetableAssistant();
    closeTimetableEditor();
    showToast('Timetable updated successfully');

    if (!els.ttResults?.hidden) runTimetableQuery();
  } catch (err) {
    console.error(err);
    if (err?.code === 'UNAUTHORIZED') {
      setStaffUnlocked(false);
      showToast('Invalid staff password');
      requireStaff('edit-timetable', 'Enter the staff password to edit the timetable.');
      return;
    }
    showToast(err?.message || 'Could not save timetable — check Supabase table / Vercel env');
  } finally {
    if (els.ttEditSave) els.ttEditSave.disabled = false;
  }
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

  syncTimetableModeUi();
}

function syncTimetableModeUi() {
  const mode = els.timetableForm?.querySelector('input[name="tt-mode"]:checked')?.value || 'day';
  const showDay = mode === 'day';

  if (els.ttDayFieldset) {
    els.ttDayFieldset.classList.toggle('hidden', !showDay);
    els.ttDayFieldset.hidden = !showDay;
  }
}

function runTimetableQuery() {
  if (!bot) return;
  const mode = els.timetableForm.querySelector('input[name="tt-mode"]:checked')?.value || 'day';
  const dayValue = els.timetableForm.querySelector('input[name="tt-day"]:checked')?.value || 'today';

  const result = bot.query({ mode, dayValue });
  renderTimetableResults(result);
}

function createTimetableResultRow(slotOrLine, stampDelay) {
  const li = document.createElement('li');
  const isSlot = slotOrLine && typeof slotOrLine === 'object' && ('subject' in slotOrLine || 'time' in slotOrLine);
  const text = isSlot ? formatSlot(slotOrLine) : String(slotOrLine);
  const recentlyUpdated = isSlot && slotOrLine.recentlyUpdated;

  li.className = `tt-result-row${recentlyUpdated ? ' is-updated' : ''}`;
  li.innerHTML = `
    <span class="tt-result-main">${escapeHtml(text)}</span>
    ${recentlyUpdated ? '<span class="tt-updated-badge" title="Changed in the last 7 days">Updated</span>' : ''}
  `;
  stampDelay(li);
  return li;
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

      const sectionSlots = section.slots?.length ? section.slots : section.lines || [];
      sectionSlots.forEach((item) => {
        els.ttResultsList.appendChild(createTimetableResultRow(item, stampDelay));
      });
    });
    return;
  }

  const looksEmpty =
    result.empty ||
    (!result.slots?.length &&
      (!result.lines?.length ||
        result.lines.every((l) => /no .+|enjoy the break|no timetable/i.test(l))));

  if (looksEmpty) {
    els.ttResultsEmpty.classList.remove('hidden');
    els.ttResultsEmpty.textContent = result.lines?.[0] || 'Nothing found for that selection.';
    return;
  }

  els.ttResultsEmpty.classList.add('hidden');
  const items = result.slots?.length ? result.slots : result.lines;
  items.forEach((item) => {
    els.ttResultsList.appendChild(createTimetableResultRow(item, stampDelay));
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

/* —— Utils —— */

function setupFlashyFx() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.addEventListener(
    'click',
    (e) => {
      const host = e.target.closest(
        '.btn-primary, .batch-card, .choice-chip, .tab-btn, .action-btn, #admin-toggle-btn'
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
  const colors = ['#5B8A74', '#4A7562', '#C9846E', '#8FA896', '#D5E0D8'];
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

/* —— Discord alert via Vercel serverless (webhook stays on server) —— */

async function triggerDiscordAlert({ teacher, subject, batch, date, notes, urgent }) {
  try {
    const res = await fetch('/api/discord-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher, subject, batch, date, notes, urgent })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('Discord alert API failed', data);
      showToast('Published, but Discord alert failed');
    }
  } catch (err) {
    console.error('Failed to post alert to Discord:', err);
    showToast('Published, but Discord alert failed');
  }
}
