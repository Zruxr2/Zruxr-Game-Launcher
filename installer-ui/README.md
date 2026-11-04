Zruxr animated installer

Preview the animation (no real install):
  npm install
  npm run demo

Build the real thing:
  1. In the launcher project run: npm run dist:setup
  2. Copy dist\Zruxr-Setup-1.2.3.exe into this project as payload\core.exe
  3. Here run: npm run build
  4. Hand out dist\Zruxr-Installer-1.2.3.exe

Keep uploading the normal Zruxr-Setup-x.x.x.exe + latest.yml to GitHub for auto-update.
Tweak EXPECTED_BYTES in main.js if the progress bar finishes too early/late.
