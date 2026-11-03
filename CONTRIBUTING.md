# Contributing

Thanks for helping out. Zruxr is a small Electron app with no build step for the UI, so it's easy to hack on.

## Setup

```bash
npm install
npm start
```

Requires Node.js 18 or newer.

## Project layout

| Path | What it does |
| --- | --- |
| `main.js` | Electron main process: library, settings, launching games, IPC handlers |
| `preload.js` | The only bridge between the UI and the main process (`window.launcher`) |
| `scanner.js` | Finds installed games (Steam, Epic, GOG, folders) |
| `discover.js` | Steam store data for the Discover row |
| `cloud.js` | Optional Supabase sign-in and library sync |
| `renderer/` | UI: `index.html`, `renderer.js`, `styles.css`, fonts |

## Ground rules

- **Keep the renderer locked down.** It runs sandboxed with context isolation. New capabilities go through `preload.js` and an IPC handler in `main.js`, and the main process must validate its inputs. File paths to run or copy should only come from dialogs the main process opened.
- Don't loosen the Content Security Policy in `renderer/index.html`.
- Keep dependencies to a minimum.
- Test on Windows before opening a PR. Launching, scanning and "Start with Windows" are Windows-specific.

## Pull requests

Keep them focused, describe what changed and why, and include a screenshot for UI changes.
