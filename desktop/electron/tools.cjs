// Local tools managed by Dispatch: ComfyUI, VoiceStudio, RustXNG, DDGS. Detects an install, starts/stops it and reports status.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const home = () => process.env.DISPATCH_HOME || os.homedir();
const settingsFile = () => path.join(home(), '.dispatch', 'tools.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function writeSettings(s) { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }

// A ComfyUI root contains ComfyUI/main.py (portable build) or main.py directly (git checkout).
function comfyLayout(root) {
  if (!root) return null;
  if (fs.existsSync(path.join(root, 'ComfyUI', 'main.py'))) {
    const python = path.join(root, 'python_embeded', process.platform === 'win32' ? 'python.exe' : 'bin/python');
    return { root, app: path.join(root, 'ComfyUI'), python: fs.existsSync(python) ? python : 'python', portable: fs.existsSync(python) };
  }
  if (fs.existsSync(path.join(root, 'main.py')) && fs.existsSync(path.join(root, 'comfy'))) return { root, app: root, python: 'python', portable: false };
  return null;
}
const DEFAULT_INSTALL = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Dispatch', 'ComfyUI');
function candidates() {
  const h = os.homedir();
  const drives = process.platform === 'win32' ? ['C:', 'D:', 'E:'] : [''];
  return [
    readSettings().comfyui?.path,
    DEFAULT_INSTALL(),
    ...drives.flatMap(d => [`${d}\\ComfyUI`, `${d}\\ComfyUI_windows_portable`, `${d}\\DevStation\\Apps\\ComfyUI`, `${d}\\AI\\ComfyUI`]),
    path.join(h, 'ComfyUI'), path.join(h, 'ComfyUI_windows_portable'), path.join(h, 'Documents', 'ComfyUI'), path.join(h, 'Desktop', 'ComfyUI_windows_portable'),
  ].filter(Boolean);
}
function comfyConfig() {
  const s = readSettings().comfyui || {};
  const layout = candidates().map(comfyLayout).find(Boolean) || null;
  return { url: s.url || 'http://127.0.0.1:8188', layout, extraArgs: s.args || ['--lowvram'] };
}
async function ping(url) {
  try { const r = await fetch(url + '/system_stats', { signal: AbortSignal.timeout(2000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
function countModels(app) {
  const dir = path.join(app, 'models'); let n = 0;
  try { for (const d of fs.readdirSync(dir)) { try { n += fs.readdirSync(path.join(dir, d)).filter(f => /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i.test(f)).length; } catch {} } } catch {}
  return n;
}
let child = null;
async function comfyStatus() {
  const cfg = comfyConfig();
  const stats = await ping(cfg.url);
  const version = stats?.system?.comfyui_version || (() => { try { return /__version__\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(cfg.layout.app, 'comfyui_version.py'), 'utf8'))[1]; } catch { return ''; } })();
  return {
    id: 'comfyui', name: 'ComfyUI', installed: !!cfg.layout || !!stats, running: !!stats, url: cfg.url,
    path: cfg.layout?.root || '', version, models: cfg.layout ? countModels(cfg.layout.app) : 0,
    gpu: stats?.devices?.[0]?.name || '', startedByDispatch: !!child,
  };
}
// detached: started by an agent's MCP server, so it must outlive that process.
function comfyStart({ detached = false } = {}) {
  const cfg = comfyConfig();
  if (!cfg.layout) throw new Error('ComfyUI is not installed.');
  const { root, app, python, portable } = cfg.layout;
  const cache = path.join(root, 'cache');
  const env = { ...process.env, HF_HOME: path.join(cache, 'huggingface'), TORCH_HOME: path.join(cache, 'torch'), PYTHONNOUSERSITE: '1' };
  const port = new URL(cfg.url).port || '8188';
  const args = ['-s', path.join(app, 'main.py'), ...(portable ? ['--windows-standalone-build'] : []), '--port', port, ...cfg.extraArgs];
  if (detached) { spawn(python, args, { cwd: root, env, detached: true, windowsHide: true, stdio: 'ignore' }).unref(); return true; }
  child = spawn(python, args, { cwd: root, env, detached: false, windowsHide: true, stdio: 'ignore' });
  child.on('exit', () => { child = null; });
  return true;
}
function comfyStop() {
  if (child) { child.kill(); child = null; return true; }
  const cfg = comfyConfig();
  if (!cfg.layout || process.platform !== 'win32') return false;
  // Same rule as the portable build's Durdur.ps1: only python.exe from this install running main.py.
  const py = cfg.layout.python.replace(/'/g, "''");
  execFile('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.ExecutablePath -eq '${py}' -and $_.CommandLine -like '*main.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }`], { windowsHide: true });
  return true;
}
function setComfyPath(p) { if (!comfyLayout(p)) throw new Error('This folder does not contain ComfyUI (main.py not found).'); const s = readSettings(); s.comfyui = { ...(s.comfyui || {}), path: p }; writeSettings(s); }
// One-click install: the official Windows portable build, downloaded and unpacked by Windows tar (bsdtar reads .7z).
function installScript(target = DEFAULT_INSTALL()) {
  return [
    `$ErrorActionPreference='Stop'; $dst='${target.replace(/'/g, "''")}'; New-Item -ItemType Directory -Force $dst | Out-Null`,
    `$rel=Invoke-RestMethod https://api.github.com/repos/comfyanonymous/ComfyUI/releases/latest`,
    `$asset=$rel.assets | Where-Object name -match 'windows_portable_nvidia\\.7z$' | Select-Object -First 1`,
    `Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size/1GB,2)) GB)..."; $file=Join-Path $env:TEMP $asset.name`,
    `Invoke-WebRequest $asset.browser_download_url -OutFile $file`,
    // Windows' own bsdtar (reads .7z); a GNU tar from Git on PATH would read "C:" as a remote host.
    `Write-Host 'Unpacking...'; & (Join-Path $env:SystemRoot 'System32\\tar.exe') -xf $file -C $dst; if ($LASTEXITCODE -ne 0) { throw 'Unpacking failed.' }; Remove-Item $file`,
    `$inner=Get-ChildItem $dst -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'ComfyUI\\main.py') } | Select-Object -First 1`,
    `if ($inner) { Get-ChildItem $inner.FullName -Force | Move-Item -Destination $dst -Force; Remove-Item $inner.FullName -Recurse -Force }`,
    `Write-Host 'ComfyUI installed to' $dst`,
  ].join('; ');
}
// Search tools Dispatch installs into its own folder (not the user's PATH).
const TOOLS_HOME = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Dispatch');
const binDirs = () => [path.join(TOOLS_HOME(), 'bin'), path.join(TOOLS_HOME(), 'ddgs', process.platform === 'win32' ? 'Scripts' : 'bin')];
const q = s => s.replace(/'/g, "''");
const TOOL_INSTALL = {
  // Official release binary, checked against its SHA-256 sidecar.
  rustxng: () => [
    `$ErrorActionPreference='Stop'; $bin='${q(path.join(TOOLS_HOME(), 'bin'))}'; New-Item -ItemType Directory -Force $bin | Out-Null`,
    `$rel=Invoke-RestMethod https://api.github.com/repos/sahenjp/RustXNG/releases/latest`,
    `$a=$rel.assets | Where-Object name -match 'x86_64-pc-windows-msvc\\.exe$' | Select-Object -First 1; $s=$rel.assets | Where-Object name -eq ($a.name + '.sha256')`,
    `Write-Host "Downloading RustXNG $($rel.tag_name)..."; $f=Join-Path $bin 'rustxng.download'; Invoke-WebRequest $a.browser_download_url -OutFile $f`,
    `$want=((Invoke-RestMethod $s.browser_download_url) -split '\\s+')[0].ToLower(); $got=(Get-FileHash $f -Algorithm SHA256).Hash.ToLower()`,
    `if ($want -ne $got) { Remove-Item $f; throw 'Checksum mismatch, download removed.' }`,
    `Move-Item $f (Join-Path $bin 'rustxng.exe') -Force; Write-Host 'RustXNG installed, checksum verified.'`,
  ].join('; '),
  // Private virtual environment so the user's Python stays untouched.
  ddgs: () => [
    `$ErrorActionPreference='Stop'; $venv='${q(path.join(TOOLS_HOME(), 'ddgs'))}'`,
    `$py=(Get-Command py -ErrorAction SilentlyContinue).Source; $pyArgs=@('-3'); if (-not $py) { $py=(Get-Command python -ErrorAction Stop).Source; $pyArgs=@() }`,
    `Write-Host 'Creating environment...'; & $py @pyArgs -m venv $venv`,
    `& (Join-Path $venv 'Scripts\\python.exe') -m pip install -U 'ddgs[mcp]'`,
    `Write-Host 'DDGS installed.'`,
  ].join('; '),
};
// ── VoiceStudio (debpalash/VoiceStudio): voice cloning, speech, voice design, transcription ──
const voiceUrl = () => (readSettings().voicestudio?.url || 'http://127.0.0.1:3900').replace(/\/$/, '');
function onPath(names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) for (const n of names) { const f = path.join(dir, n); if (fs.existsSync(f)) return f; }
  return null;
}
// The installer puts the app under the user's Programs folder and its CLI on PATH.
function voiceApp() {
  const local = process.env.LOCALAPPDATA || '';
  const exe = [readSettings().voicestudio?.exe, path.join(local, 'Programs', 'VoiceStudio', 'VoiceStudio.exe'), path.join(local, 'Programs', 'voicestudio', 'VoiceStudio.exe'), path.join(local, 'VoiceStudio', 'VoiceStudio.exe')].filter(Boolean).find(f => fs.existsSync(f));
  const cli = onPath(process.platform === 'win32' ? ['voicestudio.exe', 'voicestudio.cmd', 'voicestudio.bat'] : ['voicestudio']);
  return exe || cli ? { exe, cli } : null;
}
async function voiceStatus() {
  let running = false; try { running = (await fetch(voiceUrl() + '/', { signal: AbortSignal.timeout(2000) })).status < 500; } catch {}
  const app = voiceApp();
  return { installed: !!app || running, running, url: voiceUrl(), path: app?.exe || app?.cli || '' };
}
function voiceStart() {
  const app = voiceApp(); if (!app) throw new Error('VoiceStudio is not installed.');
  const [cmd, args] = app.exe ? [app.exe, []] : [app.cli, []];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: /\.(cmd|bat)$/i.test(cmd) }).unref();
  return true;
}
function setVoiceExe(p) { if (!/\.exe$/i.test(p) || !fs.existsSync(p)) throw new Error('Choose VoiceStudio.exe.'); const s = readSettings(); s.voicestudio = { ...(s.voicestudio || {}), exe: p }; writeSettings(s); }
// Official installer script: picks the right installer, verifies it and opens the setup wizard.
TOOL_INSTALL.voicestudio = () => `$ErrorActionPreference='Stop'; Write-Host 'Running the official VoiceStudio installer (voicestudio.sh). Finish the setup wizard when it opens.'; irm https://voicestudio.sh/install.ps1 | iex`;

// Voice typing: whisper.cpp engine + large-v3-turbo model (electron/whisper.cjs pins versions and checksums).
TOOL_INSTALL.blender = () => require('./blender.cjs').installScript();
TOOL_INSTALL.whisper =() => require('./whisper.cjs').installScript();

// The file that matters for each tool: what the user would start or replace by hand.
function toolFile(id) {
  if (id === 'comfyui') {
    const l = comfyConfig().layout; if (!l) return null;
    const bat = ['run_nvidia_gpu.bat', 'run_cpu.bat'].map(f => path.join(l.root, f)).find(f => fs.existsSync(f));
    return bat || path.join(l.app, 'main.py');
  }
  if (id === 'voicestudio') { const a = voiceApp(); return a?.exe || a?.cli || null; }
  if (id === 'blender') return require('./blender.cjs').exe() || null;
  if (id === 'unreal') return require('./unreal.cjs').config().project || null;
  if (id === 'whisper') { const s = require('./whisper.cjs').status(); return s.model || s.exe || null; }
  const exe = id === 'rustxng' ? path.join(binDirs()[0], process.platform === 'win32' ? 'rustxng.exe' : 'rustxng') : id === 'ddgs' ? path.join(binDirs()[1], process.platform === 'win32' ? 'ddgs.exe' : 'ddgs') : '';
  return exe && fs.existsSync(exe) ? exe : null;
}
module.exports = { voiceStatus, voiceStart, voiceUrl, setVoiceExe, toolFile, comfyConfig, comfyStatus, comfyStart, comfyStop, setComfyPath, installScript, comfyLayout, readSettings, writeSettings, binDirs, TOOL_INSTALL };
