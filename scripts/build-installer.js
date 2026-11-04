const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ui = path.join(root, 'installer-ui');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', shell: true });

const { version } = require(path.join(root, 'package.json'));

// 1. build the real NSIS installer (your existing script)
run('npm run dist:setup', root);

// 2. copy it in as the payload
const setupExe = path.join(root, 'dist', `Zruxr-Setup-${version}.exe`);
if (!fs.existsSync(setupExe)) throw new Error('Not found: ' + setupExe);
fs.mkdirSync(path.join(ui, 'payload'), { recursive: true });
fs.copyFileSync(setupExe, path.join(ui, 'payload', 'core.exe'));

// 3. keep the wrapper's version in sync (it's shown in the UI and the filename)
const uiPkgPath = path.join(ui, 'package.json');
const uiPkg = JSON.parse(fs.readFileSync(uiPkgPath, 'utf8'));
uiPkg.version = version;
fs.writeFileSync(uiPkgPath, JSON.stringify(uiPkg, null, 2));

// 4. build the animated wrapper
if (!fs.existsSync(path.join(ui, 'node_modules'))) run('npm install', ui);
run('npm run build', ui);

// 5. copy the final file next to your normal dist output
const out = `Zruxr-Installer-${version}.exe`;
fs.copyFileSync(path.join(ui, 'dist', out), path.join(root, 'dist', out));
console.log('\nDone → dist/' + out);