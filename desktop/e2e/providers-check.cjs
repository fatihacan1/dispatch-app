// QA: run provider detection against the real CLIs on this machine (no Electron needed).
const fs = require('fs'); const path = require('path');
const lib = require('../electron/providers.cjs');
function resolveCommand(cmd) {
  const extra = process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin'), path.join(process.env.APPDATA || '', 'npm')] : [];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...extra];
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1'] : [''];
  for (const d of dirs) for (const e of exts) { const f = path.join(d, cmd + e); if (!fs.existsSync(f)) continue;
    if (e === '.cmd' || e === '.bat') return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', f] };
    if (e === '.ps1') return { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f] };
    return { file: f, args: [] }; }
  throw new Error('not found ' + cmd);
}
(async () => {
  for (const p of lib.PROVIDERS) {
    const r = await lib.check(resolveCommand, p.id);
    console.log(`${p.id.padEnd(12)} installed=${r.installed} v=${r.version || '-'} auth=${r.auth} ${r.detail || ''} models=${(r.models || []).slice(0, 4).join(',')}`);
  }
})();
