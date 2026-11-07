'use strict';
// resolvers.js
// Pixeldrain links download by themselves. Other hosts (Gofile, FileKeeper, ...) are opened in a window
// so the person can press the host's Download button; see canOpenInBrowser below.
// Pixeldrain: the launcher keeps a link only if it points to ONE Pixeldrain file.
//   https://pixeldrain.com/u/<id>              (page link, rewritten to the API link when downloading)
//   https://pixeldrain.com/api/file/<id>       (direct link, used as it is)
// Everything else (other hosts, /l/ lists, http://) is ignored, and a game with no
// Pixeldrain link is removed from the list.

const PIXELDRAIN_FILE = /^\/(u|api\/file)\/([A-Za-z0-9_-]+)\/?$/;

function parsePixeldrain(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:") return null;
    if (url.hostname.replace(/^www\./, "") !== "pixeldrain.com") return null;
    const m = PIXELDRAIN_FILE.exec(url.pathname);
    return m ? { kind: m[1], id: m[2] } : null;
  } catch {
    return null;
  }
}

// Turns a link into the URL that is really fetched.
function resolveLink(link) {
  const p = parsePixeldrain(link);
  if (p && p.kind === "u") return `https://pixeldrain.com/api/file/${p.id}?download`;
  return link;
}

function canDownload(link) {
  return parsePixeldrain(link) !== null;
}

// A normal public web address: http(s), a real host name or a public IP address, no logins in the
// address, and nothing that points at this computer or a home/office network (the host's page is
// opened inside the launcher, so those must never be reachable).
function isPublicWebUrl(link) {
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (ip) {
      const [a, b, c, d] = ip.slice(1).map(Number);
      if ([a, b, c, d].some((n) => n > 255)) return false;
      if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this host, private, loopback, multicast/reserved
      if (a === 169 && b === 254) return false; // link-local
      if (a === 172 && b >= 16 && b <= 31) return false; // private
      if (a === 192 && b === 168) return false; // private
      if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
      return true; // a public IP address: some hosts serve their files from one
    }
    if (h.includes(":") || h.startsWith("[")) return false; // IPv6 literals
    if (!h.includes(".") || h === "localhost") return false;
    if (/\.(local|localhost|internal|lan|home|corp)$/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// Links for hosts that need a click on their own page before a file starts (Gofile, FileKeeper, ...).
// They are opened in a window and the file is caught from there. https only. Hosts that make people
// solve a captcha (CAPTCHA_HOSTS below) are not used at all, except FileKeeper.
function canOpenInBrowser(link) {
  return typeof link === "string" && link.length <= 4096 && /^https:/i.test(link) && !canDownload(link) && !isBlockedHost(link) && isPublicWebUrl(link);
}

function canUse(link) {
  return canDownload(link) || canOpenInBrowser(link);
}

// Hosts Zruxr does not use at all. Their links are dropped everywhere: a game that only has links
// on these hosts is removed from the list. Most of them make people solve a captcha. FileKeeper
// is the one captcha-style host that is kept; Gofile is kept too.
const BLOCKED_HOSTS = new Set([
  "vikingfile",
  "datanodes", "akirabox", "fikper", "1fichier", "rapidgator", "nitroflare", "turbobit", "katfile",
  "mexashare", "hitfile", "ddownload", "uptobox", "uploaded", "k2s", "keep2share", "filefactory",
]);

function isBlockedHost(link) {
  return BLOCKED_HOSTS.has(hostKey(link));
}

// Names shown to the person, and hosts that are known to be having trouble right now (shown in
// brackets next to the name when choosing where to download from). Edit HOST_ISSUES to change it.
const HOST_NAMES = { pixeldrain: "Pixeldrain", gofile: "Gofile", buzzheavier: "BuzzHeavier", mediafire: "MediaFire", fuckingfast: "FuckingFast", filekeeper: "FileKeeper" };
const HOST_ISSUES = {};

// What to tell the person once a host's page is open. Every host needs a press on its own Download
// button; FileKeeper has a second Download button under the main one, and that is the one to use.
const POPUP_TIP = "If a popup is blocked, press Download again and wait.";
const HOST_HINTS = {
  filekeeper: "Click the Download button UNDER the main Download button ONCE and WAIT. WAIT. WAIT.",
};
const HOST_POPUP_TEXT = {
  filekeeper: "Popup blocked. That's fine: click the Download button UNDER the main Download button ONCE and WAIT. WAIT. WAIT.",
};
const DEFAULT_HINT = "Press Download on the page and wait. " + POPUP_TIP;
const POPUP_BLOCKED_TEXT = "A popup was blocked. Press Download again and wait.";

function hostKey(link) {
  try {
    const parts = new URL(link).hostname.toLowerCase().replace(/^www\./, "").split(".");
    return parts.length > 1 ? parts[parts.length - 2] : parts[0];
  } catch {
    return "";
  }
}

function hostLabel(link) {
  const k = hostKey(link);
  return HOST_NAMES[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : "Link");
}

function hostIssue(link) {
  return HOST_ISSUES[hostKey(link)] || "";
}

function popupText(link) {
  return HOST_POPUP_TEXT[hostKey(link)] || POPUP_BLOCKED_TEXT;
}

function hostHint(link) {
  return HOST_HINTS[hostKey(link)] || DEFAULT_HINT;
}

// What the download dialog shows for a game's links, in the same order as the links themselves:
// [{ label, via: "direct" | "browser", issue }]. Two links on the same host get "2", "3"...
function describeHosts(links) {
  const seen = {};
  return links.map((l) => {
    const base = hostLabel(l);
    seen[base] = (seen[base] || 0) + 1;
    return { label: seen[base] > 1 ? `${base} ${seen[base]}` : base, via: canDownload(l) ? "direct" : "browser", issue: hostIssue(l), hint: canDownload(l) ? "" : hostHint(l) };
  });
}

// Order for the hosts that open in a window: FileKeeper (which has the clearest steps) is tried last,
// the rest keep the order the source listed them.
function hostRank(link) {
  return hostKey(link) === "filekeeper" ? 9 : 5;
}

// Keeps only games that have at least one link we can use. Pixeldrain links come first (they
// download by themselves); anything else is opened in the launcher after them, best host first.
// item.via says which kind the game's main link is.
function onlyDownloadable(games) {
  return games
    .map((game) => {
      const all = [game.url, ...(game.alts || [])].filter(canUse);
      if (!all.length) return null;
      const direct = all.filter(canDownload);
      const browser = all.filter((l) => !canDownload(l)).sort((a, b) => hostRank(a) - hostRank(b));
      const links = [...direct, ...browser];
      return { ...game, url: links[0], alts: links.slice(1), via: canDownload(links[0]) ? "direct" : "browser", hosts: describeHosts(links) };
    })
    .filter(Boolean);
}

module.exports = { popupText, POPUP_BLOCKED_TEXT, DEFAULT_HINT, hostHint, resolveLink, canDownload, canOpenInBrowser, canUse, isBlockedHost, isPublicWebUrl, onlyDownloadable, hostLabel, hostIssue, describeHosts };
