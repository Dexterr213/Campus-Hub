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
  formatAbsenceLine,
  formatDisplayDate,
  toISODate,
  seedDemoAbsencesIfEmpty,
  subscribeAbsences
} from './absences.js';
import { createTimetableAssistant } from './chatbot.js';
import { STAFF_SESSION_KEY } from './config.js';
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
  toast: document.getElementById('toast')
};

let currentBatch = '';
let timetables = {};
let bot = null;
let toastTimer = null;
/** @type {null | 'publish'} */
let pendingAuthAction = null;
let unsubAbsences = null;
/** Staff password kept in memory only after /api/verify-staff succeeds. */
let staffPasswordSession = '';

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
}

function setupAuth() {
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

      setStaffUnlocked(true, entered);
      closeAuthModal();
      showToast('Staff access unlocked');
      const action = pendingAuthAction;
      pendingAuthAction = null;
      if (action === 'publish') openAdminModal();
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
    } else if (!els.adminModal.hidden) {
      closeAdminModal();
    }
  });
}

function requireStaff(action, description) {
  if (isStaffUnlocked()) {
    if (action === 'publish') openAdminModal();
    return;
  }
  pendingAuthAction = action;
  if (els.authDesc) els.authDesc.textContent = description;
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

/* —— Batch landing —— */

function setupBatchLanding() {
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
    card.addEventListener('click', () => {
      els.batchGrid.querySelectorAll('.batch-card').forEach((c) => {
        const on = c === card;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      setSelectedBatch(batch);
      enterApp(batch, { burst: true });
    });
    els.batchGrid.appendChild(card);
  });

  els.changeBatch.addEventListener('click', () => {
    clearSelectedBatch();
    showLanding();
  });
}

function showLanding() {
  document.body.classList.remove('has-batch');
  els.landing?.classList.remove('is-collapsed');
  els.shell.hidden = true;
  els.shell.classList.add('hidden');
  if (els.batchHeading) els.batchHeading.textContent = 'Pick your batch to jump in';
  els.batchGrid.querySelectorAll('.batch-card').forEach((c) => {
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
          <p class="text-white font-medium mt-0.5">${escapeHtml(formatAbsenceLine(a))}</p>
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
          card.className = `alert-card${a.urgent ? ' urgent' : ''}`;
          card.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 class="font-semibold text-white">${escapeHtml(a.teacher)} · ${escapeHtml(a.subject)}</h3>
          <p class="text-sm text-ascend-muted mt-0.5">${escapeHtml(a.batch)} · Absent on ${escapeHtml(formatDisplayDate(a.date))}</p>
        </div>
        ${a.urgent ? '<span class="rounded-full bg-white/10 border border-ascend-accent/40 px-2.5 py-0.5 text-xs font-bold text-ascend-accent">URGENT</span>' : ''}
      </div>
      ${a.cover ? `<p class="mt-2 text-sm text-ascend-muted border-t border-white/10 pt-2">${escapeHtml(a.cover)}</p>` : ''}
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
    if (!isStaffUnlocked() || !staffPasswordSession) {
      showToast('Staff password required');
      requireStaff('publish', 'Enter the staff password to publish absence notices.');
      return;
    }
    try {
      const teacher = document.getElementById('abs-teacher').value;
      const subject = document.getElementById('abs-subject').value;
      const batch = document.getElementById('abs-batch').value;
      const date = document.getElementById('abs-date').value;
      const cover = document.getElementById('abs-cover').value;
      const urgent = document.getElementById('abs-urgent').checked;

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
      els.absenceForm.reset();
      showToast('Published for everyone');
      if (currentBatch) renderAbsences();
    } catch (err) {
      console.error(err);
      if (err?.code === 'UNAUTHORIZED') {
        setStaffUnlocked(false);
        showToast('Invalid staff password');
        requireStaff('publish', 'Enter the staff password to publish absence notices.');
        return;
      }
      showToast(err?.message || 'Publish failed — check Vercel env / Supabase');
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
    result.lines.every((l) => /no .+|enjoy the break|no timetable/i.test(l));

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
  const colors = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#E2E8F0'];
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
