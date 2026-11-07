# Contributing to Zruxr

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for something

Open an [issue](../../issues/new/choose). For bugs, say what you did, what you expected, what happened, and your Windows and Zruxr versions. Screenshots help. Please don't include links to any specific games or files.

To report a **security** problem, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Running it

You'll need [Node.js](https://nodejs.org) (LTS) on Windows.

```bash
npm install
npm start        # run the app
npm test         # unit tests (plain Node, no install needed)
```

If Electron says it "failed to install correctly", see the note in the [README](README.md#run-from-source).

## Where things live

| File | What it does |
| --- | --- |
| `main.js` | App window, library, settings, cover art, wiring of everything below |
| `preload.js` | The only bridge between the UI and the main process |
| `renderer/` | The UI (HTML, CSS, JS) |
| `scanner.js` | Finds installed games (Steam, Epic, GOG, folders) |
| `sources.js`, `sources-parse.js` | Sources, the download manager, host pages, unpacking hand-off |
| `resolvers.js` | Which links can be downloaded, host names/order, `HOST_ISSUES` |
| `postprocess.js`, `extract-worker.js` | Unpacking archives and finding the game's `.exe` |
| `cloud.js`, `updater.js` | Optional accounts, auto-update |
| `installer-ui/` | The animated installer (a separate Electron app) |

## Ground rules

These keep Zruxr safe, so please keep them true in your changes:

- **The renderer never decides file paths.** It sends ids and choices; the main process decides where files go (see `downloads:pickDirFor` for the pattern).
- **Nothing downloaded is ever run automatically.** Adding a game to the library is fine; launching it is the person's choice.
- **Anything from the internet is untrusted:** archive entry names, file names, host pages and source lists.
- Web pages from file hosts stay in the sandboxed panel and can only reach public web addresses.
- Keep it small and dependency-light. Avoid adding a package for something a few lines can do.

## Pull requests

1. Fork, create a branch, make your change.
2. Add or update tests in `test/` when you change `resolvers.js` or `postprocess.js` (they run with `npm test`).
3. Run `npm test` and try the change in the app.
4. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
5. Open the PR and fill in the template.

By contributing you agree that your work is released under the [MIT license](LICENSE).
