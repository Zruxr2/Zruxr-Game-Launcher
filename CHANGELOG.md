# Changelog

All notable changes to Zruxr are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

For versions before 1.2.4, see the [Releases](../../releases) page.

## [Unreleased]

## [1.2.7] - 2026-11-24

### Changed

- **Downloads page redesign.** A flatter, plainer look: bare covers, text tabs for sections, a thin Download button, and a one-line beta note.

### Added

- **New startup screen.** The Z draws itself inside a spinning ring over a soft moving glow, the name fades in letter by letter, and a thin bar fills as Zruxr loads. It fades out smoothly into the app and respects reduced motion.
- **Simple FileKeeper view.** On FileKeeper download pages, the page counts down as normal. When its "If the download doesn't start automatically, click here." line appears, a plain dark screen covers the page (the main Download button and the ads are never shown) and only that line shows, in the middle of the screen. You press the link yourself. "Show the whole page" is always available. Turn it off in Settings > Simple FileKeeper view. There is also a **Copy debug info** button in the host panel that copies what the page is doing (web addresses cut down to host names) so problems can be reported.
- **Hover panel on Downloads.** Hover a game and a panel floats beside it with what the game is (short description, genres, single-player/co-op, developer, release date, Metacritic when Steam has one), plus size, source, hosts, backups, date added and version/DLC tags. It also shows the game's banner and 3 screenshots. All of it comes from the Steam store, is looked up only when you hover, and is cached on your PC. The Downloads page also got a cleaner look.
- **Friends upgrade** (run `docs/friends-setup-2.sql` once): **block list**, **invite to play** (your friend gets a notification), **Busy / Invisible** status, **profile cards** (profile colour, top games, total hours), **compare games** (who played shared games more), and a **Friends are playing** row on the Library page.
- **Friend notifications.** A Windows notification for new requests, game invites, and when a friend starts a game you own. Turn it off in Friends > Privacy. Muted while you're Busy.
- **Game won't start? helper.** One click checks the usual causes: missing file, empty file, tiny launcher .exe, Visual C++, DirectX, admin-only games and Windows Security detections, with a button to fix each one.

## [1.2.6] - 2026-11-22

Uninstall like Steam, live download stats, themes, and a GTA VI banner.

### Added

- **Uninstall keeps the game in your library.** For games Zruxr downloaded, **Uninstall** (after a confirm box) deletes the game's files but leaves the game in your library, with its play time, cover and favorite. It shows **Not installed** with an **Install** button, which downloads it again and puts it back in the same spot. **Remove from library** still removes it fully. Only things Zruxr itself downloaded are ever deleted, and only inside the download folder.
- **Download stats.** Each running download shows a speed graph (last minute), current and average speed, time left, elapsed time, when it will finish, and the total speed of all downloads.
- **Friends.** Add friends by username, accept or decline requests, see who is playing right now, their last game and hours, and choose what you share. Needs one setup script run in Supabase: `docs/FRIENDS.md`.
- **Downloads sections.** Clickable sections on the Downloads page: Big titles, Co-op & multiplayer, New, Open world, Shooters, RPG, Horror, Racing & sports, Survival & building, Small & indie. Co-op and New games get a badge.
- **Runs in the tray.** Closing the window hides Zruxr to the tray instead of quitting, so games keep running and play time keeps counting. Open it again by clicking the tray icon, quit from its right-click menu, or turn it off in Settings.
- **The create-account screen only shows on the very first launch** after installing. Sign in or create an account later from Settings.
- **Themes.** Settings, Appearance: Dark, Midnight, Violet, Crimson, Forest and Light. The window's title bar changes colour too.
- **"Antivirus removed it" warning.** If a finished download disappears within 15 minutes of being saved, the Downloads list says so, with an **Open Windows Security** button and a reminder to only restore files you trust.
- **"GTA VI coming soon" banner** at the top of the Library (shown once you've added a source).
- **Uninstall works on every game with a file**, including ones added by hand or with Scan PC. For those, Zruxr works out the game's own folder, shows you the exact path to confirm, and refuses shared or system folders (Downloads, Documents, Program Files, a drive root and so on). It can't re-download games it didn't download itself.

### Security

- **Password guessing is slowed down:** five wrong sign-ins in a row lock sign-in for a minute.
- **Files are saved safely.** The library, settings, profile and source lists are written to a temporary file first, then swapped in, so a crash or power cut can't corrupt them.
- **Only one Zruxr can run at a time** (a second launch just brings the first to the front), so two copies can't overwrite each other's data.
- **Stricter page security policy:** the launcher window can no longer load plugins, frames, forms or make its own network calls.

## [1.2.5] - 2026-11-10

A fix for downloads adding the wrong program to your library, and help for games that won't start.

### Added

- **"Game won't start?" help.** If a game closes within 20 seconds (and you didn't press Stop), or can't start, the library shows a notice: "If it did not open or keeps crashing, the wrong .exe may be selected" with **Change .exe** and **Show folder** buttons. A tip under the library also says so.
- **Change .exe with one click.** **Edit** on a game now lists the other programs found in its folder, best first (with size and location), so you can switch without browsing. Browse still works.

### Fixed

- **Editing a game after restarting Zruxr did nothing** (renaming or changing the cover was silently ignored until you picked its file again). The game's current file is now accepted.

- **Wrong .exe chosen after a download.** Finished downloads used a simple "biggest program wins" rule, so a big tool, config program, updater or launcher could be picked instead of the game. Downloads now use the same smarter picker as Scan PC (new `exe-pick.js`): it skips helper programs and extras folders (Tools, Server, Editor, Bonus, Crack and similar), prefers a name that matches the game, prefers Unreal's `-Win64-Shipping.exe` over its stub, and only uses a "Launcher" when nothing better exists.

## [1.2.4] - 2026-11-07

Downloads now finish the job: they land in the launcher's own folder, archives are unpacked for you, and the game shows up in your library without a manual scan. More file hosts are supported, and update notices are clearer.

### Added

- **Choose where a download is saved.** Pressing Download opens a "Save to" step. The default is inside Zruxr's own folder (`%APPDATA%\Zruxr\Games`); **Change** picks another folder for that one download, and a tick box makes it the new default.
- **Automatic unpacking** of `.rar` and `.zip` downloads, in a background worker so the launcher stays responsive on multi-GB archives. Progress shows on the Download button and in the Downloads list.
- **Automatic library add.** After unpacking, Zruxr finds the game's `.exe` (largest real program; uninstallers, crash handlers and redistributables are ignored) and adds it to the library, named from the download title so cover art is found. A downloaded `.exe` is added straight away. Games already in the library are not added twice.
- **Tidy folders.** An archive with a single top-level folder is flattened (no `Game/Game/game.exe`); loose files go in a folder named after the game; name clashes get ` (1)`.
- **Retry for failed unpacks.** A password-protected, damaged or out-of-space archive shows a plain message and is kept; Retry unpacks again without downloading.
- **More file hosts.** Links that aren't Pixeldrain (Gofile, FileKeeper, BuzzHeavier, FuckingFast, MediaFire) open in a panel inside the launcher. Every host's page shows what to press ("Press Download and wait"; FileKeeper: the button under the main Download button), and a blocked popup shows a large orange warning. The download is caught and continues in the Downloads list.
- **Host chooser in the Download dialog.** Every host a game offers is listed, best first (Pixeldrain first). A host with a known problem can be marked in brackets: edit `HOST_ISSUES` in `resolvers.js`.
- **Sorting on the Downloads page:** source order, A to Z, Z to A, largest, smallest, newest, oldest. The choice is remembered.
- **Beta notices** on the Downloads page, in the host panel and in the Download dialog.
- **Update notice and Settings > Updates.** "New version available" appears as soon as an update is found (with progress), then "Restart now" when it is ready. Settings has a **Check now** button and shows the real reason when an update check fails.
- **Host panel tools.** Switch host without leaving the panel, **Open in browser**, and **I downloaded it** (pick a file you saved yourself and it joins the normal flow). `Esc` closes the panel.
- New download states: **Waiting for you** (host check in progress) and **Unpacking**.
- Unit tests (`npm test`, plain Node), a CI workflow, contributing and security notes, and issue/PR templates.

### Changed

- **Captcha hosts removed** (DataNodes, AkiraBox, Fikper, 1Fichier and similar). FileKeeper and Gofile are kept. VikingFile is not used. A game that only has links on removed hosts is hidden.
- **A failed direct download tries the game's other hosts.** If Pixeldrain refuses a download, Zruxr opens the next host's page instead of stopping with an error.
- **Update errors are no longer hidden.** The updater logs everything to `updater.log` in the data folder and retries after 10 minutes (not 4 hours) after an error.

- The default download folder moved from `Downloads\Zruxr` to `%APPDATA%\Zruxr\Games`. Existing downloads stay where they are; a folder set in Settings is still respected.
- Sources now keep every usable `https` link instead of only Pixeldrain links. Pixeldrain still comes first and still downloads automatically.
- New dependencies: `node-unrar-js` (RAR) and `extract-zip` (ZIP).
- `package.json` now has `license`, `repository`, `bugs`, `homepage` and a `test` script.

### Fixed

- **Games missing from the Downloads page.** Cards with no Steam cover are kept (with a letter placeholder) instead of being removed; titles containing words like "patch", "update" or "demo" are no longer hidden; the minimum size is 20 MB instead of 100 MB; and a large source is no longer cut off at 5,000 entries before unusable links are dropped.
- Sources are re-read once in the background after updating, so the new host rules apply without pressing refresh.

### Security

- Save locations are still decided by the main process: the renderer can only use the default folder or one just picked in the folder dialog.
- Archive entry names are sanitised while unpacking, so an archive can't write outside its own folder.
- The host panel is sandboxed (no Node access, context isolation) with its own cookie store, no permission prompts, and can only visit public web pages: `localhost`, private network ranges, `file:` and other non-web addresses are blocked.
- Pop-ups to other sites are blocked; a pop-up from the same site is followed as the page's next step.
- Only one file is accepted per host page, and unexpected program downloads (`.msi`, `.scr`, `.apk`, scripts and similar) are refused. A `.exe` delivered by a web page is never added to the library automatically.

### Upgrade notes

- Sources are refreshed automatically once after updating. Games that only have links on removed (captcha) hosts disappear from the list.
- **From source:** run `npm install` (two new dependencies), then commit the updated `package-lock.json`.

### Known limitations

- Downloads from file hosts are in beta. A host may refuse to continue in an embedded page: use another host, **Open in browser**, or **I downloaded it**.
- Only `.rar` and `.zip` are unpacked. `.7z`, `.iso` and multi-part RARs are downloaded but left for you to extract.
- A page download can't resume after a restart; Retry reopens the page.

[Unreleased]: ../../compare/v1.2.7...HEAD
[1.2.7]: ../../compare/v1.2.6...v1.2.7
[1.2.6]: ../../compare/v1.2.5...v1.2.6
[1.2.5]: ../../compare/v1.2.4...v1.2.5
[1.2.4]: ../../compare/v1.2.3...v1.2.4
