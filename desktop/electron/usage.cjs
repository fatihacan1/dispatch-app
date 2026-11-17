// Remaining usage limits (session 5h / weekly) for Claude Code, Codex and Antigravity.
// Sources and failure modes are documented in docs/providers.md. Never throws: errors are returned in `error`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const TTL = 60000;
// Antigravity has no free usage query: reading it sends a prompt to the model (one turn of quota), so it is never
// included in the automatic poll. The user asks for it with the Refresh button in its usage section.
const AUTO = ['claude', 'codex'];
const SUPPORTED = [...AUTO, 'antigravity'];
const cache = new Map(); // provider -> { at, value, pending }
// Last good reading per provider, kept on disk so a failed first fetch after a restart (429, expired token) still shows the last numbers.
let cacheFile = null, saved = null;
function setCacheFile(file) { cacheFile = file; saved = null; cache.clear(); }
function savedReadings() { if (saved) return saved; try { saved = cacheFile ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {} : {}; } catch { saved = {}; } return saved; }
function remember(value) {
  if (!cacheFile || value.error || !value.windows?.length) return;
  const all = savedReadings(); all[value.provider] = value;
  try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(all)); } catch {}
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampPct = v => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
const iso = v => { if (v == null) return null; const t = typeof v === 'number' ? v * 1000 : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const homeDir = () => process.env.DISPATCH_USAGE_HOME || os.homedir();

function minutesLabel(m) {
  if (m === 300) return 'Session (5h)';
  if (m === 10080) return 'Weekly';
  if (m && m % 1440 === 0) return `${m / 1440}-day`;
  if (m && m % 60 === 0) return `${m / 60}h`;
  return m ? `${m} min` : 'Limit';
}

// --- Claude Code: GET https://api.anthropic.com/api/oauth/usage with the Claude Code OAuth token ---
function parseClaude(data, plan) {
  const windows = [];
  const add = (id, label, w, extra = {}) => { const used = num(w?.utilization ?? w?.percent); if (used != null) windows.push({ id, label, usedPercent: clampPct(used), resetsAt: iso(w.resets_at), ...extra }); };
  add('session', 'Session (5h)', data?.five_hour, { windowMinutes: 300 });
  add('weekly', 'Weekly', data?.seven_day, { windowMinutes: 10080 });
  const scoped = Array.isArray(data?.limits) ? data.limits.filter(l => l.kind === 'weekly_scoped') : [];
  if (scoped.length) scoped.forEach((l, i) => add(`weekly-scoped-${i}`, `Weekly ${l.scope?.model?.display_name || l.scope?.surface?.display_name || 'scoped'}`, l, { windowMinutes: 10080 }));
  else { add('weekly-opus', 'Weekly Opus', data?.seven_day_opus, { windowMinutes: 10080 }); add('weekly-sonnet', 'Weekly Sonnet', data?.seven_day_sonnet, { windowMinutes: 10080 }); }
  if (!windows.length && Array.isArray(data?.limits)) for (const [i, l] of data.limits.entries()) add(`limit-${i}`, l.group === 'session' ? 'Session (5h)' : 'Weekly', l);
  return { provider: 'claude', plan: plan || undefined, windows, source: 'Anthropic OAuth usage endpoint' };
}

function readClaudeToken(accountDir) {
  const file = path.join(accountDir || process.env.CLAUDE_CONFIG_DIR || path.join(homeDir(), '.claude'), '.credentials.json');
  let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const o = j?.claudeAiOauth; return o?.accessToken ? { token: o.accessToken, expiresAt: num(o.expiresAt), plan: o.subscriptionType } : null;
}

async function fetchClaude(opts = {}) {
  const cred = readClaudeToken(opts.accountDir);
  if (!cred) return { error: 'No Claude subscription sign-in found (API-key users have no session or weekly limits).', errorCode: 'unsupported' };
  if (cred.expiresAt && cred.expiresAt < Date.now()) return { error: 'The Claude sign-in token has expired. Open Claude Code once to refresh it.', errorCode: 'token-expired', plan: cred.plan };
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (res.status === 401 || res.status === 403) return { error: 'Claude rejected the stored token. Sign in again from Providers.', errorCode: 'auth', plan: cred.plan };
    if (res.status === 429) { const wait = Number(res.headers.get('retry-after')); return { error: 'Claude usage endpoint is rate limited; try again in a minute.', errorCode: 'rate-limited', retryAfter: Number.isFinite(wait) && wait > 0 ? wait : 60, plan: cred.plan }; }
    if (!res.ok) return { error: `Claude usage endpoint returned ${res.status}.`, plan: cred.plan };
    const out = parseClaude(await res.json(), cred.plan);
    return out.windows.length ? out : { error: 'Claude returned no limit windows for this account.', errorCode: 'unsupported', plan: cred.plan };
  } catch (e) { return { error: `Claude usage request failed: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`, plan: cred.plan }; }
}

// --- Codex: app-server `account/rateLimits/read` (live), fallback to the newest rollout token_count event ---
function codexWindow(id, fallback, w) {
  const used = num(w?.usedPercent ?? w?.used_percent); if (used == null) return null;
  const mins = num(w.windowDurationMins ?? w.window_minutes);
  const resets = w.resetsAt ?? w.resets_at ?? (num(w.resets_in_seconds) != null ? Math.floor(Date.now() / 1000) + w.resets_in_seconds : null);
  return { id, label: mins ? minutesLabel(mins) : fallback, usedPercent: clampPct(used), resetsAt: iso(resets), windowMinutes: mins || undefined };
}
function parseCodexLimits(rl, plan) {
  const windows = [];
  const byId = rl?.rateLimitsByLimitId && typeof rl.rateLimitsByLimitId === 'object' ? rl.rateLimitsByLimitId : null;
  const main = rl?.rateLimits || rl;
  const push = (snap, prefix, name) => {
    for (const [k, fb] of [['primary', 'Session (5h)'], ['secondary', 'Weekly']]) {
      const w = codexWindow(`${prefix}${k}`, fb, snap?.[k]); if (w) windows.push(name ? { ...w, label: `${name} ${w.label}` } : w);
    }
  };
  push(main, '', '');
  if (byId) for (const [id, snap] of Object.entries(byId)) if (id !== (main?.limitId || 'codex') && snap) push(snap, `${id}-`, snap.limitName || id);
  return { provider: 'codex', plan: main?.planType || plan || undefined, windows, source: 'Codex app-server (account/rateLimits/read)' };
}
function parseCodexRollout(text) {
  const lines = String(text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let j; try { j = JSON.parse(lines[i]); } catch { continue; }
    const rl = j?.payload?.rate_limits; if (!rl?.primary && !rl?.secondary) continue;
    const out = parseCodexLimits({ ...rl, limitId: rl.limit_id }, rl.plan_type);
    const now = Date.now();
    out.windows = out.windows.map(w => (w.resetsAt && Date.parse(w.resetsAt) < now ? { ...w, usedPercent: 0, resetsAt: null, note: 'window reset since the last session' } : w));
    return { ...out, source: 'Codex session log (last token_count event)', updatedAt: j.timestamp ? iso(j.timestamp) : undefined, windows: out.windows };
  }
  return null;
}
function newestRollout(accountDir) {
  const root = path.join(accountDir || process.env.CODEX_HOME || path.join(homeDir(), '.codex'), 'sessions'); let best = null;
  const walk = (dir, depth) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(f, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) { try { const m = fs.statSync(f).mtimeMs; if (!best || m > best.m) best = { f, m }; } catch {} }
    }
  };
  walk(root, 0); return best?.f || null;
}
function killTree(child) {
  try { if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); else child.kill(); } catch {}
}
function codexAppServer(spec, timeout = 15000, extraEnv = null) {
  return new Promise((resolve, reject) => {
    let child; try { child = spawn(spec.file, [...spec.args, 'app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, ...(extraEnv || {}) } }); } catch (e) { return reject(e); }
    let buf = '', done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); killTree(child); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('timed out')), timeout);
    child.on('error', finish); child.on('exit', () => finish(new Error('app-server exited')));
    child.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'account/rateLimits/read' }); }
        else if (m.id === 2) m.error ? finish(new Error(m.error.message || 'rate limit request failed')) : finish(null, m.result);
      }
    });
    const send = o => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dispatch', version: '1' } } });
  });
}
async function fetchCodex(resolveCommand, opts = {}) {
  let spec; try { spec = resolveCommand('codex'); } catch { return { error: 'Codex is not installed.', errorCode: 'not-installed' }; }
  let liveError = '';
  try {
    const out = parseCodexLimits(await codexAppServer(spec, 15000, opts.env));
    if (out.windows.length) return out;
    liveError = 'no limits reported';
  } catch (e) { liveError = e.message; }
  try {
    const f = newestRollout(opts.accountDir); const parsed = f && parseCodexRollout(fs.readFileSync(f, 'utf8'));
    if (parsed?.windows.length) return { ...parsed, stale: true };
  } catch {}
  return { error: `Codex limits are unavailable (${liveError}). Sign in with a ChatGPT plan; API-key use has no session limits.`, errorCode: 'unavailable' };
}

// --- Antigravity: `agy -p "/usage" --output-format json` (print mode spends one model turn, so manual refresh only) ---
const AGY_GROUPS = { 'Gemini Models': 'Gemini', 'Claude and GPT models': 'Claude/GPT' };
function parseAntigravity(json) {
  const groups = json?.command?.data?.groups; const windows = [];
  if (!Array.isArray(groups)) return { provider: 'antigravity', windows, source: 'agy /usage' };
  for (const g of groups) for (const b of g.buckets || []) {
    const frac = b.disabled ? 0 : num(b.remaining_fraction ?? b.remainingFraction); if (frac == null) continue;
    const win = String(b.window || b.id || '').includes('5h') ? '5h' : 'weekly';
    windows.push({ id: b.id || `${g.name}-${win}`, label: `${AGY_GROUPS[g.name] || g.name} ${win === '5h' ? 'Session (5h)' : 'Weekly'}`, usedPercent: clampPct((1 - frac) * 100), resetsAt: iso(b.reset_time ?? b.resetTime), windowMinutes: win === '5h' ? 300 : 10080, group: AGY_GROUPS[g.name] || g.name });
  }
  return { provider: 'antigravity', windows, source: 'agy /usage' };
}
// agy 1.5.x has no /usage command in print mode: `agy -p /usage` sends '/usage' to the model as a prompt, so it spends
// a real turn of the user's quota. It is only ever called from an explicit Refresh (force), never by the 3-minute poll.
function run(spec, args, timeout = 30000, extraEnv = null) {
  return new Promise((resolve, reject) => {
    execFile(spec.file, [...spec.args, ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...(extraEnv || {}), NO_COLOR: '1', CI: '1' } },
      (error, stdout, stderr) => {
        if (error && !stdout && !stderr) return reject(error);
        resolve(stripAnsi(String(stdout || '') + String(stderr || '')));
      });
  });
}
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
async function fetchAntigravity(resolveCommand, opts = {}) {
  let spec; try { spec = resolveCommand('agy'); } catch { return { error: 'Antigravity is not installed.', errorCode: 'not-installed' }; }
  try {
    const out = await run(spec, ['-p', '/usage', '--output-format', 'json'], 30000, opts.env);
    const start = out.indexOf('{'), end = out.lastIndexOf('}');
    let json = null; try { json = JSON.parse(start >= 0 && end > start ? out.slice(start, end + 1) : out); } catch {}
    const parsed = parseAntigravity(json);
    if (parsed.windows.length) return { ...parsed, updatedAt: new Date().toISOString() };
    return { error: 'Antigravity returned no limit windows. It may have answered as a normal prompt instead of /usage.', errorCode: 'unavailable' };
  } catch (e) { return { error: `Antigravity usage request failed: ${e.killed ? 'timed out' : e.message}`, errorCode: 'unavailable' }; }
}

// --- public API ---
const FETCH = { claude: (_r, opts) => fetchClaude(opts), codex: (r, opts) => fetchCodex(r, opts), antigravity: (r, opts) => fetchAntigravity(r, opts) };

const cacheKey = (provider, accountId) => `${provider}:${accountId || 'default'}`;

async function load(provider, resolveCommand, opts = {}) {
  let r;
  try { r = await FETCH[provider](resolveCommand, opts); } catch (e) { r = { error: e.message || String(e) }; }
  const key = cacheKey(provider, opts.accountId);
  const prev = cache.get(key)?.value || savedReadings()[key] || (!opts.accountId || opts.accountId === 'default' ? savedReadings()[provider] : null);
  const value = { provider, windows: [], ...r, updatedAt: new Date().toISOString() };
  if (value.error && prev?.windows?.length && value.errorCode !== 'not-installed' && value.errorCode !== 'unsupported') return { ...prev, stale: true, error: value.error, staleSince: prev.staleSince || prev.updatedAt };
  return value;
}

// getUsage(providerId, { resolveCommand, force, env, accountDir, accountId }) -> normalized usage; never throws.
async function getUsage(provider, opts = {}) {
  const { resolveCommand, force, accountId } = opts;
  if (!SUPPORTED.includes(provider)) return { provider, windows: [], updatedAt: new Date().toISOString(), source: 'none', error: 'Usage limits are not available for this provider.', errorCode: 'unsupported' };
  const key = cacheKey(provider, accountId);
  const hit = cache.get(key);
  if (hit?.pending) return hit.pending;
  // Reading Antigravity costs a model turn. Until the user presses Refresh, show the last saved reading (if any) and
  // make it clear the number is not live.
  if (provider === 'antigravity' && !force) {
    const prev = hit?.value?.windows?.length ? hit.value : (savedReadings()[key] || (!accountId || accountId === 'default' ? savedReadings()[provider] : null));
    return prev?.windows?.length ? { ...prev, stale: true } : { provider, windows: [], updatedAt: new Date().toISOString(), source: 'agy /usage', error: 'Press Refresh to read the Antigravity limit. Reading it spends one model turn.', errorCode: 'manual' };
  }
  if (!force && hit?.value && Date.now() - hit.at < TTL) return hit.value;
  const pending = load(provider, resolveCommand, opts).then(value => {
    cache.set(key, { at: Date.now(), value });
    if (!value.error && value.windows?.length && cacheFile) {
      const all = savedReadings(); all[key] = value;
      try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(all)); } catch {}
    }
    return value;
  });
  cache.set(key, { ...(hit || { at: 0 }), pending });
  return pending;
}
async function getAll(opts = {}) {
  const ids = opts.providers || SUPPORTED;
  const list = await Promise.all(ids.filter(id => SUPPORTED.includes(id)).map(id => getUsage(id, { ...opts, ...(opts.forProvider ? opts.forProvider(id) : {}) })));
  return Object.fromEntries(list.map(u => [u.provider, u]));
}

// Fixed sample data for demo mode and screenshots (no network, no CLI).
function demo() {
  const h = n => new Date(Date.now() + n * 3600e3).toISOString(), now = new Date().toISOString();
  const mk = (provider, plan, source, windows) => ({ provider, plan, source, windows, updatedAt: now });
  return {
    claude: mk('claude', 'max', 'demo data', [{ id: 'session', label: 'Session (5h)', usedPercent: 38, resetsAt: h(3.2), windowMinutes: 300 }, { id: 'weekly', label: 'Weekly', usedPercent: 64, resetsAt: h(96), windowMinutes: 10080 }, { id: 'weekly-scoped-0', label: 'Weekly Opus', usedPercent: 91, resetsAt: h(96), windowMinutes: 10080 }]),
    codex: mk('codex', 'plus', 'demo data', [{ id: 'primary', label: 'Session (5h)', usedPercent: 12, resetsAt: h(4.1), windowMinutes: 300 }, { id: 'secondary', label: 'Weekly', usedPercent: 22, resetsAt: h(120), windowMinutes: 10080 }]),
    antigravity: mk('antigravity', undefined, 'demo data', [{ id: 'gemini-weekly', label: 'Gemini Weekly', usedPercent: 8, resetsAt: h(150), windowMinutes: 10080, group: 'Gemini' }, { id: '3p-weekly', label: 'Claude/GPT Weekly', usedPercent: 96, resetsAt: h(150), windowMinutes: 10080, group: 'Claude/GPT' }]),
  };
}

module.exports = { AUTO, SUPPORTED, setCacheFile, getUsage, getAll, demo, parseClaude, parseCodexLimits, parseCodexRollout, parseAntigravity, minutesLabel };
