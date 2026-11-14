// Linting for the editor. Python goes through Ruff (one fast Rust binary): the one on PATH, or a copy Dispatch
// downloads once into ~/.dispatch/bin. The file's unsaved text goes in on stdin, so problems show while typing.
// JS/TS is checked by Monaco's own TypeScript worker in the renderer; nothing to run here.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');

const binDir = () => path.join(process.env.DISPATCH_TEST_HOME || os.homedir(), '.dispatch', 'bin');
const exe = process.platform === 'win32' ? 'ruff.exe' : 'ruff';
const TARGETS = {
  'win32-x64': 'x86_64-pc-windows-msvc.zip', 'win32-arm64': 'aarch64-pc-windows-msvc.zip',
  'darwin-x64': 'x86_64-apple-darwin.tar.gz', 'darwin-arm64': 'aarch64-apple-darwin.tar.gz',
  'linux-x64': 'x86_64-unknown-linux-gnu.tar.gz', 'linux-arm64': 'aarch64-unknown-linux-gnu.tar.gz',
};

const onPath = () => new Promise(resolve => execFile(exe, ['--version'], { windowsHide: true, timeout: 5000 }, err => resolve(err ? null : exe)));
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; }
  }
  return null;
}
async function download() {
  const target = TARGETS[`${process.platform}-${process.arch}`];
  if (!target) throw new Error('No Ruff build for this computer.');
  const res = await fetch(`https://github.com/astral-sh/ruff/releases/latest/download/ruff-${target}`, { headers: { 'user-agent': 'dispatch' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Could not download Ruff (${res.status}).`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ruff-'));
  try {
    const archive = path.join(work, target); fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    await new Promise((resolve, reject) => execFile(tar, ['-xf', archive, '-C', work], { windowsHide: true }, err => err ? reject(err) : resolve()));
    const found = findFile(work, exe); if (!found) throw new Error('The Ruff download had no program in it.');
    fs.mkdirSync(binDir(), { recursive: true });
    const dest = path.join(binDir(), exe); fs.copyFileSync(found, dest); if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    return dest;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
let ruffPath = null;
function ruff() {
  if (!ruffPath) ruffPath = (async () => { const local = path.join(binDir(), exe); if (fs.existsSync(local)) return local; return (await onPath()) || download(); })();
  ruffPath.catch(() => { ruffPath = null; });
  return ruffPath;
}

// Ruff's JSON: [{ code, message, location: { row, column }, end_location: { row, column } }]; syntax errors have code
// null (older Ruff) or "invalid-syntax".
function parseRuff(stdout) {
  let items; try { items = JSON.parse(stdout); } catch { return []; }
  return (Array.isArray(items) ? items : []).map(d => ({
    line: d.location?.row || 1, col: d.location?.column || 1, endLine: d.end_location?.row || d.location?.row || 1, endCol: d.end_location?.column || (d.location?.column || 1) + 1,
    message: d.code && d.code !== 'invalid-syntax' ? `${d.message} (${d.code})` : d.message, severity: !d.code || d.code === 'invalid-syntax' || /^(E9|F8[2-3]|F63|F7)/.test(d.code) ? 'error' : 'warning',
  }));
}

/** Problems in one file's current text: [{ line, col, endLine, endCol, message, severity }]. Unknown languages give []. */
async function lint(workspace, rel, text) {
  if (!/\.pyi?$/i.test(rel)) return [];
  const bin = await ruff();
  return new Promise(resolve => {
    const child = spawn(bin, ['check', '--output-format', 'json', '--exit-zero', '--no-cache', '--stdin-filename', rel, '-'], { cwd: workspace, windowsHide: true });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.on('error', () => resolve([]));
    const timer = setTimeout(() => { child.kill(); resolve([]); }, 15000);
    child.on('close', () => { clearTimeout(timer); resolve(parseRuff(out)); });
    child.stdin.end(String(text ?? ''));
  });
}

module.exports = { lint, parseRuff };
