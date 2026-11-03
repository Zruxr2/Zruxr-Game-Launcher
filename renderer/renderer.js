const main = document.getElementById('main');
const tabsEl = document.getElementById('tabs');
const tabInk = document.getElementById('tabInk');
const favCount = document.getElementById('favCount');
const pageGames = document.getElementById('pageGames');
const pageStats = document.getElementById('pageStats');
const pageFriends = document.getElementById('pageFriends');
const pageSettings = document.getElementById('pageSettings');

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
let tab = 'library'; // 'library' | 'favorites' | 'stats' | 'friends' | 'settings'
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
  main.scrollTop = 0;

  render({ intro: true });

  if (!onGames) {
    const page = name === 'stats' ? pageStats : name === 'friends' ? pageFriends : pageSettings;
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

  const q = query.trim().toLowerCase();
  const visible = base.filter((g) => !q || g.name.toLowerCase().includes(q)).sort(sorters[settings.sort] || byName);

  sectionTitle.textContent = isFav ? 'Starred games' : 'All games';
  sectionCount.textContent = base.length ? (q ? `${visible.length} of ${base.length}` : String(base.length)) : '';
  noResults.hidden = !(base.length > 0 && visible.length === 0);

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
  else renderGames(opts);
}

function handleLaunchResult(res) {
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

document.getElementById('browsePath').addEventListener('click', async () => {
  const picked = await window.launcher.pickGameFile();
  if (!picked) return;
  form.path = picked.path;
  fPath.value = picked.path;
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

boot();
