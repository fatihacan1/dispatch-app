// Files for the IDE panel: list, read, write, watch, quick open and search. Every path is relative to the
// workspace and is refused if it resolves outside it.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const gitLib = require('./git.cjs');

const HIDDEN = new Set(['.git', 'node_modules']);
const SKIP_WALK = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'release', '.next', '.venv', 'venv', '__pycache__', 'target', '.dispatch']);
const WATCH_SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'target', '.next']);
const MAX_READ = 5 << 20;
const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, args, input) => new Promise(resolve => {
  const child = execFile('git', args, { cwd, env, windowsHide: true, maxBuffer: 32 << 20, timeout: 8000 }, (err, out) => resolve(err ? null : String(out)));
  if (input !== undefined) { child.stdin.end(input); }
});

const norm = p => p.replace(/\\/g, '/').replace(/^\/+/, '');
function resolve(ws, rel = '') {
  const abs = path.resolve(ws, norm(rel));
  const r = path.relative(path.resolve(ws), abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Path is outside the workspace');
  return abs;
}

async function list(ws, rel = '') {
  const dir = resolve(ws, rel);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const items = entries.filter(e => !HIDDEN.has(e.name)).map(e => {
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch {} }
    return { name: e.name, path: norm(path.posix.join(norm(rel), e.name)), dir: isDir };
  });
  // Dim what .gitignore ignores instead of hiding it: the user may still want to open .env or a build output.
  const ignored = await git(dir, ['check-ignore', '--stdin'], items.map(i => i.name).join('\n'));
  const set = new Set((ignored || '').split(/\r?\n/).filter(Boolean).map(s => s.replace(/\/$/, '')));
  for (const i of items) if (set.has(i.name)) i.ignored = true;
  return items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : a.dir ? -1 : 1));
}

function read(ws, rel) {
  const file = resolve(ws, rel);
  const st = fs.statSync(file);
  if (st.size > MAX_READ) return { tooLarge: true, size: st.size };
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) return { binary: true, size: st.size };
  return { text: buf.toString('utf8'), mtime: st.mtimeMs };
}

function write(ws, rel, text) {
  const file = resolve(ws, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return fs.statSync(file).mtimeMs;
}

/** The file as it is in HEAD, for the diff view. null = not in git (new file) or no repo. */
async function head(ws, rel) {
  const file = resolve(ws, rel);
  for (const r of await gitLib.repos(ws)) {
    const inRepo = path.relative(r.dir, file);
    if (inRepo.startsWith('..') || path.isAbsolute(inRepo)) continue;
    const out = await git(r.dir, ['show', 'HEAD:' + norm(inRepo)]);
    return out;
  }
  return null;
}

/** Every file for quick open: git's view (tracked + untracked, not ignored) or a bounded walk without git. */
async function all(ws) {
  const out = [];
  const repos = await gitLib.repos(ws);
  if (repos.length) {
    for (const r of repos) {
      const files = await git(r.dir, ['ls-files', '-co', '--exclude-standard', '-z']);
      if (files) for (const f of files.split('\0')) if (f) out.push(r.prefix + f);
    }
    if (out.length) return out.slice(0, 50000);
  }
  const walk = (dir, rel) => {
    if (out.length >= 20000) return;
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_WALK.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r); else out.push(r);
    }
  };
  walk(ws, '');
  return out;
}

async function search(ws, query, { caseSensitive = false } = {}) {
  if (!query) return [];
  const results = [];
  const needle = caseSensitive ? query : query.toLowerCase();
  for (const rel of await all(ws)) {
    if (results.length >= 300) break;
    let text; try { const file = resolve(ws, rel); const st = fs.statSync(file); if (st.size > 1 << 20) continue; const buf = fs.readFileSync(file); if (buf.subarray(0, 4000).includes(0)) continue; text = buf.toString('utf8'); } catch { continue; }
    const hay = caseSensitive ? text : text.toLowerCase();
    if (!hay.includes(needle)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && results.length < 300; i++) {
      const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
      const col = line.indexOf(needle);
      if (col >= 0) results.push({ path: rel, line: i + 1, col: col + 1, text: lines[i].slice(0, 240) });
    }
  }
  return results;
}

// One watcher per project tab (key), so the Files panels of two open projects do not replace each other.
const watchers = new Map();
function watch(ws, send, key = 'default') {
  unwatch(key);
  if (!ws) return;
  const w = { watcher: chokidar.watch(ws, {
    ignoreInitial: true, depth: 12, followSymlinks: false,
    ignored: p => WATCH_SKIP.has(path.basename(p)),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  }), pending: new Map(), timer: null };
  watchers.set(key, w);
  const push = kind => p => {
    w.pending.set(norm(path.relative(ws, p)), kind);
    clearTimeout(w.timer);
    w.timer = setTimeout(() => { const batch = [...w.pending].map(([file, k]) => ({ path: file, kind: k })); w.pending = new Map(); send(batch); }, 120);
  };
  for (const kind of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) w.watcher.on(kind, push(kind));
  w.watcher.on('error', () => {});
}
function unwatch(key = 'default') { const w = watchers.get(key); if (!w) return; void w.watcher.close(); clearTimeout(w.timer); watchers.delete(key); }

module.exports = { list, read, write, head, all, search, watch, unwatch, resolve };
