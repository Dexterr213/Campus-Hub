/**
 * Anonymous feedback — shared via Supabase (local fallback).
 * No names, IPs, or login data. Vote toggles remembered per device only.
 */

import { loadFeedback, saveFeedback, uid } from './storage.js';
import { cloudEnabled, supabase } from './db.js';

const VOTE_KEY = 'campusHub.feedbackVotes';

const ANIMALS = [
  { name: 'Owl', emoji: '🦉', hue: 210 },
  { name: 'Lion', emoji: '🦁', hue: 35 },
  { name: 'Fox', emoji: '🦊', hue: 20 },
  { name: 'Panda', emoji: '🐼', hue: 160 },
  { name: 'Falcon', emoji: '🦅', hue: 200 },
  { name: 'Deer', emoji: '🦌', hue: 30 },
  { name: 'Whale', emoji: '🐋', hue: 195 },
  { name: 'Koala', emoji: '🐨', hue: 90 },
  { name: 'Tiger', emoji: '🐯', hue: 15 },
  { name: 'Penguin', emoji: '🐧', hue: 220 }
];

function pickAvatar() {
  const pick = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return {
    label: `Anonymous ${pick.name}`,
    emoji: pick.emoji,
    hue: pick.hue
  };
}

function loadVoteSet() {
  try {
    const raw = localStorage.getItem(VOTE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveVoteSet(set) {
  localStorage.setItem(VOTE_KEY, JSON.stringify([...set]));
}

function mapRow(row, votes) {
  return {
    id: row.id,
    category: row.category,
    message: row.message,
    avatarLabel: row.avatar_label,
    avatarEmoji: row.avatar_emoji,
    avatarHue: row.avatar_hue,
    createdAt: row.created_at,
    upvotes: row.upvotes || 0,
    flagged: Boolean(row.flagged),
    votedLocal: votes.has(row.id)
  };
}

export async function listFeedback() {
  const votes = loadVoteSet();
  if (!cloudEnabled) {
    return loadFeedback()
      .map((f) => ({ ...f, votedLocal: votes.has(f.id) || Boolean(f.votedLocal) }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => mapRow(row, votes));
}

export async function submitFeedback({ category, message }) {
  const avatar = pickAvatar();
  const payload = {
    category: category.trim(),
    message: message.trim(),
    avatar_label: avatar.label,
    avatar_emoji: avatar.emoji,
    avatar_hue: avatar.hue
  };

  if (!cloudEnabled) {
    const entry = {
      id: uid('fb'),
      category: payload.category,
      message: payload.message,
      avatarLabel: avatar.label,
      avatarEmoji: avatar.emoji,
      avatarHue: avatar.hue,
      createdAt: new Date().toISOString(),
      upvotes: 0,
      flagged: false,
      votedLocal: false
    };
    const list = loadFeedback();
    list.unshift(entry);
    saveFeedback(list);
    return entry;
  }

  const { data, error } = await supabase.from('feedback').insert(payload).select().single();
  if (error) throw error;
  return mapRow(data, loadVoteSet());
}

export async function upvoteFeedback(id) {
  const votes = loadVoteSet();
  const voted = votes.has(id);

  if (!cloudEnabled) {
    const list = loadFeedback();
    const item = list.find((f) => f.id === id);
    if (!item) return null;
    if (voted) {
      item.upvotes = Math.max(0, (item.upvotes || 0) - 1);
      votes.delete(id);
    } else {
      item.upvotes = (item.upvotes || 0) + 1;
      votes.add(id);
    }
    item.votedLocal = votes.has(id);
    saveFeedback(list);
    saveVoteSet(votes);
    return item;
  }

  const { data: current, error: readErr } = await supabase
    .from('feedback')
    .select('upvotes')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;

  const next = voted ? Math.max(0, (current.upvotes || 0) - 1) : (current.upvotes || 0) + 1;
  const { data, error } = await supabase
    .from('feedback')
    .update({ upvotes: next })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  if (voted) votes.delete(id);
  else votes.add(id);
  saveVoteSet(votes);
  return mapRow(data, votes);
}

export async function flagFeedback(id) {
  if (!cloudEnabled) {
    const list = loadFeedback();
    const item = list.find((f) => f.id === id);
    if (!item) return null;
    item.flagged = !item.flagged;
    saveFeedback(list);
    return item;
  }

  const { data: current, error: readErr } = await supabase
    .from('feedback')
    .select('flagged')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;

  const { data, error } = await supabase
    .from('feedback')
    .update({ flagged: !current.flagged })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data, loadVoteSet());
}

export function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function subscribeFeedback(onChange) {
  if (!cloudEnabled || !supabase) return () => {};
  const channel = supabase
    .channel('feedback-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => onChange())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
