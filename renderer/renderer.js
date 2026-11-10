const main = document.getElementById('main');
const tabsEl = document.getElementById('tabs');
const tabInk = document.getElementById('tabInk');
const favCount = document.getElementById('favCount');
const pageGames = document.getElementById('pageGames');
const pageStats = document.getElementById('pageStats');
const pageFriends = document.getElementById('pageFriends');
const pageSettings = document.getElementById('pageSettings');
const pageDownloads = document.getElementById('pageDownloads');

const grid = document.getElementById('grid');
const libraryBlock = document.getElementById('libraryBlock');
const emptyState = document.getElementById('empty');
const emptyFavs = document.getElementById('emptyFavs');
const featuredEl = document.getElementById('featured');
const greetingEl = document.getElementById('greeting');
const statsEl = document.getElementById('stats');
const sectionTitle = document.getElementById('sectionTitle');
const sectionCount = document.getElementById('sectionCount');
const noResults = document.getElementById('noResults');
const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sortSelect');
const accountBtn = document.getElementById('accountBtn');
const accountPop = document.getElementById('accountPop');
const toast = document.getElementById('toast');
const authView = document.getElementById('authView');
const accountView = document.getElementById('accountView');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPass = document.getElementById('authPass');
const authMsg = document.getElementById('authMsg');
const authSubmit = document.getElementById('authSubmit');
const authToggle = document.getElementById('authToggle');
const authTitle = document.getElementById('authTitle');
const authSub = document.getElementById('authSub');
const authNote = document.getElementById('authNote');
const accountAvatar = document.getElementById('accountAvatar');
const accountEmail = document.getElementById('accountEmail');
const accountSync = document.getElementById('accountSync');
const syncBtn = document.getElementById('syncBtn');
const signOutBtn = document.getElementById('signOutBtn');
const avatarBtn = document.getElementById('avatarBtn');
const removeAvatarBtn = document.getElementById('removeAvatarBtn');

const dialog = document.getElementById('gameDialog');
const dialogTitle = document.getElementById('dialogTitle');
const fPath = document.getElementById('fPath');
const fName = document.getElementById('fName');
const coverSection = document.getElementById('coverSection');
const coverPreview = document.getElementById('coverPreview');

let games = [];
let query = '';
let discover = { sections: [] }; // popular on Steam, from the main process
let discoverTab = 'top';
let tab = 'library'; // 'library' | 'downloads' | 'favorites' | 'stats' | 'friends' | 'settings'
let downloadDir = '';
let settings = { cardSize: 'medium', startupAnimation: true, startWithWindows: false, sort: 'name' };
let appInfo = { version: '', dataDir: '', packaged: false };
let account = { email: null, syncing: false, lastSync: null, error: null };
let locked = false; // true while the welcome (create-account) screen is up. It's optional: "Not now" closes it.
let booted = false; // the startup sequence has finished deciding what to show
let authMode = 'signin'; // 'signin' | 'signup'
let profileAvatar = { user: null, file: null }; // profile picture of the signed-in user
let animateCards = true; // stagger the grid in once, during startup
let form = null; // { mode: 'add' | 'edit', id, path, name, coverSrc, existingCover, resetCover }

// ---------- Helpers ----------
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function hoursText(seconds) {
  if (seconds < 60) return '0 minutes';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = seconds / 3600;
  const rounded = hrs < 10 ? hrs.toFixed(1) : Math.round(hrs).toString();
  return `${rounded} hours`;
}

function playedText(seconds) {
  if (!seconds) return 'Not played yet';
  return `${hoursText(seconds)} played`;
}

function agoText(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// "42m" / "3.5h" for tight spaces (chart labels).
function shortTime(seconds) {
  if (seconds < 60) return seconds > 0 ? '<1m' : '0';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = seconds / 3600;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
}

function dayKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function showToast(message, kind = 'error') {
  toast.textContent = message;
  toast.className = 'toast' + (kind === 'info' ? ' info' : '');
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 5000);
}

function coverUrl(fileName) {
  return `cover://covers/${encodeURIComponent(fileName)}`;
}

function localFileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

function toggleGame(g) {
  if (!g.path) { openDialog('edit', g); return; } // not on this PC yet: locate it
  if (g.running) window.launcher.stop(g.id);
  else window.launcher.launch(g.id).then(handleLaunchResult);
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7.5 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2a1 1 0 0 0-1.5.86z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';

// ---------- Default covers + glow colours ----------
// Every game gets a cover. Real art when we have it; otherwise a generated
// default: a tinted plate (hue comes from the name, so it's stable), a big
// initial, the game's own icon, and its title.
function hueFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

// "r, g, b" for the soft glow behind a game: the cover's own colour when known.
function glowFor(g) {
  if (Array.isArray(g.tint) && g.tint.length === 3) return g.tint.join(', ');
  return hslToRgb(hueFor(g.name), 38, 52).join(', ');
}

function paintPlaceholder(el, g, compact = false) {
  el.classList.add('placeholder');
  if (compact) el.classList.add('compact');
  el.style.setProperty('--h', String(hueFor(g.name)));

  const letter = document.createElement('span');
  letter.className = 'ph-letter';
  const initial = (String(g.name).trim().match(/[\p{L}\p{N}]/u) || ['?'])[0];
  letter.textContent = initial.toUpperCase();
  el.appendChild(letter);

  if (g.icon && !compact) {
    const img = document.createElement('img');
    img.className = 'ph-icon';
    img.src = g.icon;
    img.alt = '';
    el.appendChild(img);
  }
  if (!compact) {
    const title = document.createElement('span');
    title.className = 'ph-name';
    title.textContent = g.name;
    el.appendChild(title);
  }
}

// Returns true when real art was painted.
function paintCover(el, g, compact = false) {
  if (g.cover) {
    el.style.backgroundImage = `url("${coverUrl(g.cover)}")`;
    return true;
  }
  paintPlaceholder(el, g, compact);
  return false;
}

// ---------- Tabs ----------
function moveInk() {
  const active = tabsEl.querySelector('.tab.active');
  if (!active) return;
  tabInk.style.width = active.offsetWidth + 'px';
  tabInk.style.transform = `translateX(${active.offsetLeft}px)`;
}

function setTab(name) {
  if (name === tab) return;
  tab = name;
  tabsEl.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  moveInk();

  const onGames = name === 'library' || name === 'favorites';
  pageGames.hidden = !onGames;
  pageStats.hidden = name !== 'stats';
  pageFriends.hidden = name !== 'friends';
  pageSettings.hidden = name !== 'settings';
  pageDownloads.hidden = name !== 'downloads';
  main.scrollTop = 0;

  render({ intro: true });

  if (!onGames) {
    const page = name === 'stats' ? pageStats : name === 'friends' ? pageFriends : name === 'downloads' ? pageDownloads : pageSettings;
    page.classList.remove('enter');
    void page.offsetWidth; // restart the entrance animation
    page.classList.add('enter');
  }
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) setTab(btn.dataset.tab);
});
window.addEventListener('resize', moveInk);

// ---------- Sorting ----------
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const sorters = {
  name: byName,
  recent: (a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0) || byName(a, b),
  played: (a, b) => (b.playTimeSeconds || 0) - (a.playTimeSeconds || 0) || byName(a, b),
  added: (a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0) || byName(a, b),
};

// ---------- Rendering: library + favorites ----------
function renderFeatured() {
  const played = games.filter((g) => g.lastPlayed || g.running);
  if (tab !== 'library' || !played.length || query) {
    featuredEl.hidden = true;
    return;
  }
  const g = played.find((x) => x.running) || [...played].sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed))[0];

  featuredEl.hidden = false;
  featuredEl.replaceChildren();
  featuredEl.style.setProperty('--glow', glowFor(g));

  if (g.cover) {
    const bg = make('div', 'featured-bg');
    bg.style.backgroundImage = `url("${coverUrl(g.cover)}")`;
    featuredEl.appendChild(bg);
  }

  const cover = make('div', 'featured-cover');
  paintCover(cover, g, true);

  const text = make('div', 'featured-text');
  const eyebrow = make('div', 'eyebrow', g.running ? 'Playing now' : 'Jump back in');
  const name = make('div', 'featured-name', g.name);
  const meta = make(
    'div',
    'featured-meta',
    g.running ? playedText(g.playTimeSeconds) : `${playedText(g.playTimeSeconds)} · last played ${agoText(g.lastPlayed)}`
  );
  text.append(eyebrow, name, meta);

  const btn = make('button', g.running ? 'btn lg' : 'btn primary lg');
  btn.innerHTML = (g.running ? ICON_STOP : ICON_PLAY) + `<span>${g.running ? 'Stop' : g.path ? 'Play' : 'Locate'}</span>`;
  btn.addEventListener('click', () => toggleGame(g));

  featuredEl.append(cover, text, btn);
}

function renderGames(opts = {}) {
  const isFav = tab === 'favorites';
  const favs = games.filter((g) => g.favorite);
  const base = isFav ? favs : games;
  const total = base.reduce((sum, g) => sum + (g.playTimeSeconds || 0), 0);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  greetingEl.textContent = isFav ? 'Favorites' : greeting();
  if (!games.length) statsEl.textContent = 'Your library is empty.';
  else if (isFav) statsEl.textContent = favs.length ? `${plural(favs.length, 'game')} · ${hoursText(total)} played` : 'Nothing starred yet.';
  else statsEl.textContent = `${plural(games.length, 'game')} · ${hoursText(total)} played`;

  const hasGames = games.length > 0;
  emptyState.hidden = hasGames;
  libraryBlock.hidden = !hasGames;
  emptyFavs.hidden = !(isFav && hasGames && favs.length === 0);
  renderFeatured();
  updateDiscover();
  updateDownloads();

  const q = query.trim().toLowerCase();
  const visible = base.filter((g) => !q || g.name.toLowerCase().includes(q)).sort(sorters[settings.sort] || byName);

  sectionTitle.textContent = isFav ? 'Starred games' : 'All games';
  sectionCount.textContent = base.length ? (q ? `${visible.length} of ${base.length}` : String(base.length)) : '';
  noResults.hidden = !(base.length > 0 && visible.length === 0);
  document.getElementById('libTip').hidden = base.length === 0;

  const intro = animateCards || opts.intro;
  const firstDelay = animateCards ? 5 : 0.5;

  grid.replaceChildren();
  visible.forEach((g, i) => {
    const el = document.createElement('article');
    el.className = 'game' + (g.running ? ' is-running' : '');
    el.style.setProperty('--glow', glowFor(g));
    if (intro) {
      el.classList.add('rise');
      el.style.setProperty('--i', String(firstDelay + Math.min(i, 14) * 0.55));
    }

    const cover = make('div', 'cover');
    const hasArt = paintCover(cover, g);
    if (hasArt) cover.classList.add('has-art');
    cover.addEventListener('dblclick', () => {
      if (!g.running && g.path) toggleGame(g);
    });

    if (!hasArt && g.findingCover) cover.appendChild(make('div', 'cover-status pulse', 'Finding cover…'));

    const fav = make('button', 'fav-btn' + (g.favorite ? ' on' : ''));
    fav.innerHTML = ICON_STAR;
    fav.title = g.favorite ? 'Remove from favorites' : 'Add to favorites';
    fav.setAttribute('aria-pressed', String(!!g.favorite));
    fav.addEventListener('click', async (e) => {
      e.stopPropagation();
      games = await window.launcher.toggleFavorite(g.id);
      render();
    });
    cover.appendChild(fav);

    const btn = make('button', 'cover-btn' + (g.running ? ' stop' : ''));
    btn.innerHTML = (g.running ? ICON_STOP : ICON_PLAY) + `<span>${g.running ? 'Stop' : g.path ? 'Play' : 'Locate'}</span>`;
    btn.addEventListener('click', () => toggleGame(g));
    cover.appendChild(btn);

    if (g.running) {
      cover.appendChild(make('div', 'running-tag', 'Running'));
    } else if (!g.path) {
      cover.appendChild(make('div', 'running-tag remote', 'Not on this PC'));
    }
    el.appendChild(cover);

    const name = make('div', 'game-name', g.name);
    name.title = g.name;
    const meta = make('div', 'game-meta', playedText(g.playTimeSeconds));

    const actions = make('div', 'game-actions');
    actions.append(
      linkButton(g.path ? 'Edit' : 'Locate', () => openDialog('edit', g)),
      ...(g.path ? [linkButton('Folder', () => window.launcher.showInFolder(g.id))] : []),
      linkButton('Remove', () => removeGame(g), 'danger')
    );

    el.append(name, meta, actions);
    grid.appendChild(el);
  });
}

function linkButton(label, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.className = `link ${extraClass}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Rendering: stats ----------
function renderStats() {
  const total = games.reduce((s, g) => s + (g.playTimeSeconds || 0), 0);
  const playedGames = games.filter((g) => g.playTimeSeconds > 0);
  document.getElementById('statsSub').textContent = games.length
    ? `${hoursText(total)} across ${games.length} game${games.length === 1 ? '' : 's'}`
    : 'Add some games to start tracking.';

  // Last 7 days (local calendar days, oldest first).
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const seconds = games.reduce((s, g) => s + ((g.daily && g.daily[key]) || 0), 0);
    days.push({ seconds, today: i === 0, label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }), date: d });
  }
  const weekSeconds = days.reduce((s, d) => s + d.seconds, 0);
  const top = [...playedGames].sort((a, b) => b.playTimeSeconds - a.playTimeSeconds);

  // Tiles
  const tiles = document.getElementById('statTiles');
  tiles.replaceChildren();
  const addTile = (label, value, unit, sub, text = false) => {
    const t = make('div', 'tile');
    t.appendChild(make('div', 'tile-label', label));
    const v = make('div', 'tile-value' + (text ? ' text' : ''));
    v.appendChild(document.createTextNode(value));
    if (unit) v.appendChild(make('span', 'unit', unit));
    t.appendChild(v);
    t.appendChild(make('div', 'tile-sub', sub));
    tiles.appendChild(t);
  };
  const split = (seconds) => {
    if (seconds < 3600) return [String(Math.floor(seconds / 60)), 'min'];
    const h = seconds / 3600;
    return [h < 100 ? h.toFixed(1) : String(Math.round(h)), 'hrs'];
  };
  const [tv, tu] = split(total);
  const [wv, wu] = split(weekSeconds);
  addTile('Total play time', tv, tu, playedGames.length ? `${playedGames.length} game${playedGames.length === 1 ? '' : 's'} played` : 'Nothing played yet');
  addTile('This week', wv, wu, weekSeconds ? 'Over the last 7 days' : 'Quiet so far');
  addTile('Games', String(games.length), '', `${games.filter((g) => g.favorite).length} favorite${games.filter((g) => g.favorite).length === 1 ? '' : 's'}`);
  addTile('Most played', top[0] ? top[0].name : '—', '', top[0] ? hoursText(top[0].playTimeSeconds) : 'Play something first', true);

  // Weekly chart
  const chart = document.getElementById('weekChart');
  chart.replaceChildren();
  const max = Math.max(...days.map((d) => d.seconds), 1);
  days.forEach((d, i) => {
    const col = make('div', 'bar-col' + (d.today ? ' today' : ''));
    col.title = `${d.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${hoursText(d.seconds)}`;
    col.appendChild(make('div', 'bar-val', shortTime(d.seconds)));
    const track = make('div', 'bar-track');
    const bar = make('div', 'bar' + (d.seconds ? '' : ' zero'));
    bar.style.setProperty('--v', String(Math.max(4, Math.round((d.seconds / max) * 100))));
    bar.style.setProperty('--k', String(i));
    track.appendChild(bar);
    col.appendChild(track);
    col.appendChild(make('div', 'bar-day', d.label));
    chart.appendChild(col);
  });
  document.getElementById('weekTotal').textContent = weekSeconds ? hoursText(weekSeconds) : '';
  document.getElementById('weekNote').textContent = weekSeconds
    ? 'Daily history is kept on this PC.'
    : 'No play time recorded this week yet. Daily history is kept on this PC and starts from this version.';

  // Most played list
  const list = document.getElementById('topList');
  list.replaceChildren();
  const maxPlayed = top[0] ? top[0].playTimeSeconds : 1;
  top.slice(0, 8).forEach((g, i) => {
    const li = make('li', 'top-item');
    li.appendChild(make('span', 'rank', String(i + 1)));
    const thumb = make('div', 'thumb');
    paintCover(thumb, g, true);
    li.appendChild(thumb);
    const mid = make('div', 'top-main');
    mid.appendChild(make('div', 'top-name', g.name));
    const bar = make('div', 'top-bar');
    const fill = document.createElement('i');
    fill.style.setProperty('--v', String(Math.max(3, Math.round((g.playTimeSeconds / maxPlayed) * 100))));
    fill.style.setProperty('--k', String(i));
    bar.appendChild(fill);
    mid.appendChild(bar);
    li.appendChild(mid);
    li.appendChild(make('span', 'top-time', shortTime(g.playTimeSeconds)));
    list.appendChild(li);
  });
  document.getElementById('topNote').hidden = top.length > 0;
}

// ---------- Rendering: settings ----------
function renderSettings() {
  document.querySelectorAll('#sizeSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.size === settings.cardSize));
  });
  document.getElementById('optSplash').checked = !!settings.startupAnimation;
  document.getElementById('optDiscover').checked = settings.showDiscover !== false;
  document.getElementById('optDownloads').checked = settings.showDownloads !== false;

  const startup = document.getElementById('optStartup');
  startup.checked = !!settings.startWithWindows;
  startup.disabled = !appInfo.packaged;
  document.getElementById('startDesc').textContent = appInfo.packaged
    ? 'Open Zruxr when you sign in to your PC.'
    : 'Available in the installed or portable app (not when running with npm start).';

  document.getElementById('acctDesc').textContent = account.email
    ? `Signed in as ${account.email}`
    : 'Not signed in. Sign in to sync your library between PCs.';
  document.getElementById('dataPath').textContent = appInfo.dataDir || '…';
  document.getElementById('dlPath').textContent = downloadDir || '…';
  renderUpdateSetting();
  document.getElementById('about').textContent = appInfo.version
    ? `Zruxr ${appInfo.version} · Type is Inter, used under the SIL Open Font License.`
    : '';
}

function applySettings() {
  document.documentElement.dataset.size = settings.cardSize;
  sortSelect.value = settings.sort;
}

async function saveSettings(patch) {
  settings = await window.launcher.setSettings(patch);
  applySettings();
  renderSettings();
}

document.getElementById('sizeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (b) saveSettings({ cardSize: b.dataset.size });
});
document.getElementById('optSplash').addEventListener('change', (e) => saveSettings({ startupAnimation: e.target.checked }));
document.getElementById('optDownloads').addEventListener('change', (e) => saveSettings({ showDownloads: e.target.checked }).then(updateDownloads));
document.getElementById('optDiscover').addEventListener('change', async (e) => {
  await saveSettings({ showDiscover: e.target.checked });
  if (e.target.checked && !discover.sections.length) loadDiscover(false);
  updateDiscover();
});
document.getElementById('scanNow').addEventListener('click', () => openScan());
document.getElementById('optStartup').addEventListener('change', (e) => saveSettings({ startWithWindows: e.target.checked }));
document.getElementById('manageAccount').addEventListener('click', () => setAccountOpen(true));
document.getElementById('openData').addEventListener('click', () => window.launcher.openDataFolder());
document.getElementById('refreshCovers').addEventListener('click', async () => {
  const n = await window.launcher.refreshCovers();
  showToast(n ? `Looking for ${n} cover${n === 1 ? '' : 's'}…` : 'Every game already has a cover.', 'info');
});

sortSelect.addEventListener('change', () => {
  saveSettings({ sort: sortSelect.value });
  render({ intro: true });
});

// ---------- Render dispatcher ----------
function render(opts = {}) {
  // The favorites tab shows how many games are starred.
  const favs = games.filter((g) => g.favorite).length;
  favCount.textContent = String(favs);
  favCount.hidden = favs === 0;
  moveInk();

  if (tab === 'stats') renderStats();
  else if (tab === 'settings') renderSettings();
  else if (tab === 'friends') return; // placeholder page, nothing to draw yet
  else if (tab === 'downloads') updateDownloads();
  else renderGames(opts);
}

// A game closed within seconds, or crashed: the .exe chosen for it may be the wrong one.
const launchHelp = document.getElementById('launchHelp');
let launchHelpId = null;
function showLaunchTrouble(t) {
  const g = games.find((x) => x.id === t.id);
  if (!g) return;
  launchHelpId = t.id;
  document.getElementById('launchHelpTitle').textContent =
    t.kind === 'error' ? `"${t.name}" could not start.` :
    t.kind === 'crash' ? `"${t.name}" stopped after ${t.seconds} s (it may have crashed).` :
    `"${t.name}" closed after ${t.seconds} s.`;
  document.getElementById('launchHelpBody').textContent =
    ' If it did not open or keeps crashing, the wrong .exe may be selected. Press Change .exe and pick another one. (Some games open through a launcher that closes by itself: then this is fine.)';
  launchHelp.hidden = false;
}
document.getElementById('launchHelpChange').addEventListener('click', () => {
  const g = games.find((x) => x.id === launchHelpId);
  launchHelp.hidden = true;
  if (g) openDialog('edit', g);
});
document.getElementById('launchHelpFolder').addEventListener('click', () => { if (launchHelpId) window.launcher.showInFolder(launchHelpId); });
document.getElementById('launchHelpClose').addEventListener('click', () => { launchHelp.hidden = true; });

function handleLaunchResult(res) {
  if (res && res.ok) launchHelp.hidden = true;
  if (res && !res.ok) showToast(res.error || 'Could not launch the game.');
}

async function removeGame(g) {
  const cloudNote = account.email ? '\nIt will also be removed from your account.' : '';
  if (!confirm(`Remove "${g.name}" from your library?\n\nThis does not delete the game files.${cloudNote}`)) return;
  games = await window.launcher.removeGame(g.id);
  render();
}

// ---------- Search + keyboard ----------
searchInput.addEventListener('input', () => {
  query = searchInput.value;
  render();
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    query = '';
    searchInput.blur();
    render();
  }
});
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (typing || dialog.open || !accountPop.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    if (tab !== 'library' && tab !== 'favorites') setTab('library');
    searchInput.focus();
  } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
    setTab(['library', 'favorites', 'stats', 'friends', 'settings'][Number(e.key) - 1]);
  }
});

// ---------- Account panel ----------
let accountCloseTimer = null;
function setAccountOpen(open) {
  clearTimeout(accountCloseTimer);
  accountBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    renderAccount();
    accountPop.hidden = false;
    void accountPop.offsetWidth; // let the browser register the hidden state so the transition plays
    accountPop.classList.add('open');
    if (!account.email) setTimeout(() => authEmail.focus(), 220);
  } else {
    accountPop.classList.remove('open');
    accountCloseTimer = setTimeout(() => { accountPop.hidden = true; }, 320);
  }
}
accountBtn.addEventListener('click', () => setAccountOpen(true));
document.getElementById('accountClose').addEventListener('click', () => setAccountOpen(false));
accountPop.addEventListener('mousedown', (e) => {
  if (e.target === accountPop) setAccountOpen(false); // click on the dimmed backdrop
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setAccountOpen(false);
});

// ---------- Account ----------
function syncText() {
  if (account.syncing) return 'Syncing…';
  if (account.error) return account.error;
  if (account.lastSync) return `Synced ${agoText(account.lastSync)}`;
  return 'Waiting to sync';
}

function showAuthMsg(text, kind = 'error') {
  authMsg.textContent = text;
  authMsg.className = 'auth-msg' + (kind === 'info' ? ' info' : '');
  authMsg.hidden = false;
}
function hideAuthMsg() {
  authMsg.hidden = true;
}

function setAuthMode(mode) {
  authMode = mode;
  const up = mode === 'signup';
  if (locked) {
    authTitle.textContent = up ? 'Create your account' : 'Welcome back';
    authSub.textContent = up ? 'Optional, and free. Syncs your library between PCs.' : 'Sign in to sync your library';
  } else {
    authTitle.textContent = up ? 'Create account' : 'Sign in';
    authSub.textContent = up ? 'Free. Your library syncs between PCs.' : 'Sync your library across PCs';
  }
  authSubmit.textContent = up ? 'Create account' : 'Sign in';
  authToggle.textContent = up ? 'Have an account? Sign in' : 'New here? Create an account';
  authPass.autocomplete = up ? 'new-password' : 'current-password';
  authNote.textContent = up
    ? "Your password is stored as a one-way hash, so nobody can read it. There's no email, so there's no password reset either. If you forget it, the account can't be recovered. Keep it somewhere safe."
    : "Forgot your password? There's no email on the account, so it can't be reset.";
  authNote.classList.toggle('strong', up);
  hideAuthMsg();
}

// Signed out when Zruxr opens: offer to create an account. It's optional, so "Not now"
// (or signing in) just closes it and the app carries on. Comes back next launch.
function showWelcome() {
  if (account.email || locked) return;
  locked = true;
  accountPop.classList.add('locked');
  authPass.value = '';
  setAuthMode(account.error ? 'signin' : 'signup'); // an expired saved login goes to sign in
  setAccountOpen(true);
}

function closeWelcome() {
  if (!locked) return;
  locked = false;
  hideAuthMsg();
  authEmail.value = '';
  authPass.value = '';
  setAccountOpen(false); // fades the welcome screen out
  setTimeout(() => { if (!locked) accountPop.classList.remove('locked'); }, 360);
}
document.getElementById('authSkip').addEventListener('click', closeWelcome);

function renderAccount() {
  if (booted && account.email && locked) closeWelcome(); // signed in from the welcome screen
  const signed = !!account.email;
  authView.hidden = signed;
  accountView.hidden = !signed;
  accountBtn.classList.toggle('signed-in', signed);
  accountBtn.classList.toggle('syncing', signed && account.syncing);
  accountBtn.dataset.initial = signed ? account.email[0].toUpperCase() : '';
  accountBtn.title = signed ? account.email : 'Account';

  if (signed) {
    accountAvatar.textContent = account.email[0].toUpperCase();
    accountEmail.textContent = account.email;
    accountEmail.title = account.email;
    accountSync.textContent = syncText();
    accountSync.classList.toggle('bad', !!account.error && !account.syncing);
    syncBtn.disabled = account.syncing;
  } else if (account.error) {
    showAuthMsg(account.error); // e.g. the saved session expired
  }
  syncAvatar();
  if (tab === 'settings') renderSettings();
}

authToggle.addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = authEmail.value.trim();
  const password = authPass.value;
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return showAuthMsg('Usernames are 3 to 20 characters: letters, numbers, _ . and -');
  if (authMode === 'signup' && password.length < 8) return showAuthMsg('Use at least 8 characters for your password.');
  if (!password) return showAuthMsg('Enter your password.');

  hideAuthMsg();
  authSubmit.disabled = true;
  const label = authSubmit.textContent;
  authSubmit.textContent = 'Please wait…';
  const res = await (authMode === 'signup' ? window.launcher.signUp : window.launcher.signIn)({ username, password });
  authSubmit.disabled = false;
  authSubmit.textContent = label;

  if (!res.ok) return showAuthMsg(res.error || 'Something went wrong. Try again.');
  authPass.value = '';
  if (res.needsConfirm) {
    setAuthMode('signin');
    showAuthMsg('Account created, but Supabase still wants email confirmation. Turn "Confirm email" off in its Auth settings.', 'info');
    return;
  }
  authEmail.value = '';
  account = await window.launcher.getAccount();
  renderAccount();
});

// ---------- Profile picture ----------
function paintAvatar() {
  const has = !!profileAvatar.file;
  const url = has ? `url("${coverUrl(profileAvatar.file)}")` : '';
  accountBtn.classList.toggle('has-avatar', has);
  accountBtn.style.backgroundImage = url;
  accountAvatar.classList.toggle('has-avatar', has);
  accountAvatar.style.backgroundImage = url;
  removeAvatarBtn.hidden = !has;
}

// Loads the picture whenever a different user becomes signed in (or nobody is).
function syncAvatar() {
  const user = account.email ? account.email.toLowerCase() : null;
  if (profileAvatar.user === user) return;
  profileAvatar = { user, file: null };
  paintAvatar();
  if (!user) return;
  window.launcher.getProfile().then((p) => {
    if (profileAvatar.user !== user) return; // signed out / switched while loading
    profileAvatar.file = p && p.avatar ? p.avatar : null;
    paintAvatar();
  }).catch(() => {});
}

async function changeAvatar() {
  const res = await window.launcher.pickAvatar();
  if (res.ok) {
    profileAvatar.file = res.avatar;
    paintAvatar();
    showToast('Profile picture updated.', 'info');
  } else if (res.error) {
    showToast(res.error);
  }
}

avatarBtn.addEventListener('click', changeAvatar);
accountAvatar.addEventListener('click', changeAvatar);
removeAvatarBtn.addEventListener('click', async () => {
  const res = await window.launcher.removeAvatar();
  if (res.ok) {
    profileAvatar.file = null;
    paintAvatar();
    showToast('Profile picture removed.', 'info');
  } else if (res.error) {
    showToast(res.error);
  }
});

syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  account = await window.launcher.syncNow();
  renderAccount();
});

signOutBtn.addEventListener('click', async () => {
  await window.launcher.signOut();
  account = await window.launcher.getAccount();
  setAuthMode('signin');
  renderAccount();
});

// Keep "Synced 5 minutes ago" fresh while the panel is open.
setInterval(() => { if (!accountPop.hidden) renderAccount(); }, 20000);

// ---------- Add / edit dialog ----------
function updateCoverPreview() {
  coverPreview.classList.remove('placeholder', 'compact');
  coverPreview.replaceChildren();
  coverPreview.style.removeProperty('--h');
  if (form.coverSrc) {
    coverPreview.style.backgroundImage = `url("${localFileUrl(form.coverSrc)}")`;
  } else if (form.existingCover && !form.resetCover) {
    coverPreview.style.backgroundImage = `url("${coverUrl(form.existingCover)}")`;
  } else {
    coverPreview.style.backgroundImage = '';
    paintPlaceholder(coverPreview, { name: fName.value || form.name || '?' }, true);
  }
}

async function openDialog(mode, game) {
  form = {
    mode,
    id: game?.id,
    path: game?.path || '',
    name: game?.name || '',
    coverSrc: null,
    existingCover: game?.cover || null,
    resetCover: false,
  };
  dialogTitle.textContent = mode === 'add' ? 'Add game' : game.path ? 'Edit game' : 'Locate game';
  loadExeSuggestions(mode === 'edit' && game?.path ? game.id : null);
  coverSection.hidden = mode === 'add';
  fPath.value = form.path;
  fName.value = form.name;
  updateCoverPreview();

  if (mode === 'add') {
    // Go straight to the file picker so adding a game is one click.
    const picked = await window.launcher.pickGameFile();
    if (!picked) return;
    form.path = picked.path;
    form.name = picked.name;
    fPath.value = picked.path;
    fName.value = picked.name;
  }
  dialog.showModal();
  fName.focus();
  fName.select();
}

fName.addEventListener('input', () => { if (form && !form.coverSrc && !(form.existingCover && !form.resetCover)) updateCoverPreview(); });

// "Change .exe": the other programs found in the game's folder, best first. Click one to use it.
const exeHelp = document.getElementById('exeHelp');
const exeSuggest = document.getElementById('exeSuggest');
const exeSuggestList = document.getElementById('exeSuggestList');
async function loadExeSuggestions(id) {
  exeHelp.hidden = !id;
  exeSuggest.hidden = true;
  exeSuggestList.textContent = '';
  if (!id) return;
  let list = [];
  try { list = await window.launcher.suggestExes(id); } catch {}
  if (!form || form.id !== id || list.length < 2) return; // nothing else to choose from
  for (const f of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'exe-opt';
    b.dataset.path = f.path;
    const name = document.createElement('span');
    name.className = 'exe-opt-name';
    name.textContent = f.name;
    const meta = document.createElement('span');
    meta.className = 'exe-opt-meta';
    meta.textContent = `${f.rel.includes('\\') || f.rel.includes('/') ? f.rel : 'main folder'} · ${f.sizeMB} MB`;
    b.append(name, meta);
    b.addEventListener('click', () => {
      form.path = f.path;
      fPath.value = f.path;
      markExeChoice();
    });
    exeSuggestList.append(b);
  }
  exeSuggest.hidden = false;
  markExeChoice();
}
function markExeChoice() {
  for (const b of exeSuggestList.children) b.classList.toggle('selected', b.dataset.path === form.path);
}

document.getElementById('browsePath').addEventListener('click', async () => {
  const picked = await window.launcher.pickGameFile();
  if (!picked) return;
  form.path = picked.path;
  fPath.value = picked.path;
  markExeChoice();
  if (!fName.value.trim()) fName.value = picked.name;
});

document.getElementById('browseCover').addEventListener('click', async () => {
  const img = await window.launcher.pickCover();
  if (!img) return;
  form.coverSrc = img;
  form.resetCover = false;
  updateCoverPreview();
});

document.getElementById('resetCover').addEventListener('click', () => {
  form.coverSrc = null;
  form.resetCover = true;
  updateCoverPreview();
});

document.getElementById('cancelBtn').addEventListener('click', () => dialog.close());

document.getElementById('gameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.path) {
    showToast('Please choose a game file first.');
    return;
  }
  const name = fName.value.trim();
  if (form.mode === 'add') {
    games = await window.launcher.addGame({ name, path: form.path });
  } else {
    games = await window.launcher.updateGame({
      id: form.id,
      name,
      path: form.path,
      coverSrc: form.coverSrc,
      resetCover: form.resetCover,
    });
  }
  dialog.close();
  render();
});

document.getElementById('addBtn').addEventListener('click', () => openDialog('add'));
document.getElementById('emptyAddBtn').addEventListener('click', () => openDialog('add'));
document.getElementById('scanBtn').addEventListener('click', () => openScan());
document.getElementById('emptyScanBtn').addEventListener('click', () => openScan());

// ---------- Discover: a slim row of what's popular on Steam ----------
const discoverEl = document.getElementById('discover');
const discoverTabsEl = document.getElementById('discoverTabs');
const discoverRowEl = document.getElementById('discoverRow');

function discoverCard(it) {
  const card = make('button', 'dcard');
  card.type = 'button';
  card.title = `${it.name} (opens on Steam)`;
  const img = make('div', 'dimg');
  if (it.image) img.style.backgroundImage = `url("cover://discover/${encodeURIComponent(it.image)}")`;
  else img.style.background = `linear-gradient(135deg, hsl(${hueFor(it.name)} 38% 24%), hsl(${hueFor(it.name)} 38% 9%))`;
  if (it.discount) img.appendChild(make('span', 'dbadge', `-${it.discount}%`));
  card.append(img, make('div', 'dname', it.name), make('div', 'dprice' + (it.price === 'Free' ? ' free' : ''), it.price || '\u00a0'));
  card.addEventListener('click', () => window.launcher.discoverOpen(it.id));
  return card;
}

function buildDiscover() {
  const sections = discover.sections || [];
  if (!sections.some((s) => s.id === discoverTab)) discoverTab = sections[0] ? sections[0].id : '';
  discoverTabsEl.replaceChildren();
  for (const s of sections) {
    const b = make('button', 'dtab' + (s.id === discoverTab ? ' on' : ''), s.title);
    b.type = 'button';
    b.addEventListener('click', () => {
      discoverTab = s.id;
      buildDiscover();
    });
    discoverTabsEl.appendChild(b);
  }
  discoverRowEl.replaceChildren();
  discoverRowEl.scrollLeft = 0;
  discoverTarget = null;
  const sec = sections.find((s) => s.id === discoverTab);
  if (sec) sec.items.forEach((it) => discoverRowEl.appendChild(discoverCard(it)));
}

function updateDiscover() {
  const show = tab === 'library' && !query.trim() && settings.showDiscover !== false && (discover.sections || []).length > 0;
  discoverEl.hidden = !show;
}

async function loadDiscover(force) {
  try {
    discover = await window.launcher.discoverGet(!!force);
  } catch {
    discover = { sections: [] };
  }
  if (!discover || !Array.isArray(discover.sections)) discover = { sections: [] };
  buildDiscover();
  updateDiscover();
}

// Scrolling the row: one eased glide shared by the arrows and the mouse wheel.
let discoverTarget = null;
let discoverRaf = 0;
const discoverMax = () => Math.max(0, discoverRowEl.scrollWidth - discoverRowEl.clientWidth);

function discoverGlide(to) {
  discoverTarget = Math.max(0, Math.min(discoverMax(), to));
  if (discoverRaf) return;
  const tick = () => {
    if (discoverTarget === null) {
      discoverRaf = 0;
      return;
    }
    discoverTarget = Math.min(discoverTarget, discoverMax()); // the row may have shrunk meanwhile
    const diff = discoverTarget - discoverRowEl.scrollLeft;
    if (Math.abs(diff) <= 1) {
      discoverRowEl.scrollLeft = discoverTarget;
      discoverTarget = null;
      discoverRaf = 0;
      return;
    }
    const before = discoverRowEl.scrollLeft;
    discoverRowEl.scrollLeft += Math.sign(diff) * Math.max(1, Math.abs(diff) * 0.18);
    if (discoverRowEl.scrollLeft === before) {
      // it can't move (row hidden or already at its end): stop instead of spinning
      discoverTarget = null;
      discoverRaf = 0;
      return;
    }
    discoverRaf = requestAnimationFrame(tick);
  };
  discoverRaf = requestAnimationFrame(tick);
}

function scrollDiscover(dir) {
  const card = discoverRowEl.firstElementChild;
  const gap = parseFloat(getComputedStyle(discoverRowEl).columnGap) || 0;
  const step = card ? (card.offsetWidth + gap) * 3 : discoverRowEl.clientWidth * 0.8;
  discoverGlide((discoverTarget === null ? discoverRowEl.scrollLeft : discoverTarget) + dir * step);
}

// Mouse wheel over the row scrolls it sideways. At either end the wheel goes back to the
// page, so the row never traps the scroll. Trackpad side-swipes are left to the browser.
discoverRowEl.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return;
    const from = discoverTarget === null ? discoverRowEl.scrollLeft : discoverTarget;
    if ((e.deltaY < 0 && from <= 0) || (e.deltaY > 0 && from >= discoverMax() - 1)) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * discoverRowEl.clientWidth : e.deltaY;
    discoverGlide(from + px * 1.6);
  },
  { passive: false }
);
document.getElementById('discoverPrev').addEventListener('click', () => scrollDiscover(-1));
document.getElementById('discoverNext').addEventListener('click', () => scrollDiscover(1));
document.getElementById('discoverHide').addEventListener('click', async () => {
  await saveSettings({ showDiscover: false });
  updateDiscover();
  showToast('Discover is hidden. Turn it back on in Settings.', 'info');
});

// ---------- Scan this PC for games ----------
const scanDialog = document.getElementById('scanDialog');
const scanStatus = document.getElementById('scanStatus');
const scanList = document.getElementById('scanList');
const scanAddBtn = document.getElementById('scanAdd');
let scanItems = []; // { r: result, box: checkbox }
let scanning = false;

function scanView(name) {
  for (const id of ['scanChoose', 'scanBusy', 'scanResults']) document.getElementById(id).hidden = id !== name;
}

function openScan() {
  if (!scanning) scanView('scanChoose');
  if (!scanDialog.open) scanDialog.showModal();
}

function updateScanAddButton() {
  const n = scanItems.filter((x) => x.box.checked).length;
  scanAddBtn.disabled = n === 0;
  scanAddBtn.textContent = n === 0 ? 'Add games' : `Add ${n} game${n === 1 ? '' : 's'}`;
}

function showScanResults(res) {
  const results = res.results || [];
  const fresh = results.filter((r) => !r.already);
  const known = results.length - fresh.length;
  document.getElementById('scanSummary').textContent = results.length
    ? `${fresh.length} new game${fresh.length === 1 ? '' : 's'} found${known ? ` · ${known} already in your library` : ''}`
    : 'No games found';

  scanList.replaceChildren();
  scanItems = [];
  const ordered = [...fresh, ...results.filter((r) => r.already)];
  for (const r of ordered) {
    const row = make('label', 'scan-row' + (r.already ? ' is-added' : ''));
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !r.already;
    box.disabled = !!r.already;
    box.addEventListener('change', updateScanAddButton);
    const info = make('div', 'scan-info');
    const name = make('div', 'scan-name', r.name);
    const where = make('div', 'scan-path', r.path);
    where.title = r.path;
    info.append(name, where);
    row.append(box, info, make('span', 'scan-src', r.already ? 'Added' : r.source));
    scanList.appendChild(row);
    scanItems.push({ r, box });
  }

  const note = document.getElementById('scanNote');
  const notes = [];
  if (res.cancelled) notes.push('Scan stopped early, so this list may be incomplete.');
  else if (res.truncated) notes.push('This scan hit its time limit, so some folders weren\u2019t checked. Try a folder scan for the rest.');
  if (!results.length) notes.push('Nothing turned up. Try Whole PC, or pick the folder your games are in.');
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;

  scanList.hidden = !results.length;
  document.querySelector('#scanResults .scan-pick').hidden = !fresh.length;
  scanAddBtn.hidden = !fresh.length;
  updateScanAddButton();
  scanView('scanResults');
}

async function startScan(mode) {
  scanning = true;
  scanStatus.textContent = mode === 'folder' ? 'Choosing a folder\u2026' : 'Starting\u2026';
  scanView('scanBusy');
  let res;
  try {
    res = await window.launcher.scanRun(mode);
  } catch {
    res = { ok: false, error: 'The scan failed. Try again.' };
  }
  scanning = false;
  if (!scanDialog.open) return; // closed while scanning
  if (!res.ok) {
    showToast(res.error || 'The scan failed.');
    scanView('scanChoose');
  } else if (res.canceled) {
    scanView('scanChoose'); // they closed the folder picker
  } else {
    showScanResults(res);
  }
}

window.launcher.onScanProgress((p) => {
  if (!scanning) return;
  scanStatus.textContent = `${p.folders.toLocaleString()} folders checked \u00b7 ${p.found} game${p.found === 1 ? '' : 's'} found`;
});

document.querySelectorAll('.scan-opt').forEach((b) => b.addEventListener('click', () => startScan(b.dataset.mode)));
document.getElementById('scanCancel').addEventListener('click', () => {
  scanStatus.textContent = 'Stopping\u2026';
  window.launcher.scanCancel();
});
document.getElementById('scanAgain').addEventListener('click', () => scanView('scanChoose'));
document.getElementById('scanAll').addEventListener('click', () => {
  scanItems.forEach((x) => { if (!x.box.disabled) x.box.checked = true; });
  updateScanAddButton();
});
document.getElementById('scanNone').addEventListener('click', () => {
  scanItems.forEach((x) => { x.box.checked = false; });
  updateScanAddButton();
});
document.getElementById('scanClose').addEventListener('click', () => scanDialog.close());
scanDialog.addEventListener('close', () => {
  if (scanning) window.launcher.scanCancel();
});
scanAddBtn.addEventListener('click', async () => {
  const paths = scanItems.filter((x) => x.box.checked).map((x) => x.r.path);
  if (!paths.length) return;
  scanAddBtn.disabled = true;
  scanAddBtn.textContent = 'Adding\u2026';
  try {
    games = await window.launcher.scanAdd(paths);
  } catch {
    showToast('Could not add the games. Try again.');
    updateScanAddButton();
    return;
  }
  scanDialog.close();
  render({ intro: true });
  showToast(`Added ${paths.length} game${paths.length === 1 ? '' : 's'}. Finding covers\u2026`, 'info');
});

// ---------- Startup ----------
const splash = document.getElementById('splash');
const splashFill = document.getElementById('splashFill');
const splashStatus = document.getElementById('splashStatus');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStep(text, percent) {
  const span = document.createElement('span');
  span.textContent = text;
  splashStatus.replaceChildren(span);
  splashFill.style.width = percent + '%';
}

// Update check hook. There is no updater wired up yet, so this just resolves
// after a short beat. Swap the body for a real check (e.g. electron-updater via
// preload) and return { available: true } when a new version exists.
async function checkForUpdates() {
  await wait(800);
  return { available: false };
}

async function boot() {
  document.querySelectorAll('[data-rise]').forEach((el) => el.style.setProperty('--i', el.dataset.rise));

  window.launcher.onLibraryChanged((updated) => {
    games = updated;
    render();
  });
  window.launcher.onLaunchError(showToast);
  window.launcher.onLaunchTrouble(showLaunchTrouble);
  window.launcher.getUpdate().then(showUpdate).catch(() => {});
  window.launcher.onUpdate(showUpdate);
  window.launcher.onAccountChanged((state) => {
    account = state;
    renderAccount();
  });

  try { settings = await window.launcher.getSettings(); } catch {}
  if (settings.showDiscover !== false) loadDiscover(false); // runs in the background, never delays startup
  applySettings();
  window.launcher.getAppInfo().then((info) => { appInfo = info; if (tab === 'settings') renderSettings(); }).catch(() => {});
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInk);

  const accountPromise = window.launcher.getAccount().catch(() => account);
  const libraryPromise = window.launcher.getLibrary().catch(() => []);

  // "Startup animation" off: skip the loading screen and go straight in.
  if (settings.startupAnimation === false) {
    account = await accountPromise;
    document.body.classList.add('instant');
    splash.classList.add('done');
    booted = true;
    games = await libraryPromise;
    animateCards = false;
    document.body.classList.add('ready');
    renderAccount();
    render();
    setTimeout(showWelcome, 700);
    return;
  }

  setStep('Checking for updates', 30);
  await checkForUpdates();

  setStep('Checking account', 60);
  account = await accountPromise;
  setStep('Loading library', 85);
  games = await libraryPromise;
  render();
  renderAccount();
  await wait(400);

  setStep('Ready', 100);
  await wait(450);

  booted = true;
  splash.classList.add('done');
  document.body.classList.add('ready');
  setTimeout(() => { animateCards = false; }, 1800);
  setTimeout(showWelcome, 900);
}

// ---------- Downloads: games from the user's sources, on the home page ----------
const dlSection = document.getElementById('dlSection');
const dlTabsEl = document.getElementById('dlTabs');
const dlActiveEl = document.getElementById('dlActive');
const dlGridEl = document.getElementById('dlGrid');
const dlSearch = document.getElementById('dlSearch');
const dlTotalEl = document.getElementById('dlTotal');
const dlNone = document.getElementById('dlNone');
const dlMoreBtn = document.getElementById('dlMore');
const dlShowBtn = document.getElementById('dlShowBtn');
const dlCount = document.getElementById('dlCount');
const sourceDialog = document.getElementById('sourceDialog');
const srcForm = document.getElementById('srcForm');
const srcUrl = document.getElementById('srcUrl');
const srcAddBtn = document.getElementById('srcAddBtn');
const srcMsg = document.getElementById('srcMsg');
const srcList = document.getElementById('srcList');

let sourcesReady = false; // the saved sources have been read at least once
let sourceList = [];
let sourceItems = [];
let downloadList = [];
let dlQuery = '';
let dlSource = 'all'; // 'all' or a source id
let dlLimit = 24;
let dlGridKey = '';
const coverMemo = new Map(); // item title -> { file, tint } | null

const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

function bytesText(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

// Electron prefixes errors thrown in the main process; show just the message.
function cleanIpcError(err) {
  return String((err && err.message) || err || 'Something went wrong.').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}

function miniBtn(label, onClick, primary = false) {
  const b = make('button', 'btn sm' + (primary ? ' primary' : ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function loadSourcesData() {
  try {
    [sourceList, sourceItems, downloadList] = await Promise.all([
      window.launcher.sourcesList(),
      window.launcher.sourcesItems(),
      window.launcher.downloadsList(),
    ]);
  } catch {}
  sourcesReady = true;
  if (dlSource !== 'all' && !sourceList.some((s) => s.id === dlSource)) dlSource = 'all';
  updateDownloads();
  if (sourceDialog.open) renderSourceList();
}

function downloadFor(item) {
  // the latest download of this file that is still relevant
  for (let i = downloadList.length - 1; i >= 0; i--) if (downloadList[i].url === item.url) return downloadList[i];
  return null;
}

// ----- the Downloads tab -----
// The tab sits between Library and Favorites. It exists once a source has files in it
// (and the user hasn't hidden it); the library page itself is never pushed down by it.
function updateDownloads() {
  const hasItems = sourceItems.length > 0;
  const wanted = settings.showDownloads !== false;
  // Library page: explain how to download games until the user has added a source (or said "Not now")
  document.getElementById('sourcePromo').hidden = !(tab === 'library' && sourcesReady && sourceList.length === 0 && !settings.promoDismissed);
  const available = hasItems && wanted;

  const dlTabBtn = document.getElementById('dlTab');
  const wasHidden = dlTabBtn.hidden;
  dlTabBtn.hidden = !available;
  const active = downloadList.filter((d) => d.status === 'downloading' || d.status === 'queued').length;
  dlCount.textContent = String(active);
  dlCount.hidden = active === 0;
  if (wasHidden !== dlTabBtn.hidden) moveInk();

  // "Downloads" button on the library page: only when the tab was hidden but there are sources to show
  dlShowBtn.hidden = !(tab === 'library' && hasItems && !wanted);

  if (tab === 'downloads' && !available) { setTab('library'); return; }
  if (tab !== 'downloads' || !available) return;

  document.getElementById('dlSub').textContent =
    `${sourceItems.length} game${sourceItems.length === 1 ? '' : 's'} from ${sourceList.length} source${sourceList.length === 1 ? '' : 's'}`;
  renderDlTabs();
  renderDlActive();
  renderDlGrid();
}

function renderDlTabs() {
  dlTabsEl.replaceChildren();
  if (sourceList.length < 2) return; // a single source doesn't need a filter
  const mk = (id, label) => {
    const b = make('button', 'dtab' + (dlSource === id ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { dlSource = id; dlLimit = 24; updateDownloads(); });
    dlTabsEl.appendChild(b);
  };
  mk('all', 'All');
  for (const s of sourceList) if (s.count) mk(s.id, s.name);
}

function dlStatusText(d) {
  if (d.status === 'extracting') return d.extractPct ? `Unpacking… ${d.extractPct}%` : 'Unpacking…';
  if (d.status === 'done') {
    const lib = d.addedToLibrary ? ' · Added to your library' : '';
    return d.note ? d.note : `Finished · ${bytesText(d.total || d.received)}${lib}`;
  }
  if (d.status === 'error') return d.error || 'Download failed.';
  if (d.status === 'queued') return 'Waiting…';
  if (d.status === 'waiting') return d.note || 'Press Download on the page that opened and wait. The download starts by itself.';
  const pct = d.total ? ` (${Math.floor((d.received / d.total) * 100)}%)` : '';
  const speed = d.status === 'downloading' && d.speed ? ` · ${bytesText(d.speed)}/s` : '';
  const of = d.total ? ` of ${bytesText(d.total)}` : '';
  return `${d.status === 'paused' ? 'Paused · ' : ''}${bytesText(d.received) || '0 B'}${of}${pct}${speed}`;
}

// A slim list of what's downloading (or just finished) so progress is visible without hunting for the card.
function renderDlActive() {
  const list = [...downloadList].reverse();
  dlActiveEl.hidden = list.length === 0;
  dlActiveEl.replaceChildren();
  if (!list.length) return;

  const head = make('div', 'dl-active-head');
  head.append(make('span', 'dl-active-title', 'Your downloads'));
  if (list.some((d) => d.status === 'done' || d.status === 'error')) {
    const clear = make('button', 'link', 'Clear finished');
    clear.type = 'button';
    clear.addEventListener('click', async () => {
      for (const d of downloadList.filter((x) => x.status === 'done' || x.status === 'error')) await window.launcher.downloadRemove(d.id);
    });
    head.append(clear);
  }
  dlActiveEl.append(head);

  for (const d of list.slice(0, 6)) {
    const row = make('div', `dl-row ${d.status}`);
    const main = make('div', 'row-main');
    main.append(make('div', 'row-title', d.fileName || d.title));
    main.append(make('div', 'row-sub' + (d.status === 'error' ? ' err' : ''), dlStatusText(d)));
    if (d.status !== 'done') {
      const bar = make('div', 'dl-bar');
      const fill = make('span');
      fill.style.width = d.status === 'error' ? '100%' : d.status === 'extracting' ? `${Math.max(4, d.extractPct || 0)}%` : d.total ? `${Math.min(100, (d.received / d.total) * 100)}%` : d.status === 'downloading' ? '8%' : '0';
      bar.append(fill);
      main.append(bar);
    }
    const actions = make('div', 'row-actions');
    if (d.status === 'downloading' || d.status === 'queued') actions.append(miniBtn('Pause', () => window.launcher.downloadPause(d.id)));
    if (d.status === 'waiting') actions.append(miniBtn('Open page', () => window.launcher.downloadFocus(d.id), true));
    if (d.status === 'paused') actions.append(miniBtn('Resume', () => window.launcher.downloadResume(d.id), true));
    if (d.status === 'error') actions.append(miniBtn('Retry', () => window.launcher.downloadResume(d.id), true));
    if (d.status === 'done') {
      actions.append(miniBtn('Show', () => window.launcher.downloadShow(d.id)));
      if (!d.addedToLibrary && /\.(exe|bat|cmd)$/i.test(d.fileName)) {
        actions.append(miniBtn('Add to library', async () => {
          const info = await window.launcher.downloadPrepareGame(d.id);
          if (!info) return showToast('That file is no longer there.');
          await window.launcher.addGame(info);
          showToast('Added to your library.', 'info');
        }, true));
      }
    }
    actions.append(miniBtn(d.status === 'done' ? 'Clear' : 'Cancel', () => window.launcher.downloadRemove(d.id)));
    row.append(main, actions);
    dlActiveEl.append(row);
  }
  if (list.length > 6) dlActiveEl.append(make('div', 'dl-active-more', `+ ${list.length - 6} more`));
}

// ----- the cards -----
// Only things that are clearly not a game. This list used to be much longer (patch, update, demo, dlc,
// hack...) and hid real games that just have those words in their name.
const JUNK_RE = /\b(keygen|wallpapers?|soundtrack|artbook|readme|nfo|vcredist|redist|directx)\b/i;
function sizeMB(t) {
  const m = /([\d.,]+)\s*(KB|MB|GB|TB)/i.exec(t || '');
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.')) * { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1048576 }[m[2].toUpperCase()];
}
function looksLikeGame(i) {
  if (JUNK_RE.test(i.title)) return false;
  if (/\.(txt|nfo|jpg|png|pdf|mp3|flac|srt|json|xml)$/i.test(i.title)) return false;
  const mb = sizeMB(i.size);
  return mb === null || mb >= 20; // tiny files (under 20 MB) are not games; small indie games are kept
}

function filteredItems() {
  const q = dlQuery.trim().toLowerCase();
  const list = sourceItems.filter(
    (i) => looksLikeGame(i) && (dlSource === 'all' || i.sourceId === dlSource) && (!q || i.title.toLowerCase().includes(q))
  );
  return sortItems(list);
}

// Sorting for the Downloads page. "default" keeps the order the sources listed the games in.
// Games with no size or date known always go to the end, whichever way it is sorted.
let dlSort = 'default';
try { dlSort = localStorage.getItem('zruxr.dlSort') || 'default'; } catch {}
const dlByName = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
function sortItems(list) {
  if (dlSort === 'default') return list;
  const out = [...list];
  const withKey = (get, dir) => (a, b) => {
    const x = get(a), y = get(b);
    if (x === null && y === null) return dlByName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return x === y ? dlByName(a, b) : (x - y) * dir;
  };
  const size = (i) => sizeMB(i.size);
  const date = (i) => { const t = Date.parse(i.date || ''); return Number.isNaN(t) ? null : t; };
  if (dlSort === 'az') out.sort(dlByName);
  else if (dlSort === 'za') out.sort((a, b) => dlByName(b, a));
  else if (dlSort === 'big') out.sort(withKey(size, -1));
  else if (dlSort === 'small') out.sort(withKey(size, 1));
  else if (dlSort === 'new') out.sort(withKey(date, -1));
  else if (dlSort === 'old') out.sort(withKey(date, 1));
  return out;
}

// Cover art is looked up lazily, only for cards that scroll into view.
const coverObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      coverObserver.unobserve(e.target);
      loadCardCover(e.target);
    }
  },
  { rootMargin: '300px' }
);

function applyCover(coverEl, article, info) {
  if (!info || !info.file) return;
  coverEl.replaceChildren(...[...coverEl.children].filter((c) => !c.classList.contains('ph-letter') && !c.classList.contains('ph-name')));
  coverEl.classList.remove('placeholder');
  coverEl.style.backgroundImage = `url("${coverUrl(info.file)}")`;
  coverEl.classList.add('has-art');
  if (Array.isArray(info.tint) && info.tint.length === 3) article.style.setProperty('--glow', info.tint.join(', '));
}

async function loadCardCover(coverEl) {
  const article = coverEl.closest('.game');
  const title = coverEl.dataset.title;
  if (!article || !title) return;
  if (!coverMemo.has(title)) {
    coverMemo.set(title, window.launcher.sourceCover(title).catch(() => null).then((r) => { coverMemo.set(title, r); return r; }));
  }
  const info = await coverMemo.get(title);
  // No cover found: keep the card with its letter placeholder. (Cards without a Steam match used to be
  // removed, which is why some games showed up and others did not.)
  if (info && coverEl.isConnected) applyCover(coverEl, article, info);
}

// A short fingerprint of what a card's button shows, so unchanged buttons are left alone.
function sigFor(item) {
  const d = downloadFor(item);
  return d ? `${d.id}:${d.status}:${d.status === 'extracting' ? d.extractPct || 0 : d.total ? Math.floor((d.received / d.total) * 100) : d.received ? 1 : 0}:${d.addedToLibrary ? 1 : 0}` : 'none';
}

// ----- a host's page shown inside the launcher (Gofile, FileKeeper, ...) -----
// The page itself is drawn by the app over the body of this card; this is the frame around it.
const hostPanel = document.getElementById('hostPanel');
const hostSub = document.getElementById('hostSub');
let hostPanelId = null;
function renderHostLinks(links, id) {
  const wrap = document.getElementById('hostLinks');
  wrap.replaceChildren();
  if (!links || links.length < 2) return; // nothing to switch to
  links.forEach((l, i) => {
    const b = make('button', 'host-link' + (l.active ? ' active' : ''), l.label);
    if (l.issue) b.append(make('span', 'link-note', `(${l.issue})`));
    b.type = 'button';
    b.title = l.active ? 'Showing this host' : `Try ${l.label} instead`;
    if (!l.active) b.addEventListener('click', () => window.launcher.hostSwitch(id, i));
    wrap.append(b);
  });
}
function showHostSub(text, warn) {
  hostSub.textContent = text;
  hostSub.classList.toggle('warn', !!warn);
}
// The how-to strip under the title. A blocked popup turns it into a big orange warning until the
// person presses Download again (the next real download or navigation puts the normal text back).
const hostHintEl = document.getElementById('hostHint');
const hostHintText = document.getElementById('hostHintText');
let hostHintNormal = '';
function showHostHint(text) { hostHintNormal = text || ''; hostHintEl.classList.remove('alert'); hostHintText.textContent = hostHintNormal; }
function flashPopupBlocked(text) {
  hostHintText.textContent = '⚠ ' + text;
  hostHintEl.classList.remove('alert');
  void hostHintEl.offsetWidth; // restart the shake each time another popup is blocked
  hostHintEl.classList.add('alert');
}
window.launcher.onHostOpen((p) => {
  hostPanelId = p.id;
  const L = p.layout || {};
  const card = hostPanel.querySelector('.host-card');
  card.style.setProperty('--hp-side', (L.side ?? 28) + 'px');
  card.style.setProperty('--hp-top', ((L.top ?? 68) - 48) + 'px'); // the panel starts below the 48px title bar
  card.style.setProperty('--hp-bottom', (L.bottom ?? 28) + 'px');
  card.style.setProperty('--hp-head', (L.header ?? 56) + 'px');
  document.getElementById('hostTitle').textContent = p.title || 'Download';
  showHostSub(p.host ? `${p.host} · the download starts by itself` : 'Opening the page…');
  showHostHint(p.hint);
  renderHostLinks(p.links, p.id);
  hostPanel.hidden = false;
});
window.launcher.onHostStatus((p) => {
  if (p.id !== hostPanelId) return;
  if (p.popup) { flashPopupBlocked(p.message); return; }
  if (p.message) showHostSub(p.message, true);
  else if (p.host) showHostSub(`${p.host} · the download starts by itself`);
});
window.launcher.onHostClose((p) => {
  if (p.id !== hostPanelId) return;
  hostPanel.hidden = true;
  hostPanelId = null;
});
document.getElementById('hostClose').addEventListener('click', () => hostPanelId && window.launcher.hostClose(hostPanelId));
document.getElementById('hostBrowser').addEventListener('click', () => hostPanelId && window.launcher.hostBrowser(hostPanelId));
document.getElementById('hostAdopt').addEventListener('click', async () => {
  if (!hostPanelId) return;
  try { await window.launcher.hostAdopt(hostPanelId); } catch (err) { showToast(cleanIpcError(err)); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !hostPanel.hidden && hostPanelId) { e.preventDefault(); window.launcher.hostClose(hostPanelId); }
});

// "Save to" step shown when Download is clicked. The default is the launcher's own folder; the
// user can pick another for this one download, or make the new folder the default.
// Resolves to { dir, makeDefault } (dir is '' for the default) or null if cancelled.
const saveDialog = document.getElementById('saveDialog');
function askSaveLocation(item) {
  return new Promise((resolve) => {
    const defaultDir = downloadDir;
    let picked = ''; // '' = use the default folder
    const pathEl = document.getElementById('savePath');
    const defRow = document.getElementById('saveDefaultRow');
    const defBox = document.getElementById('saveDefault');
    const render = () => {
      pathEl.textContent = picked || defaultDir || '…';
      defRow.hidden = !picked || picked === defaultDir;
      if (defRow.hidden) defBox.checked = false;
    };
    document.getElementById('saveTitle').textContent = item.title || '';

    // which host to download from (best one is pre-selected; a host with a known problem is marked)
    const hosts = Array.isArray(item.hosts) ? item.hosts : [];
    let hostIndex = hosts.length ? Math.max(0, hosts.findIndex((h) => !h.issue)) : undefined;
    const hostsWrap = document.getElementById('saveHosts');
    const browserNote = document.getElementById('saveBrowserNote');
    const renderHosts = () => {
      document.getElementById('saveHostsRow').hidden = !hosts.length;
      hostsWrap.replaceChildren();
      hosts.forEach((h, i) => {
        const b = make('button', 'host-opt', h.label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(i === hostIndex));
        if (h.issue) b.append(make('span', 'opt-note', `(${h.issue})`));
        b.title = h.via === 'direct' ? 'Downloads automatically' : 'Opens the host\'s page here so you can finish its check';
        b.addEventListener('click', () => { hostIndex = i; renderHosts(); });
        hostsWrap.append(b);
      });
      const via = hosts.length ? hosts[hostIndex].via : item.via;
      browserNote.hidden = via !== 'browser';
      const hint = hosts.length && hosts[hostIndex].hint;
      browserNote.textContent = (hint ? hint + ' ' : "Press Download on the page and wait. ");
    };
    renderHosts();
    render();

    const change = document.getElementById('saveChange');
    const go = document.getElementById('saveGo');
    const cancel = document.getElementById('saveCancel');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      change.removeEventListener('click', onChange);
      go.removeEventListener('click', onGo);
      cancel.removeEventListener('click', onCancel);
      saveDialog.removeEventListener('close', onCancel);
      if (saveDialog.open) saveDialog.close();
      resolve(value);
    };
    const onChange = async () => {
      try {
        const dir = await window.launcher.downloadPickDirFor();
        if (dir) { picked = dir === defaultDir ? '' : dir; render(); }
      } catch (err) { showToast(cleanIpcError(err)); }
    };
    const onGo = () => finish({ dir: picked, makeDefault: !defRow.hidden && defBox.checked, hostIndex });
    const onCancel = () => finish(null);
    change.addEventListener('click', onChange);
    go.addEventListener('click', onGo);
    cancel.addEventListener('click', onCancel);
    saveDialog.addEventListener('close', onCancel); // Esc
    saveDialog.showModal();
    go.focus();
  });
}

function bigButton(item) {
  const d = downloadFor(item);
  const btn = make('button', 'dl-big');
  btn.dataset.sig = sigFor(item);
  btn.type = 'button';
  const pct = d && d.total ? Math.min(100, (d.received / d.total) * 100) : 0;
  let label = 'Download';
  let onClick = async () => {
    btn.disabled = true;
    try {
      const choice = await askSaveLocation(item);
      if (!choice) { btn.disabled = false; return; } // cancelled
      await window.launcher.downloadStart({ sourceId: item.sourceId, itemId: item.id, dir: choice.dir, makeDefault: choice.makeDefault, hostIndex: choice.hostIndex });
      if (choice.makeDefault) downloadDir = choice.dir;
    } catch (err) {
      showToast(cleanIpcError(err));
      btn.disabled = false;
    }
  };
  let icon = ICON_DOWNLOAD;

  if (d && d.status === 'downloading') {
    label = d.total ? `${Math.floor(pct)}%` : 'Downloading…';
    btn.classList.add('busy');
    btn.style.setProperty('--p', pct + '%');
    icon = '';
    onClick = () => window.launcher.downloadPause(d.id);
    btn.title = 'Click to pause';
  } else if (d && d.status === 'queued') {
    label = 'Waiting…'; btn.classList.add('busy'); btn.style.setProperty('--p', '0%'); icon = '';
    onClick = () => window.launcher.downloadPause(d.id);
  } else if (d && d.status === 'waiting') {
    label = 'Waiting for you…'; btn.classList.add('busy'); btn.style.setProperty('--p', '0%'); icon = '';
    btn.title = 'Click to bring the page back';
    onClick = () => window.launcher.downloadFocus(d.id);
  } else if (d && d.status === 'paused') {
    label = 'Resume'; btn.classList.add('paused'); btn.style.setProperty('--p', pct + '%');
    onClick = () => window.launcher.downloadResume(d.id);
  } else if (d && d.status === 'error') {
    label = 'Retry'; btn.classList.add('failed'); btn.title = d.error || '';
    onClick = () => window.launcher.downloadResume(d.id);
  } else if (d && d.status === 'extracting') {
    label = d.extractPct ? `Unpacking ${d.extractPct}%` : 'Unpacking…';
    btn.classList.add('busy'); btn.style.setProperty('--p', Math.max(4, d.extractPct || 0) + '%'); icon = '';
    btn.title = 'Unpacking the game files';
    onClick = () => {};
  } else if (d && d.status === 'done') {
    label = d.addedToLibrary ? 'In library' : 'Downloaded'; btn.classList.add('done'); icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    btn.title = 'Show in folder';
    onClick = () => window.launcher.downloadShow(d.id);
  }
  btn.innerHTML = icon + `<span>${label}</span>`;
  btn.addEventListener('click', onClick);
  return btn;
}

// Decorative download count, stable per title (not real data).
function fakeDownloads(title) {
  let h = 0;
  for (const c of String(title)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = Math.floor(8000 + ((h % 1000) / 1000) ** 2.2 * 2400000);
  const t = n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1000) + 'K';
  return `${t} downloads`;
}

function renderDlGrid() {
  const all = filteredItems();
  const shown = all.slice(0, dlLimit);
  dlTotalEl.textContent = sourceItems.length ? (all.length === sourceItems.length ? `${all.length}` : `${all.length} of ${sourceItems.length}`) : '';
  dlNone.hidden = all.length > 0;
  dlMoreBtn.hidden = all.length <= dlLimit;
  dlMoreBtn.textContent = `Show more (${all.length - dlLimit} left)`;

  // Progress ticks several times a second; if only the buttons changed, update them in place
  // instead of rebuilding every card (which would flicker covers and reset scrolling).
  const key = shown.map((i) => i.id).join(',');
  if (key === dlGridKey) {
    const cards = dlGridEl.children;
    shown.forEach((it, i) => {
      const old = cards[i] && cards[i].querySelector('.dl-big');
      if (old && old.dataset.sig !== sigFor(it)) old.replaceWith(bigButton(it));
    });
    return;
  }
  dlGridKey = key;

  dlGridEl.replaceChildren();
  shown.forEach((it) => {
    const g = { name: it.title };
    const article = make('article', 'game dgame');
    article.style.setProperty('--glow', glowFor(g));
    const cover = make('div', 'cover');
    cover.dataset.title = it.title;
    const known = coverMemo.get(it.title);
    if (known && known.file) { paintPlaceholder(cover, g); applyCover(cover, article, known); }
    else { paintPlaceholder(cover, g); coverObserver.observe(cover); }
    article.append(cover);

    const name = make('div', 'game-name', it.title);
    name.title = it.title;
    const meta = make('div', 'game-meta', [it.size, it.sourceName].filter(Boolean).join(' · ') || ' ');
    article.append(name, meta, bigButton(it));
    dlGridEl.append(article);
  });
}

window.launcher.onSourcesChanged(() => loadSourcesData()); // sources were re-read in the background
const dlSortEl = document.getElementById('dlSort');
if (![...dlSortEl.options].some((o) => o.value === dlSort)) dlSort = 'default';
dlSortEl.value = dlSort;
dlSortEl.addEventListener('change', () => {
  dlSort = dlSortEl.value;
  try { localStorage.setItem('zruxr.dlSort', dlSort); } catch {}
  dlLimit = 24; dlGridKey = ''; renderDlGrid();
});
dlSearch.addEventListener('input', () => { dlQuery = dlSearch.value; dlLimit = 24; dlGridKey = ''; renderDlGrid(); });
dlMoreBtn.addEventListener('click', () => { dlLimit += 24; dlGridKey = ''; renderDlGrid(); });
document.getElementById('dlHide').addEventListener('click', async () => {
  settings = await window.launcher.setSettings({ showDownloads: false });
  renderSettings();
  setTab('library');
  updateDownloads();
});
dlShowBtn.addEventListener('click', async () => {
  settings = await window.launcher.setSettings({ showDownloads: true });
  renderSettings();
  updateDownloads();
  setTab('downloads');
});

// ----- add / manage sources -----
function showSrcMsg(text, kind = 'error') {
  srcMsg.textContent = text || '';
  srcMsg.className = 'src-msg' + (kind === 'info' ? ' info' : '');
  srcMsg.hidden = !text;
}

function renderSourceList() {
  srcList.replaceChildren();
  for (const s of sourceList) {
    const row = make('div', 'src-row');
    const main = make('div', 'row-main');
    main.append(make('div', 'row-title', s.name || s.url));
    const sub = make('div', 'row-sub' + (s.error ? ' err' : ''));
    sub.textContent = s.error
      ? `${s.error}`
      : `${s.count} file${s.count === 1 ? '' : 's'}` + (s.skipped ? ` · ${s.skipped} unsupported link${s.skipped === 1 ? '' : 's'} skipped` : '');
    sub.title = s.url;
    main.append(sub);
    const actions = make('div', 'row-actions');
    actions.append(
      miniBtn('Refresh', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = 'Refreshing…';
        await window.launcher.sourcesRefresh(s.id).catch(() => {});
        dlGridKey = '';
        await loadSourcesData();
      }),
      miniBtn('Remove', async () => {
        await window.launcher.sourcesRemove(s.id);
        dlGridKey = '';
        await loadSourcesData();
      })
    );
    row.append(main, actions);
    srcList.append(row);
  }
}

function openSourceDialog() {
  showSrcMsg('');
  srcUrl.value = '';
  renderSourceList();
  if (!sourceDialog.open) sourceDialog.showModal();
  srcUrl.focus();
}

srcForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = srcUrl.value.trim();
  if (!url) return;
  srcAddBtn.disabled = true;
  srcAddBtn.textContent = 'Reading…';
  showSrcMsg('Reading the source. Big folders can take a little while…', 'info');
  try {
    const added = await window.launcher.sourcesAdd(url);
    showSrcMsg('');
    dlGridKey = '';
    dlSource = 'all';
    await loadSourcesData();
    sourceDialog.close();
    if (settings.showDownloads === false) {
      settings = await window.launcher.setSettings({ showDownloads: true });
      renderSettings();
    }
    updateDownloads();
    setTab('downloads'); // take the user to the new Downloads tab
    showToast(`Added ${added.name || 'source'}: ${added.count} file${added.count === 1 ? '' : 's'} ready to download.`, 'info');
  } catch (err) {
    showSrcMsg(cleanIpcError(err));
  } finally {
    srcAddBtn.disabled = false;
    srcAddBtn.textContent = 'Add';
  }
});

document.getElementById('sourceBtn').addEventListener('click', openSourceDialog);
document.getElementById('emptySourceBtn').addEventListener('click', openSourceDialog);
document.getElementById('promoAdd').addEventListener('click', openSourceDialog);
document.getElementById('promoDismiss').addEventListener('click', async () => {
  settings = await window.launcher.setSettings({ promoDismissed: true });
  updateDownloads();
});
document.getElementById('dlManage').addEventListener('click', openSourceDialog);
document.getElementById('sourceClose').addEventListener('click', () => sourceDialog.close());

document.getElementById('pickDlDir').addEventListener('click', async () => {
  downloadDir = await window.launcher.downloadPickDir();
  renderSettings();
});

window.launcher.onDownloads((list) => {
  downloadList = list;
  updateDownloads(); // refreshes the tab count, and the cards/strip when the Downloads tab is open
});
window.launcher.downloadDir().then((d) => { downloadDir = d; if (tab === 'settings') renderSettings(); }).catch(() => {});
loadSourcesData();

boot();


// ---------- Auto-update ----------
const updateBar = document.getElementById('updateBar');
const updateNowBtn = document.getElementById('updateNow');
let updateDismissed = false;
let updateState = null;
let updateAnnounced = ''; // version whose "new version" message was already dismissed
function showUpdate(u) {
  updateState = u;
  renderUpdateSetting();
  // A new version was found: say so straight away (not only once it has finished downloading).
  if (!u || (u.status !== 'downloading' && u.status !== 'ready') || !u.version) {
    updateBar.hidden = true;
    return;
  }
  if (updateDismissed && updateAnnounced === u.version) { updateBar.hidden = true; return; }
  if (updateAnnounced !== u.version) { updateDismissed = false; updateAnnounced = u.version; }
  const ready = u.status === 'ready';
  document.getElementById('updateText').textContent = ready
    ? `Zruxr ${u.version} is ready to install.`
    : `New version available: Zruxr ${u.version}. Downloading… ${u.percent || 0}%`;
  updateNowBtn.hidden = !ready;
  updateBar.hidden = updateDismissed;
}
function renderUpdateSetting() {
  const desc = document.getElementById('updateDesc');
  const btn = document.getElementById('checkUpdate');
  if (!desc || !btn) return;
  const u = updateState || { status: 'unsupported' };
  const now = appInfo.version ? `Zruxr ${appInfo.version}. ` : '';
  const text = {
    unsupported: `${now}Updates install automatically in the installed app (not the portable version or npm start).`,
    idle: `${now}Checks for updates on start and every few hours.`,
    checking: `${now}Checking for updates…`,
    current: `${now}You are on the latest version.`,
    downloading: `${now}New version ${u.version || ''} found. Downloading… ${u.percent || 0}%`,
    ready: `${now}Version ${u.version || ''} is ready. It installs when you close Zruxr.`,
    error: `${now}Could not check for updates${u.error ? `: ${u.error}` : '.'}`,
  }[u.status] || now;
  desc.textContent = text;
  desc.classList.toggle('warn', u.status === 'error');
  btn.disabled = !['idle', 'current', 'error'].includes(u.status);
  btn.hidden = u.status === 'unsupported';
}
document.getElementById('checkUpdate').addEventListener('click', async () => {
  try { showUpdate(await window.launcher.checkUpdate()); } catch {}
});
updateNowBtn.addEventListener('click', () => window.launcher.installUpdate());
document.getElementById('updateLater').addEventListener('click', () => {
  updateDismissed = true; // it still installs by itself the next time Zruxr closes
  updateBar.hidden = true;
});
