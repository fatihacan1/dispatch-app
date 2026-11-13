// Changed files straight from git: the workspace's repo, or, when the workspace is a folder of repos, each repo one level down.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Read-only polling: never take locks, never ask for credentials (no terminal prompt, no helper window).
const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
const git = (cwd, args) => new Promise(resolve => execFile('git', ['-c', 'credential.helper=', ...args], { cwd, env, windowsHide: true, maxBuffer: 8 << 20, timeout: 8000 }, (err, out) => resolve(err ? null : String(out))));

async function repos(workspace) {
  const top = await git(workspace, ['rev-parse', '--show-toplevel']);
  if (top) return [{ dir: top.trim(), prefix: '' }];
  let names = []; try { names = fs.readdirSync(workspace, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(workspace, d.name, '.git'))).map(d => d.name); } catch {}
  return names.map(n => ({ dir: path.join(workspace, n), prefix: n + '/' }));
}

function lines(file) {
  try { const st = fs.statSync(file); if (!st.isFile() || st.size > 2 << 20) return 0; const t = fs.readFileSync(file, 'utf8'); if (t.includes('\0')) return 0; return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0; } catch { return 0; }
}

async function changes(workspace) {
  const out = [];
  for (const r of await repos(workspace)) {
    const [status, numstat] = await Promise.all([git(r.dir, ['status', '--porcelain=v1', '-uall', '-z']), git(r.dir, ['diff', '--numstat', '-z', 'HEAD'])]);
    if (status === null) continue;
    const stats = new Map();
    if (numstat) {
      const parts = numstat.split('\0'); // "add\tdel\tpath" or "add\tdel\t" followed by old\0new for renames
      for (let i = 0; i < parts.length; i++) {
        const m = parts[i].match(/^(-|\d+)\t(-|\d+)\t(.*)$/); if (!m) continue;
        let file = m[3]; if (!file) { i += 2; file = parts[i]; }
        stats.set(file, { add: m[1] === '-' ? 0 : +m[1], del: m[2] === '-' ? 0 : +m[2] });
      }
    }
    const entries = status.split('\0');
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]; if (e.length < 4) continue;
      const code = e.slice(0, 2), file = e.slice(3);
      if (code[0] === 'R' || code[0] === 'C') i++; // next entry is the old path
      const s = stats.get(file) || (code === '??' ? { add: lines(path.join(r.dir, file)), del: 0 } : { add: 0, del: 0 });
      out.push({ path: r.prefix + file, add: s.add, del: s.del, status: code === '??' ? 'new' : code.includes('D') ? 'deleted' : 'modified' });
      if (out.length >= 500) return out;
    }
  }
  return out;
}

module.exports = { changes, repos };
