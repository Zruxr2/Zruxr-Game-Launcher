// Zruxr cloud: Supabase sign-in plus library sync.
// Talks to Supabase over plain HTTPS (no extra npm packages). Runs in the main
// process only, so the renderer never sees tokens. The anon key below is the
// public one and is safe to ship: row-level security on public.games makes sure
// every user can only read and write their own rows.
const { app, net, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPABASE_URL = 'https://dtkjarvgpslvgppgncrw.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0a2phcnZncHNsdmdwcGduY3J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NDU2OTksImV4cCI6MjEwOTEyMTY5OX0.F884Y5SKmV2ejVaQBW2lx3cq6Wgoo4hrJKTe2NkxpZ4';

// People sign in with a username. Supabase Auth needs an email, so we quietly turn
// the username into one. It is never shown, and nothing is ever sent to it. If
// Supabase rejects this domain, change it to one that has real mail (MX) records.
const USER_DOMAIN = 'gmail.com';
const toLoginEmail = (username) => `${String(username).trim().toLowerCase()}@${USER_DOMAIN}`;
const displayName = (addr) => (addr && addr.endsWith('@' + USER_DOMAIN) ? addr.slice(0, -(USER_DOMAIN.length + 1)) : addr);

let session = null; // { access_token, refresh_token, expires_at, user: { id, email } }
let refreshing = null;

const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');

function fail(message, status = 0, code = '') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// ---------- Session storage (encrypted with the OS keychain via safeStorage) ----------
function loadSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = fs.readFileSync(sessionFile());
    const parsed = JSON.parse(safeStorage.decryptString(raw));
    return parsed && parsed.refresh_token && parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

function persistSession() {
  try {
    if (!session) {
      fs.rmSync(sessionFile(), { force: true });
      return;
    }
    // If the OS can't encrypt, we simply don't remember the login between launches.
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(session)));
  } catch {}
}

function setSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: {
      id: (data.user && data.user.id) || (session && session.user.id),
      email: (data.user && data.user.email) || (session && session.user.email),
    },
  };
  persistSession();
}

function clearSession() {
  session = null;
  persistSession();
}

// ---------- HTTP ----------
function friendly(data, status) {
  const raw =
    (data && (data.msg || data.error_description || data.message || data.error)) || `Request failed (${status}).`;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (/invalid login credentials/i.test(text)) return 'Wrong username or password.';
  if (/email not confirmed/i.test(text)) return 'This account needs email confirmation. Turn "Confirm email" off in Supabase Auth settings, then sign up again.';
  if (/already registered|already exists/i.test(text)) return 'That username is taken.';
  if (/email address .* is invalid|invalid email|unable to validate email/i.test(text)) {
    return 'Supabase rejected the internal sign-up address. Change USER_DOMAIN at the top of cloud.js to a domain with mail records.';
  }
  if (/email rate limit/i.test(text)) {
    return 'Supabase has hit its sign-up email limit (about 2 per hour on the free email service). Wait an hour, or turn off "Confirm email" in your Supabase Auth settings.';
  }
  if (/rate limit|too many/i.test(text)) return 'Too many attempts. Wait a minute and try again.';
  return text;
}

async function http(method, pathname, { body, token, headers } = {}) {
  let res;
  try {
    res = await net.fetch(SUPABASE_URL + pathname, {
      method,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token || ANON_KEY}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail("Can't reach the server. Check your connection.", 0, 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw fail(friendly(data, res.status), res.status);
  return data;
}

// ---------- Auth ----------
function init() {
  session = loadSession();
}

const email = () => (session ? displayName(session.user.email) : null); // the username
const isSignedIn = () => !!session;

async function signUp(username, password) {
  const data = await http('POST', '/auth/v1/signup', { body: { email: toLoginEmail(username), password } });
  // With email confirmation on, Supabase returns the user but no session yet.
  if (data && data.access_token) {
    setSession(data);
    return { signedIn: true };
  }
  return { signedIn: false, needsConfirm: true };
}

async function signIn(username, password) {
  const data = await http('POST', '/auth/v1/token?grant_type=password', { body: { email: toLoginEmail(username), password } });
  setSession(data);
}

async function signOut() {
  const token = session && session.access_token;
  clearSession();
  if (token) {
    try {
      await http('POST', '/auth/v1/logout', { token });
    } catch {}
  }
}

async function getToken() {
  if (!session) throw fail('Not signed in.', 0, 'signed_out');
  if (session.expires_at - Date.now() / 1000 > 60) return session.access_token;

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const data = await http('POST', '/auth/v1/token?grant_type=refresh_token', {
          body: { refresh_token: session.refresh_token },
        });
        setSession(data);
      } catch (err) {
        // Offline: keep the session and try again later. Rejected: sign out.
        if (err.status >= 400 && err.status < 500) {
          clearSession();
          throw fail('Session expired. Sign in again.', err.status, 'signed_out');
        }
        throw err;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  await refreshing;
  return session.access_token;
}

// ---------- Sync ----------
// Games match across PCs by name (paths differ per PC, so they never sync).
// Play time is merged by deltas: each game remembers the cloud total it last
// synced (syncBase). New total = cloud total + time played here since then, so
// two PCs adding time separately never overwrite each other.
const syncKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

function latest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

async function sync({ loadLibrary, saveLibrary }) {
  const token = await getToken();
  const userId = session.user.id;
  const now = new Date().toISOString();

  const rows =
    (await http('GET', '/rest/v1/games?select=local_id,name,play_time_seconds,last_played&limit=1000', { token })) || [];
  const cloudByKey = new Map(rows.map((r) => [r.local_id, r]));

  // Work out the merged totals from a snapshot of the library.
  const snap = new Map(); // key -> { local0, total, lastPlayed }
  const push = [];
  for (const g of loadLibrary()) {
    const key = syncKey(g.name);
    if (!key || snap.has(key)) continue;
    const row = cloudByKey.get(key);
    const base = g.syncUser === userId ? g.syncBase || 0 : 0;
    const local0 = g.playTimeSeconds || 0;
    const total = (row ? Number(row.play_time_seconds) || 0 : 0) + Math.max(0, local0 - base);
    const lastPlayed = latest(g.lastPlayed, row && row.last_played);
    snap.set(key, { local0, total, lastPlayed });
    push.push({
      user_id: userId,
      local_id: key,
      name: g.name,
      play_time_seconds: total,
      last_played: lastPlayed,
      updated_at: now,
    });
  }

  // Upload first. Only touch the local library once the cloud has the data, so a
  // failed upload can never lose play time.
  if (push.length) {
    await http('POST', '/rest/v1/games?on_conflict=user_id,local_id', {
      token,
      body: push,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }

  // Re-read the library (it may have changed during the upload) and apply.
  const games = loadLibrary();
  const have = new Set();
  for (const g of games) {
    const key = syncKey(g.name);
    const s = snap.get(key);
    if (!s || have.has(key)) continue;
    have.add(key);
    const accrued = Math.max(0, (g.playTimeSeconds || 0) - s.local0); // played during the upload
    g.playTimeSeconds = s.total + accrued;
    g.syncBase = s.total;
    g.syncUser = userId;
    g.lastPlayed = latest(g.lastPlayed, s.lastPlayed);
  }

  // Games that exist in the cloud but not on this PC show up as "not on this PC".
  const added = [];
  for (const row of rows) {
    if (have.has(row.local_id) || games.some((g) => syncKey(g.name) === row.local_id)) continue;
    const id = crypto.randomUUID();
    const seconds = Number(row.play_time_seconds) || 0;
    games.push({
      id,
      name: row.name,
      path: '',
      cover: null,
      coverSource: null,
      icon: null,
      playTimeSeconds: seconds,
      lastPlayed: row.last_played || null,
      addedAt: now,
      syncBase: seconds,
      syncUser: userId,
    });
    added.push(id);
  }

  saveLibrary(games);
  return { added };
}

async function deleteGame(name) {
  if (!session) return;
  const token = await getToken();
  await http('DELETE', `/rest/v1/games?local_id=eq.${encodeURIComponent(syncKey(name))}`, { token });
}

module.exports = { init, email, isSignedIn, signUp, signIn, signOut, sync, deleteGame };
