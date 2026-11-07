# Changelog

All notable changes to Zruxr are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

For versions before 1.2.4, see the [Releases](../../releases) page.

## [Unreleased]

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

[Unreleased]: ../../compare/v1.2.4...HEAD
[1.2.4]: ../../compare/v1.2.3...v1.2.4
