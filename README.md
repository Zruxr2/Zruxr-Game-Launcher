<div align="center">

<img src="docs/logo.png" alt="Zruxr" width="96" height="96" />

# ZRUXR

**Your games. Your files. No store.**

A fast, dark game launcher for Windows. Point it at any `.exe` and Zruxr finds the cover art, tracks your play time, and keeps your library looking sharp.

[![Download](https://img.shields.io/badge/Download-latest%20release-f0f0f0?style=for-the-badge&labelColor=0a0a0a)](../../releases/latest)

![Platform](https://img.shields.io/badge/platform-Windows-8d8d8d?style=flat-square&labelColor=0a0a0a)
![Electron](https://img.shields.io/badge/built%20with-Electron-8d8d8d?style=flat-square&labelColor=0a0a0a)
![License](https://img.shields.io/badge/license-MIT-8d8d8d?style=flat-square&labelColor=0a0a0a)
[![CI](https://github.com/Zruxr2/Zruxr-Launcher/actions/workflows/ci.yml/badge.svg)](https://github.com/Zruxr2/Zruxr-Launcher/actions/workflows/ci.yml)

<br />

<img src="docs/library.png" alt="Zruxr library view" width="900" />

</div>

<br />

## Why Zruxr

Most launchers want you to buy things. Zruxr doesn't sell anything. It's for the games you already have: installed from a disc, downloaded from a developer's site, from an itch.io zip, or sitting in a folder on your drive. Add the `.exe`, and it looks and feels like the rest of your library.

## Features

**Find your games for you.** Press **Scan PC** and Zruxr finds games already installed: Steam libraries (read from Steam's own files), Epic, GOG and your Games folders. Tick the ones you want and add them in one go. "Whole PC" mode searches every drive, and you can also scan a single folder. It only reads folder and file names, nothing is changed or uploaded.

**Discover, kept small.** A slim row on the home page shows what's popular on Steam right now: top sellers, top free, new releases and what's on sale. Click a game to open its store page. Hide it with one click, or turn it off in Settings.

**Cover art, automatically.** Add a game and Zruxr looks it up by name (and by its folder name) and downloads the portrait art. You never upload an image. If a game can't be found, it gets a clean generated cover instead, and Zruxr checks again once a week.

**Play time that tracks itself.** Launch from Zruxr and the clock runs until the game closes. Totals are saved as you play, and a "Jump back in" banner always puts your last game one click away.

**A library that feels good.** Hover a cover for Play, star your favorites, sort by name, last played, most played or recently added, and press `/` to search. Each cover's main colour becomes the soft glow behind it.

**Sources and downloads.** Press **Add source** on the home page and paste a web address: a JSON list (including Hydra-style lists), a web page or open folder that links to files, or a direct file link. A **Downloads** tab appears with a cover and a big Download button for every game. Pick where to save each one (inside Zruxr's own folder by default), and Zruxr unpacks `.rar` and `.zip` files for you and adds the game to your library. See [Downloads in detail](#downloads-in-detail).

**More than one file host.** Pixeldrain links download by themselves. Other hosts (Gofile, FileKeeper, BuzzHeavier, FuckingFast, MediaFire) open in a panel inside the launcher with a line saying what to press, then the download carries on in the launcher. You choose the host in the Download dialog. Hosts that make you solve captchas are not used. Downloads from file hosts are in **beta**.

**Stats you'll actually look at.** Total hours, this week's hours, a 7-day chart and your most played games.

**Updates itself.** The installed version checks GitHub Releases, downloads new versions in the background and installs them when you close Zruxr.

**Accounts are optional.** Zruxr works fully without one. If you do create a free account, your game list and play time follow you between PCs.

**Yours to tweak.** Small, medium or large covers, start with Windows, and a startup animation you can turn off.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/scan.png" alt="Scanning for installed games" /></td>
    <td width="50%"><img src="docs/stats.png" alt="Stats tab" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Scan PC finds your installed games</sub></td>
    <td align="center"><sub>Stats</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/settings.png" alt="Settings tab" /></td>
    <td></td>
  </tr>
  <tr>
    <td align="center"><sub>Settings</sub></td>
    <td></td>
  </tr>
</table>

> The games shown above are made-up examples.

## Download

Grab the latest build from the [**Releases**](../../releases/latest) page:

| File | What it is |
| --- | --- |
| `Zruxr-Portable-x.y.z.exe` | One file. Double-click to run, no install. |
| `Zruxr-Setup-x.y.z.exe` | Installer with Start menu and desktop shortcuts, plus an uninstaller. Updates itself. |

Windows SmartScreen may warn about an unknown publisher because the app isn't code-signed. Choose **More info**, then **Run anyway**.

## Using it

1. Click **Scan PC** to find installed games, tick the ones you want and press **Add**. Or click **Add game** and choose a game's `.exe` (or `.bat` / `.cmd`) yourself.
2. Confirm the name if you added one by hand. The name is what's used to find the cover.
3. Hover the cover and press **Play**, or double-click it.

If a cover is wrong or missing, hover the game, click **Edit**, fix the name, or pick your own image. **Find automatically** switches back.

**Shortcuts:** `1` to `5` switch tabs, `/` searches, `Esc` clears the search.

Your library is saved in `%APPDATA%\Zruxr\library.json`, with covers in a `covers` folder beside it and your preferences in `settings.json`.

## Downloads in detail

### Adding a source

Press **Add source** and paste an address. Zruxr reads it and lists every game it finds. Press refresh on a source any time to re-read it. Only add sources you trust and have the right to download from.

### Choosing where a game goes

Press **Download** on a game and a small dialog opens:

- **Download from**: every host the game has, best first (Pixeldrain first). A host with a known problem can be marked in brackets (see below). The best host without a known problem is pre-selected.
- **Save to**: `%APPDATA%\Zruxr\Games` by default. **Change** picks a different folder for this one download, and a tick box makes it the new default. The default can also be changed in Settings.

Downloads run in the background (up to three at once), with pause, resume and an optional SHA-256 check.

### After a download finishes

1. `.rar` and `.zip` files are unpacked in the background (the launcher stays responsive), with progress shown on the button.
2. If the archive holds one top-level folder, that folder becomes the game folder (no `Game/Game/game.exe`).
3. The game's `.exe` is picked (the largest real program, ignoring uninstallers, crash handlers and redistributables) and added to your library, named from the download title so cover art is found.
4. The archive is deleted once it has unpacked cleanly. If unpacking fails (password, damaged file, no disk space) the archive is kept and **Retry** unpacks it again without downloading.
5. If an archive only contains an installer (`setup.exe`), nothing is added: open the folder, run it, then use **Scan PC**.

A downloaded `.exe` is added straight away. Other archive types (`.7z`, `.iso`, multi-part RARs) are downloaded but not unpacked yet.

### Hosts that open in a panel

Pixeldrain links are fetched by the launcher itself. For any other `https` link, Zruxr opens the host's page in a panel **inside the launcher**. Press the host's Download button, like in any browser (the panel tells you which one: on FileKeeper it is the button under the main Download button) and wait. If a popup is blocked, a big orange warning appears; press Download again and wait. The moment the site starts the file, the panel closes and the download carries on in your Downloads list.

- **Switch host** with the buttons at the top of the panel if one isn't working.
- **Open in browser** opens the page in your normal browser if it refuses to continue here.
- **I downloaded it** lets you pick a file you saved yourself: it is moved to your save folder, unpacked and added to your library like any other download.
- Closing the panel before the file starts cancels that download. Pause, cancel and Retry work as usual; a page download can't resume across a restart, so Retry reopens the page.

Safety rules for the panel: it is sandboxed with its own cookies, pop-ups to other sites are blocked (a pop-up from the same site is followed), it can only visit public web pages (never your PC or home network), and an unexpected program download from an ad (`.msi`, `.scr`, `.apk`, and so on) is refused. A `.exe` that comes from a web page is never added to your library automatically.

Sources are re-read once automatically after updating to 1.2.4, so the current host rules apply. Press refresh on a source any time to re-read it.

### Marking a host as having problems

The note shown next to a host comes from one line in `resolvers.js`:

```js
const HOST_ISSUES = {}; // nothing is marked right now
// to mark one: { gofile: "having issues" }
```

Add a host's name (the part before `.com`/`.io`) to mark it, or delete the entry once it works again.

## Run from source

You'll need [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm start
```

Run the tests (plain Node, nothing to install):

```bash
npm test
```

### Build your own .exe

Run these on Windows, in the project folder, after `npm install`:

| Command | Output (in `dist/`) |
| --- | --- |
| `npm run dist:portable` | Portable single-file `.exe` |
| `npm run dist:setup` | NSIS installer |
| `npm run dist` | Both |

The app icon is `build/icon.png`. Swap it for your own image (at least 256 x 256) before building.

<details>
<summary><b>If Electron says it "failed to install correctly"</b></summary>

Newer versions of npm block install scripts by default, which stops Electron from downloading its binary. Approve the script and rebuild:

```bash
npm install-scripts approve electron
npm rebuild electron
```

If that still doesn't work, delete `node_modules` and run `npm install` again.

</details>

## Accounts and sync

An account is completely optional. Zruxr asks once when it opens, and you can click **Not now** to use everything offline. Accounts use [Supabase](https://supabase.com). People sign in with a username and password, and the app handles the rest. Sign-in sessions are stored encrypted with Windows' own credential protection, so you stay signed in between launches. There is no email on an account, so there is no password reset: a forgotten password can't be recovered.

If you fork this and want your own backend, create a Supabase project, then replace `SUPABASE_URL` and `ANON_KEY` at the top of `cloud.js`. The anon key is designed to be public, but make sure Row Level Security is switched on for your tables so users can only read and write their own library.

## Known limitations

- Favorites and the per-day history behind the Stats chart live on your PC only. They don't sync to your account yet. Total play time does.
- Play time is measured from the process Zruxr starts. A game that opens through its own launcher and then closes it will stop the timer early.
- `.lnk` shortcuts aren't supported yet. Pick the real `.exe` instead.
- Automatic covers only match games that exist on Steam, and only on a close name match. That's deliberate, so unofficial games don't end up with the wrong art.
- "Start with Windows" only works in the installed or portable app, not under `npm start`.
- Scan PC doesn't find Microsoft Store / Xbox games, and some Epic games may need the Epic launcher open to run from Zruxr.
- "Whole PC" scans can take a few minutes, and stop after four.
- The Discover row needs an internet connection. It uses Steam's public store data and stays hidden when offline.
- The Friends tab is a placeholder for now.
- Pages from file hosts are shown inside the launcher, but some hosts may refuse to continue in an embedded page (downloads are in beta). Use another host, **Open in browser**, or **I downloaded it**.
- Only `.rar` and `.zip` are unpacked. `.7z`, `.iso` and multi-part RARs are left for you to extract.
- Windows only for now.

## Roadmap

- [ ] `.lnk` shortcut support
- [ ] `.7z` unpacking
- [ ] Remember each host's success rate and rank hosts automatically
- [ ] Sync favorites and daily history
- [ ] Friends: see what others are playing
- [x] Auto-update from GitHub Releases (installed version only)
- [x] Download to a chosen folder, unpack archives and add games automatically
- [x] Hosts that need a click, shown inside the launcher
- [ ] Collections and tags
- [ ] Controller-friendly "big screen" mode

## Auto-update

The installed version (`Zruxr-Setup-x.y.z.exe`) checks GitHub Releases on start and every few hours, downloads new versions in the background and installs them when Zruxr closes (or right away via **Restart now**). The portable `.exe` doesn't update itself.

To publish an update, either let GitHub do it or do it by hand.

**Automatic (recommended).** Bump `version` in `package.json`, add the version to [CHANGELOG.md](CHANGELOG.md), commit, then push a tag that matches it:

```bash
git tag v1.2.4
git push origin v1.2.4
```

The **Release** workflow (`.github/workflows/release.yml`) runs the tests, checks the tag matches `package.json`, builds the installer and portable `.exe` on Windows, and publishes them with `latest.yml` and the `.blockmap` to a normal (non-draft) GitHub release. The release text is taken from `docs/release-notes/vX.Y.Z.md` if that file exists. The animated `Zruxr-Installer` is built locally with `npm run dist` and can be added to the release by hand.

**By hand.** Run `npm run dist`, then create a GitHub release tagged `vX.Y.Z` and attach **all** of these from `dist/`: `Zruxr-Setup-X.Y.Z.exe`, `Zruxr-Setup-X.Y.Z.exe.blockmap`, `latest.yml` (and the portable `.exe` if you want). Without `latest.yml` installed copies can't see the update.

**If people on the old version don't see the update**, check these in order:

1. **The version number.** `latest.yml` is generated from `version` in `package.json`. If it is the same as (or lower than) what people already have, nobody is offered an update. Open `latest.yml`: its `version:` line must be higher than the old version. (This release is 1.2.4, so it is offered to people on 1.2.3 and older.)
2. **Use the `latest.yml` that was built with the installer.** Don't write it by hand or copy it from another build: it contains the installer's file name, size and `sha512`, and a mismatch makes the download fail.
3. **All three files on the release:** `Zruxr-Setup-X.Y.Z.exe`, its `.blockmap` and `latest.yml`. The file name inside `latest.yml` must match the uploaded asset exactly. The animated `Zruxr-Installer-X.Y.Z.exe` on its own is not enough.
4. **The release must be published**, not a draft or a pre-release, and the repository must be public. The tag must be `vX.Y.Z`.
5. **Only the installed version updates.** The portable `.exe` and `npm start` never do.
6. **The old version must already contain the updater.** A version built before auto-update existed has to be reinstalled by hand once.
7. Open **Settings > Updates** or `updater.log` in the data folder on an old copy: it says what the updater saw and why it failed.

## Responsible use

Zruxr is a launcher and download manager. It doesn't include, host, recommend or index any games, and it ships with no sources. You choose what to add, and you're responsible for making sure you have the right to download and use it. Scan downloaded files with your own antivirus.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Credits

Typeface: [Inter](https://rsms.me/inter/) by Rasmus Andersson, used under the SIL Open Font License (see `renderer/fonts/LICENSE-Inter.txt`). Cover art and the Discover row use Steam's public store data for display in your own library; all artwork belongs to its respective owners. Zruxr isn't affiliated with or endorsed by Valve.

## License

[MIT](LICENSE)
