const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'desktop/resources/bin');
fs.mkdirSync(dir, { recursive: true });
const result = spawnSync('go', ['build', '-o', path.join(dir, process.platform === 'win32' ? 'dispatch.exe' : 'dispatch'), './cmd/dispatch'], { cwd: root, stdio: 'inherit' });
if (result.status === 0) fs.copyFileSync(path.join(dir, process.platform === 'win32' ? 'dispatch.exe' : 'dispatch'), path.join(dir, process.platform === 'win32' ? 'myarmy.exe' : 'myarmy'));
process.exit(result.status ?? 1);
