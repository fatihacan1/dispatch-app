const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
const probe = spawnSync(require('electron'), ['-e', "require('node-pty')"], { env, stdio: 'inherit' });
if (probe.status === 0) { console.log('node-pty prebuild loaded successfully'); process.exit(0); }
const rebuild = path.join(__dirname, '../node_modules/@electron/rebuild/lib/cli.js');
const result = spawnSync(process.execPath, [rebuild, '-f', '-w', 'node-pty'], { stdio: 'inherit', env: { ...process.env, npm_config_devdir: path.resolve(__dirname, '../.electron-gyp') } });
process.exit(result.status ?? 1);
