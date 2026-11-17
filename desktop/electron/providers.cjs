// Provider CLIs: detection, auth status, models, and install/login/logout commands.
// Commands verified from each CLI's --help (see docs/providers.md).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const WIN = process.platform === 'win32';
const CACHE = path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'providers.json');

const PROVIDERS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', update: 'claude update', status: ['auth', 'status', '--json'], login: ['auth', 'login'], logout: ['auth', 'logout'],
    install: WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash', uninstall: 'npm uninstall -g @anthropic-ai/claude-code',
    known: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  { id: 'codex', name: 'Codex', bin: 'codex', status: ['login', 'status'], login: ['login'], logout: ['logout'],
    pkg: '@openai/codex', update: 'npm install -g @openai/codex@latest', install: 'npm install -g @openai/codex', uninstall: 'npm uninstall -g @openai/codex', known: ['gpt-6.1-terra', 'gpt-6.1-sol'] },
  { id: 'antigravity', name: 'Antigravity', bin: 'agy', update: 'agy update', status: ['models'], login: [], logout: null, models: ['models'],
    install: WIN ? 'irm https://antigravity.google/cli/install.ps1 | iex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    uninstall: WIN ? 'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\agy"' : 'rm -rf ~/.local/share/agy ~/.local/bin/agy', known: ['default'] },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', status: ['auth', 'list'], login: ['auth', 'login'], logout: ['auth', 'logout'], models: ['models'],
    pkg: 'opencode-ai', update: 'npm install -g opencode-ai@latest', install: 'npm install -g opencode-ai', uninstall: 'npm uninstall -g opencode-ai', known: ['default'] },
  { id: 'qoder', name: 'Qoder', bin: 'qodercli', status: ['status', '--output', 'json'], login: ['login'], logout: null, models: ['--list-models'],
    pkg: '@qoder-ai/qodercli', update: 'npm install -g @qoder-ai/qodercli@latest', install: 'npm install -g @qoder-ai/qodercli', uninstall: 'npm uninstall -g @qoder-ai/qodercli', known: ['default'] },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', status: null, login: [], logout: null,
    pkg: '@google/gemini-cli', update: 'npm install -g @google/gemini-cli@latest', install: 'npm install -g @google/gemini-cli', uninstall: 'npm uninstall -g @google/gemini-cli', known: ['default'] },
];
// Reasoning effort levels each CLI accepts at launch. OpenCode and Gemini CLI have no such flag.
const EFFORTS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  antigravity: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  qoder: ['low', 'medium', 'high'],
};
// Permission / approval modes each CLI accepts at launch. '' (default) leaves the CLI's own setting alone.
// Claude: --permission-mode. Codex: sandbox mode (-s) or approval policy (-a never / bypass). Antigravity: --mode.
const PERMISSIONS = {
  claude: ['acceptEdits', 'bypassPermissions', 'plan'],
  codex: ['read-only', 'workspace-write', 'danger-full-access', 'never', 'bypass'],
  antigravity: ['accept-edits', 'auto', 'plan', 'bypass'],
};

const strip =s => String(s || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
function run(spec, args, timeout = 10000) {
  return new Promise(resolve => {
    execFile(spec.file, [...spec.args, ...args], { timeout, windowsHide: true, env: { ...process.env, NO_COLOR: '1', CI: '1' } },
      (error, stdout, stderr) => resolve({ ok: !error, code: error ? (error.code ?? 1) : 0, out: strip(stdout) + strip(stderr) }));
  });
}

function readCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } }
function writeCache(c) { try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(c, null, 2)); } catch {} }

function codexCachedModels() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'));
    const list = (Array.isArray(j) ? j : j.models || j.data || []).map(m => typeof m === 'string' ? m : m.slug || m.id || m.name).filter(Boolean);
    return [...new Set(list)];
  } catch { return []; }
}

function parseModels(id, result) {
  if (!result.ok) return [];
  const out = strip(result.out).trim();
  try {
    const json = JSON.parse(out);
    const entries = Array.isArray(json) ? json : json.models || json.data;
    if (Array.isArray(entries)) return [...new Set(entries.map(m => typeof m === 'string' ? m : m.id || m.slug || m.name).filter(Boolean))];
  } catch {}
  const lines = out.split(/\r?\n/).map(line => line.trim());
  return [...new Set(lines.map(line => {
    if (id === 'antigravity') return /^([\w./:-]+)(?:\t| {2,})\S/.exec(line)?.[1];
    if (id === 'opencode') return /^([\w.-]+\/[\w./:-]+)$/.exec(line)?.[1];
    if (id === 'qoder') return /^(?:[*\u2022\u25cf]\s*)?([\w./:-]+)(?:\s{2,}.*|\s*\(.*\))?$/.exec(line)?.[1];
  }).filter(m => m && m.length < 80 && !/^(name|model|models|default:|warning)$/i.test(m)))];
}

// Neither CLI prints the account email in its status, so it is read from their own local files.
// Codex: the email claim of the id_token in ~/.codex/auth.json (ChatGPT sign-in).
function codexEmail() {
  try {
    const os = require('os'), fs = require('fs'), path = require('path');
    const auth = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), 'utf8'));
    const token = auth.tokens?.id_token; if (!token) return '';
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return claims.email || claims['https://api.openai.com/profile']?.email || '';
  } catch { return ''; }
}
// Antigravity: its CLI log records "authenticated successfully as <email>" on each start.
function antigravityEmail() {
  try {
    const os = require('os'), fs = require('fs'), path = require('path');
    const text = fs.readFileSync(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cli.log'), 'utf8');
    const all = [...text.matchAll(/authenticated successfully as (\S+@\S+)/g)];
    return all.length ? all[all.length - 1][1] : '';
  } catch { return ''; }
}
function parseAuth(p, r) {
  if (!p.status) return { auth: 'unknown', detail: 'Sign-in state can only be checked inside the CLI.' };
  const out = r.out.trim();
  if (p.id === 'claude') {
    try { const j = JSON.parse(out.slice(out.indexOf('{'))); const ok = j.loggedIn ?? j.logged_in ?? j.authenticated; return { auth: ok ? 'signed-in' : 'signed-out', detail: j.email || j.account?.email || j.authMethod || '' }; } catch {}
  }
  if (p.id === 'codex') return /logged in/i.test(out) && !/not logged in/i.test(out) ? { auth: 'signed-in', detail: codexEmail() || out.split('\n')[0] } : { auth: 'signed-out', detail: '' };
  if (p.id === 'antigravity') {
    if (parseModels(p.id, r).length) return { auth: 'signed-in', detail: antigravityEmail() };
    if (/not (?:logged|signed) in|login required|sign in|authentication required/i.test(out)) return { auth: 'signed-out', detail: '' };
    return { auth: 'unknown', detail: 'Could not verify sign-in with agy models.' };
  }
  if (p.id === 'opencode' && /database is not empty and has no session table/i.test(out)) return { auth: 'error', detail: 'OpenCode database needs repair.', canRepair: true };
  if (p.id === 'opencode' && !r.ok) return { auth: 'error', detail: 'OpenCode status failed. Check the CLI for details.' };
  if (p.id === 'opencode') { const n = ((/(\d+)\s+credentials?/i.exec(out) || [])[1] | 0) || (out.match(/^\s*[\u25cf\u2022\-*]\s+\S/gm) || []).length; return n > 0 ? { auth: 'signed-in', detail: `${n} credential${n === 1 ? '' : 's'}` } : { auth: 'signed-out', detail: '' }; }
  if (p.id === 'qoder') { try { const j = JSON.parse(out.slice(out.indexOf('{'))); const ok = j.loggedIn ?? j.logged_in ?? j.authenticated ?? !!(j.user || j.account); return { auth: ok ? 'signed-in' : 'signed-out', detail: j.user?.email || j.email || '' }; } catch {} return /not logged|login required|sign in/i.test(out) || !r.ok ? { auth: 'signed-out', detail: '' } : { auth: 'signed-in', detail: '' }; }
  return { auth: r.ok ? 'signed-in' : 'signed-out', detail: '' };
}

async function check(resolveCommand, id) {
  const p = PROVIDERS.find(x => x.id === id);
  let spec;
  try { spec = resolveCommand(p.bin); } catch { return { id, name: p.name, installed: false, auth: 'n/a', version: '', path: '', models: p.known }; }
  const v = await run(spec, ['--version'], 8000);
  const version = (/\d+\.\d+(\.\d+)?/.exec(v.out) || [''])[0];
  const status = p.status ? await run(spec, p.status, 12000) : null;
  const a = parseAuth(p, status || { ok: true, out: '' });
  const cache = readCache();
  let models = withKnown(p, cache[id]?.models?.length ? cache[id].models : (id === 'codex' && codexCachedModels().length ? codexCachedModels() : p.known));
  if (a.auth === 'signed-in' && p.models) models = await refreshModels(resolveCommand, id, id === 'antigravity' ? status : undefined);
  return { id, name: p.name, installed: true, version, path: spec.args.at(-1) || spec.file, ...a, models, canLogout: !!p.logout || (id === 'antigravity' && WIN) };
}

async function refreshModels(resolveCommand, id, recorded) {
  const p = PROVIDERS.find(x => x.id === id);
  let models = [];
  if (id === 'codex') models = codexCachedModels();
  if (!models.length && p.models) {
    try { const r = recorded || await run(resolveCommand(p.bin), p.models, 20000); models = parseModels(id, r); } catch {}
  }
  if (!models.length) models = p.known;
  const c = readCache(); c[id] = { ...(c[id] || {}), models, updated: new Date().toISOString() }; writeCache(c);
  return models;
}

function cmpVer(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }
// Latest published version from the npm registry (no shell). Returns '' when unknown.
function latestVersion(pkg) {
  if (!pkg) return Promise.resolve('');
  return fetch('https://registry.npmjs.org/' + pkg.replace('/', '%2f') + '/latest', { signal: AbortSignal.timeout(8000) })
    .then(r => (r.ok ? r.json() : {})).then(j => j.version || '').catch(() => '');
}
async function updateInfo(id, installed) {
  const p = PROVIDERS.find(x => x.id === id);
  if (!installed) return { update: 'n/a' };
  if (!p.pkg) return { update: p.update ? 'manual' : 'n/a' };
  const latest = await latestVersion(p.pkg);
  if (!latest) return { update: 'unknown' };
  return { latest, update: cmpVer(latest, installed) > 0 ? 'available' : 'current' };
}

// Returns a spawn spec {file,args} for an interactive action run in an in-app terminal.
function actionSpec(resolveCommand, id, kind) {
  const p = PROVIDERS.find(x => x.id === id);
  const shell = cmd => WIN ? { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd] } : { file: '/bin/sh', args: ['-lc', cmd] };
  if (kind === 'repair' && id === 'opencode') {
    // Move the entire data directory aside, including credentials and the database.
    return shell(WIN
      ? '$base = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:USERPROFILE ".local\\share" }; $target = Join-Path $base "opencode"; if (Test-Path -LiteralPath $target) { $backup = "$target.backup-$(Get-Date -Format yyyyMMdd-HHmmss)-$([guid]::NewGuid().ToString("N"))"; Move-Item -LiteralPath $target -Destination $backup -ErrorAction Stop; Write-Host "Backed up OpenCode data to $backup" } else { Write-Host "OpenCode data directory not found" }'
      : 'base="${XDG_DATA_HOME:-$HOME/.local/share}"; target="$base/opencode"; if [ -e "$target" ]; then backup="$target.backup-$(date +%Y%m%d-%H%M%S)-$$"; mv -- "$target" "$backup" && echo "Backed up OpenCode data to $backup"; else echo "OpenCode data directory not found"; fi');
  }
  // agy has no logout subcommand (only /logout inside a session); its token lives in Windows Credential Manager.
  if (kind === 'logout' && id === 'antigravity') return shell('cmdkey /delete:gemini:antigravity; if ($LASTEXITCODE -eq 0) { Write-Host "Signed out of Antigravity." } else { Write-Host "No saved Antigravity sign-in found." }');
  if (kind === 'install') return shell(p.install);
  if (kind === 'uninstall') return shell(p.uninstall);
  if (kind === 'update') return shell(p.update || p.install);
  const base = resolveCommand(p.bin);
  const args = kind === 'login' ? p.login : kind === 'logout' ? (p.logout || []) : [];
  return { file: base.file, args: [...base.args, ...args] };
}

// Models a CLI reported earlier are kept, and the known ones always added: a model released after the last refresh
// (Claude Fable) was missing from the dropdown until the user pressed Refresh models.
function withKnown(p, models) { return [...new Set([...p.known.filter(m => m !== 'default' || !models.length), ...models])]; }
function allModels() { const c = readCache(); const out = {}; for (const p of PROVIDERS) out[p.id] = withKnown(p, c[p.id]?.models?.length ? c[p.id].models : (p.id === 'codex' && codexCachedModels().length ? codexCachedModels() : p.known)); return out; }

module.exports = { PROVIDERS, EFFORTS, PERMISSIONS, check, refreshModels, actionSpec, allModels, updateInfo, parseAuth, parseModels };
