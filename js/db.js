/**
 * Shared Supabase client. Anon key is public (safe with RLS).
 * Falls back to null if config is still a placeholder.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

export const cloudEnabled =
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_ANON_KEY) &&
  !String(SUPABASE_URL).includes('YOUR_SUPABASE') &&
  !String(SUPABASE_ANON_KEY).includes('YOUR_SUPABASE');

export const supabase = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 5 } }
    })
  : null;

export function assertCloud() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add your URL and anon key in js/supabase-config.js');
  }
}
