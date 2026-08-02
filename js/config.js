/**
 * Client config — no secrets here.
 * Staff password + Discord webhook live only in Vercel env vars.
 */

/** Session unlock flag (boolean only — password is never stored in source). */
export const STAFF_SESSION_KEY = 'campusHub.staffUnlocked';
