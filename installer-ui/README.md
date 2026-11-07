# Zruxr animated installer

A small Electron app that plays a startup animation and then runs the real Zruxr installer (`payload/core.exe`).

## Preview the animation (no real install)

```bash
npm install
npm run demo
```

## Build it

From the **launcher project root** (not this folder):

```bash
npm run dist
```

That script (`scripts/build-installer.js`) does everything:

1. Builds the normal installer, `dist/Zruxr-Setup-<version>.exe`.
2. Copies it here as `payload/core.exe`.
3. Syncs this app's version with the launcher's `package.json`.
4. Builds the wrapper and copies `Zruxr-Installer-<version>.exe` into the launcher's `dist/`.

`payload/core.exe` is ignored by git; it is rebuilt every time.

## Releasing

Hand out `Zruxr-Installer-<version>.exe`. For auto-update to work, also upload the normal `Zruxr-Setup-<version>.exe`, its `.blockmap` and `latest.yml` to the GitHub release.

If the progress bar finishes too early or late, adjust `EXPECTED_BYTES` in `main.js`.
