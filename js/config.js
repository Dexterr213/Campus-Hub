/**
 * Staff credentials — change STAFF_PASSWORD before deploying to students.
 * Client-side only (deters casual misuse; not cryptographic security).
 */
export const STAFF_PASSWORD = 'AscendIntl2026';

/** Session unlock lasts until the browser tab/window is closed. */
export const STAFF_SESSION_KEY = 'campusHub.staffUnlocked';

/**
 * Discord channel webhook for absence alerts.
 * Visible in the browser bundle — rotate the webhook in Discord if it leaks.
 */
export const DISCORD_WEBHOOK_URL =
  'https://discordapp.com/api/webhooks/1533518199109451897/MMJrHFTN4orWUBqyWKauPj_kIZFISARFa6wIHsTfRR8eHtgauVslbBhQ9NOt_9HCaL_j';
