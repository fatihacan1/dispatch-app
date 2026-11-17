// Multi-account config directory management for Claude Code, Codex, and Antigravity.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROVIDERS = ['claude', 'codex'];
const MAX_ACCOUNTS = 10;

const ENV_VARS = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

function defaultDir(provider, userHome = os.homedir()) {
  if (provider === 'claude') return process.env.CLAUDE_CONFIG_DIR || path.join(userHome, '.claude');
  if (provider === 'codex') return process.env.CODEX_HOME || path.join(userHome, '.codex');
  return '';
}

function envFor(provider, account) {
  if (!account || account.isDefault || account.id === 'default' || !account.dir) return {};
  const key = ENV_VARS[provider];
  if (!key) return {};
  return { [key]: account.dir };
}

function dirFor(provider, account, userHome = os.homedir()) {
  return account?.dir || defaultDir(provider, userHome);
}

function linkOrCopyDir(src, dst) {
  try {
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return;
    if (fs.existsSync(dst)) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
      fs.symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
      return;
    } catch {}
    fs.cpSync(src, dst, { recursive: true, force: false });
  } catch {}
}

function copyFileIfExists(src, dst) {
  try {
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
    if (fs.existsSync(dst)) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  } catch {}
}

// Seed a new account directory with settings and skills from the default directory, never credentials or sessions.
function seedAccountDir(provider, srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  if (!srcDir || path.resolve(srcDir) === path.resolve(dstDir)) return;
  if (provider === 'claude') {
    for (const file of ['settings.json', 'settings.local.json', 'CLAUDE.md']) {
      copyFileIfExists(path.join(srcDir, file), path.join(dstDir, file));
    }
    for (const dir of ['skills', 'agents', 'commands']) {
      linkOrCopyDir(path.join(srcDir, dir), path.join(dstDir, dir));
    }
  } else if (provider === 'codex') {
    for (const file of ['config.toml', 'instructions.md', 'AGENTS.md']) {
      copyFileIfExists(path.join(srcDir, file), path.join(dstDir, file));
    }
    linkOrCopyDir(path.join(srcDir, 'skills'), path.join(dstDir, 'skills'));
  } else if (provider === 'antigravity') {
    copyFileIfExists(path.join(srcDir, 'settings.json'), path.join(dstDir, 'settings.json'));
    linkOrCopyDir(path.join(srcDir, 'skills'), path.join(dstDir, 'skills'));
  }
}

// Cheaply read email/plan from local CLI files without spending model quota.
function readAccountMeta(provider, dir) {
  if (!dir) return { email: '', plan: '' };
  if (provider === 'claude') {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'));
      const plan = String(j?.claudeAiOauth?.subscriptionType || '');
      return { email: '', plan };
    } catch { return { email: '', plan: '' }; }
  }
  if (provider === 'codex') {
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8'));
      const token = auth.tokens?.id_token;
      if (!token) return { email: '', plan: '' };
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      const email = String(claims.email || claims['https://api.openai.com/profile']?.email || '');
      const plan = String(claims['https://api.openai.com/auth']?.chatgpt_plan_type || '');
      return { email, plan };
    } catch { return { email: '', plan: '' }; }
  }
  if (provider === 'antigravity') {
    try {
      const text = fs.readFileSync(path.join(dir, 'cli.log'), 'utf8');
      const all = [...text.matchAll(/authenticated successfully as (\S+@\S+)/g)];
      return { email: all.length ? all[all.length - 1][1] : '', plan: '' };
    } catch { return { email: '', plan: '' }; }
  }
  return { email: '', plan: '' };
}

function create(globalDir, { userHome = os.homedir() } = {}) {
  const file = path.join(globalDir, 'accounts.json');

  function readRaw() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function writeRaw(items) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(items, null, 2));
  }

  function normalizeAll(raw) {
    const out = [];
    for (const provider of PROVIDERS) {
      const defDir = defaultDir(provider, userHome);
      const mine = raw.filter(a => a && a.provider === provider && typeof a.id === 'string' && a.id);
      let def = mine.find(a => a.id === 'default');
      if (!def) {
        def = { provider, id: 'default', label: 'Default', dir: defDir, active: false, isDefault: true };
      } else {
        def = { ...def, provider, id: 'default', label: String(def.label || 'Default'), dir: defDir, isDefault: true };
      }
      const others = mine
        .filter(a => a.id !== 'default' && typeof a.dir === 'string' && a.dir)
        .slice(0, MAX_ACCOUNTS - 1)
        .map(a => ({
          provider,
          id: a.id,
          label: String(a.label || 'Account').slice(0, 40),
          dir: a.dir,
          active: !!a.active,
          email: typeof a.email === 'string' ? a.email : '',
          plan: typeof a.plan === 'string' ? a.plan : '',
        }));
      const group = [def, ...others];
      if (!group.some(a => a.active)) group[0].active = true;
      let seenActive = false;
      for (const a of group) {
        if (a.active && !seenActive) seenActive = true;
        else a.active = false;
      }
      out.push(...group);
    }
    return out;
  }

  function enrich(acc) {
    const meta = readAccountMeta(acc.provider, acc.dir);
    return {
      ...acc,
      email: meta.email || acc.email || '',
      plan: meta.plan || acc.plan || '',
    };
  }

  function list(provider) {
    const all = normalizeAll(readRaw());
    const filtered = provider ? all.filter(a => a.provider === provider) : all;
    return filtered.map(enrich);
  }

  function active(provider) {
    if (!PROVIDERS.includes(provider)) return null;
    const mine = list(provider);
    return mine.find(a => a.active) || mine[0] || null;
  }

  function get(provider, id) {
    if (!PROVIDERS.includes(provider)) return null;
    return list(provider).find(a => a.id === id) || null;
  }

  function add(provider, label) {
    if (!PROVIDERS.includes(provider)) throw new Error(`Provider ${provider} does not support multiple accounts.`);
    const all = normalizeAll(readRaw());
    const mine = all.filter(a => a.provider === provider);
    if (mine.length >= MAX_ACCOUNTS) throw new Error(`Maximum of ${MAX_ACCOUNTS} accounts per provider reached.`);
    const clean = String(label || '').trim().slice(0, 40) || `Account ${mine.length + 1}`;
    const id = 'acc-' + crypto.randomBytes(4).toString('hex');
    const dir = path.join(globalDir, 'accounts', provider, id);
    seedAccountDir(provider, defaultDir(provider, userHome), dir);
    for (const a of all) if (a.provider === provider) a.active = false;
    const created = { provider, id, label: clean, dir, active: true, email: '', plan: '' };
    all.push(created);
    writeRaw(all);
    return enrich(created);
  }

  function activate(provider, id) {
    if (!PROVIDERS.includes(provider)) throw new Error(`Provider ${provider} does not support multiple accounts.`);
    const all = normalizeAll(readRaw());
    const target = all.find(a => a.provider === provider && a.id === id);
    if (!target) throw new Error('Account not found.');
    for (const a of all) if (a.provider === provider) a.active = a.id === id;
    writeRaw(all);
    return enrich(target);
  }

  function rename(provider, id, label) {
    if (!PROVIDERS.includes(provider)) throw new Error(`Provider ${provider} does not support multiple accounts.`);
    const clean = String(label || '').trim().slice(0, 40);
    if (!clean) throw new Error('Account name cannot be empty.');
    const all = normalizeAll(readRaw());
    const target = all.find(a => a.provider === provider && a.id === id);
    if (!target) throw new Error('Account not found.');
    target.label = clean;
    writeRaw(all);
    return list(provider);
  }

  function remove(provider, id) {
    if (!PROVIDERS.includes(provider)) throw new Error(`Provider ${provider} does not support multiple accounts.`);
    if (id === 'default') throw new Error('Default account cannot be removed.');
    const all = normalizeAll(readRaw());
    const target = all.find(a => a.provider === provider && a.id === id);
    if (!target) throw new Error('Account not found.');
    const next = all.filter(a => !(a.provider === provider && a.id === id));
    if (target.active) {
      const def = next.find(a => a.provider === provider && a.id === 'default');
      if (def) def.active = true;
    }
    writeRaw(next);
    // Only remove directories we created under globalDir/accounts.
    const accountsRoot = path.resolve(path.join(globalDir, 'accounts'));
    const targetDir = path.resolve(target.dir);
    if (targetDir.startsWith(accountsRoot + path.sep)) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    }
    return list(provider);
  }

  function updateMeta(provider, id, { email, plan } = {}) {
    if (!PROVIDERS.includes(provider)) return;
    const all = normalizeAll(readRaw());
    const target = all.find(a => a.provider === provider && a.id === id);
    if (!target) return;
    let changed = false;
    if (typeof email === 'string' && email && target.email !== email) { target.email = email; changed = true; }
    if (typeof plan === 'string' && plan && target.plan !== plan) { target.plan = plan; changed = true; }
    if (changed) writeRaw(all);
  }

  return { list, active, get, add, activate, rename, remove, updateMeta };
}

module.exports = { PROVIDERS, MAX_ACCOUNTS, ENV_VARS, defaultDir, envFor, dirFor, seedAccountDir, readAccountMeta, create };
