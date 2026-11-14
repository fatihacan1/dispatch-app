// Blender: finds the install (blender.org installer, Steam, or a chosen blender.exe), installs the
// "MCP for Blender" add-on (github.com/ahujasid/blender-mcp) into the user's add-ons and enables it.
// The add-on starts its socket server (port 9876) when Blender loads; electron/mcp-blender.cjs talks to it.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { readSettings, writeSettings } = require('./tools.cjs');

const PORT = 9876;
const MODULE = 'blender_mcp_addon';
const ADDON_URL = 'https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py';

function steamLibraries() {
  const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  const libs = new Set(roots);
  for (const r of roots) {
    try { for (const m of fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\')); } catch {}
  }
  return [...libs].map(l => path.join(l, 'steamapps', 'common', 'Blender', 'blender.exe'));
}
function foundationInstalls() {
  return ['C', 'D'].flatMap(d => { const root = `${d}:\\Program Files\\Blender Foundation`; try { return fs.readdirSync(root).map(n => path.join(root, n, 'blender.exe')); } catch { return []; } })
    .sort().reverse();
}
function exe() {
  const chosen = readSettings().blender?.exe;
  return [chosen, ...steamLibraries(), ...foundationInstalls()].find(f => f && fs.existsSync(f)) || '';
}
// Blender keeps its bundled files in a "<major>.<minor>" folder next to blender.exe; user add-ons go under the same version in %APPDATA%.
function version(file = exe()) {
  try { return fs.readdirSync(path.dirname(file)).filter(n => /^\d+\.\d+$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] || ''; } catch { return ''; }
}
const addonFile = v => path.join(process.env.APPDATA || '', 'Blender Foundation', 'Blender', v, 'scripts', 'addons', MODULE + '.py');
const listening = () => new Promise(r => { const s = net.connect(PORT, '127.0.0.1'); s.setTimeout(800, () => { s.destroy(); r(false); }); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });

async function status() {
  const file = exe(), v = file ? version(file) : '';
  return { installed: !!file, path: file, version: v, addon: !!v && fs.existsSync(addonFile(v)), running: await listening(), port: PORT };
}
function setExe(file) {
  if (!/blender\.exe$/i.test(file) || !fs.existsSync(file)) throw new Error('Choose blender.exe.');
  const s = readSettings(); s.blender = { ...(s.blender || {}), exe: file }; writeSettings(s);
}
function start() { const f = exe(); if (!f) throw new Error('Blender was not found.'); spawn(f, [], { detached: true, stdio: 'ignore' }).unref(); return true; }

// PowerShell run in Dispatch's install console: download the add-on, then let Blender enable it and save preferences.
function installScript() {
  const f = exe(), v = version(f);
  if (!f || !v) throw new Error('Blender was not found. Choose blender.exe first.');
  const target = addonFile(v);
  // The Python goes through a temp file: inline --python-expr breaks on PowerShell quoting.
  const pyFile = path.join(require('os').tmpdir(), 'dispatch-blender-enable.py');
  fs.writeFileSync(pyFile, `import addon_utils, bpy\naddon_utils.enable('${MODULE}', default_set=True, persistent=True)\nbpy.ops.wm.save_userpref()\nprint('MCP for Blender enabled')\n`);
  return [
    `$ErrorActionPreference='Stop'`,
    `New-Item -ItemType Directory -Force '${path.dirname(target)}' | Out-Null`,
    `Write-Host 'Downloading MCP for Blender add-on (github.com/ahujasid/blender-mcp)...'`,
    `Invoke-WebRequest '${ADDON_URL}' -OutFile '${target}' -UseBasicParsing`,
    `Write-Host 'Enabling it in Blender ${v}...'`,
    `& '${f}' --background --python '${pyFile}'`,
    `Write-Host 'Done. The add-on starts its server on port ${PORT} whenever Blender opens.'`,
  ].join('; ');
}

// Turns the add-on off in Blender's saved preferences, then deletes its file and compiled copy. Blender itself stays.
function uninstallScript() {
  const f = exe(), v = f ? version(f) : '';
  if (!v) throw new Error('Blender was not found.');
  const target = addonFile(v), cache = path.join(path.dirname(target), '__pycache__');
  const pyFile = path.join(require('os').tmpdir(), 'dispatch-blender-disable.py');
  fs.writeFileSync(pyFile, `import addon_utils, bpy\naddon_utils.disable('${MODULE}', default_set=True)\nbpy.ops.wm.save_userpref()\nprint('MCP for Blender disabled')\n`);
  return [
    `$ErrorActionPreference='Stop'`,
    `if (Get-Process blender -ErrorAction SilentlyContinue) { Write-Host 'Close Blender first, then try again.'; exit 1 }`,
    `Write-Host 'Disabling MCP for Blender in Blender ${v}...'`,
    `& '${f}' --background --python '${pyFile}'`,
    `Remove-Item '${target}' -Force -ErrorAction SilentlyContinue`,
    `Get-ChildItem '${cache}' -Filter '${MODULE}*' -ErrorAction SilentlyContinue | Remove-Item -Force`,
    `Write-Host 'MCP for Blender removed. Blender itself is untouched.'`,
  ].join('; ');
}

module.exports = { PORT, exe, status, setExe, start, installScript, uninstallScript };
