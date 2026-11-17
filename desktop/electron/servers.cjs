// SSH servers: a saved list (like MobaXterm sessions) the user opens as terminals and agents can use
// through the Dispatch "servers" MCP. Dispatch never stores passwords: terminals ask for them in the
// shell, agents need key auth (ssh-agent or a key file).
// Agent access per server: 'off' (agents do not see it), 'ask' (every command waits for the user), 'on'.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ACCESS = ['off', 'ask', 'on'];
const OUTPUT_LIMIT = 30000;

// vault: { seal(text) -> string, open(string) -> text } (Electron safeStorage: DPAPI / Keychain).
function create(file, vault) {
  const read = () => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = list => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)); return list; };
  function clean(s) {
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    const out = { id: str(s.id, 40) || crypto.randomUUID(), name: str(s.name, 40), host: str(s.host, 255), port: Number(s.port) || 22, user: str(s.user, 64), key: str(s.key, 1000), note: str(s.note, 500), icon: typeof s.icon === 'string' && s.icon.startsWith('data:image/') && s.icon.length < 400000 ? s.icon : '', access: ACCESS.includes(s.access) ? s.access : 'off', vpnId: str(s.vpnId, 40), secret: typeof s.secret === 'string' ? s.secret : '' };
    if (!out.name) throw new Error('Give the server a name');
    if (!out.host || /[\s'"`;|&$<>]/.test(out.host)) throw new Error('Enter a valid host');
    if (out.user && /[\s'"`;|&$<>@]/.test(out.user)) throw new Error('Enter a valid user name');
    if (out.port < 1 || out.port > 65535) throw new Error('Port must be 1-65535');
    return out;
  }
  return {
    // The renderer never sees passwords, only whether one is saved.
    list: () => read().map(({ secret, ...s }) => ({ ...s, hasPassword: !!secret })),
    password: s => { try { return s.secret && vault ? vault.open(s.secret) : ''; } catch { return ''; } },
    get: id => read().find(s => s.id === id || s.name.toLowerCase() === String(id).toLowerCase()),
    save(s) { const list = read(); const old = list.find(x => x.id === s.id); const item = clean({ ...s, secret: typeof s.password === 'string' ? (s.password ? vault.seal(s.password) : '') : old?.secret || '' }); const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); write(list); return item; },
    remove(id) { return write(read().filter(s => s.id !== id)); },
    clearVpn(vpnId) { const list = read(); let changed = false; for (const s of list) { if (s.vpnId === vpnId) { s.vpnId = ''; changed = true; } } return changed ? write(list) : list; },
    order(ids) { const list = read(); return write([...ids.map(id => list.find(s => s.id === id)).filter(Boolean), ...list.filter(s => !ids.includes(s.id))]); },
  };
}

function vpnSshArgs(s, { vpn = null, tunnel = null, proxyScript = '', nodeExe = process.execPath } = {}) {
  const args = [];
  if (vpn?.type === 'wireguard' && tunnel) {
    args.push('-o', `HostKeyAlias=${s.host}`);
  } else if (vpn?.type === 'proxy' && proxyScript) {
    args.push('-o', `ProxyCommand="${nodeExe}" "${proxyScript}" %h %p`);
  } else if (vpn?.type === 'jump' && vpn.host) {
    const jump = `${vpn.user ? vpn.user + '@' : ''}${vpn.host}${vpn.port && Number(vpn.port) !== 22 ? ':' + vpn.port : ''}`;
    args.push('-J', jump);
  }
  return args;
}

/** ssh arguments for a server; batch: no prompts (agents and tests). */
function sshArgs(s, { batch = false, password = false, vpn = null, tunnel = null, proxyScript = '', nodeExe = process.execPath } = {}) {
  const wg = vpn?.type === 'wireguard' && tunnel;
  const host = wg ? tunnel.host : s.host;
  const port = wg ? tunnel.port : (s.port || 22);
  const args = ['-p', String(port), ...vpnSshArgs(s, { vpn, tunnel, proxyScript, nodeExe }), '-o', 'ServerAliveInterval=30', '-o', 'ConnectTimeout=10'];
  if (batch) args.push('-o', password ? 'NumberOfPasswordPrompts=1' : 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new');
  if (s.key) args.push('-i', s.key);
  args.push(s.user ? `${s.user}@${host}` : host);
  return args;
}
function scpArgs(s, password, { vpn = null, tunnel = null, proxyScript = '', nodeExe = process.execPath } = {}) {
  const wg = vpn?.type === 'wireguard' && tunnel;
  const port = wg ? tunnel.port : (s.port || 22);
  const args = ['-P', String(port), ...vpnSshArgs(s, { vpn, tunnel, proxyScript, nodeExe }), '-o', password ? 'NumberOfPasswordPrompts=1' : 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-r'];
  if (s.key) args.push('-i', s.key);
  return args;
}
const remoteSpec = (s, p, { vpn = null, tunnel = null } = {}) => {
  const host = vpn?.type === 'wireguard' && tunnel ? tunnel.host : s.host;
  return `${s.user ? s.user + '@' : ''}${host}:${p}`;
};

// Watches ssh/scp output for a password prompt and answers it (once; a second prompt means it was wrong).
const PROMPT = /(password|passphrase)[^\n]*:\s*$/i;
function answerer(password, write, fail) {
  let tail = '', sent = 0;
  return data => {
    if (!password) return;
    tail = (tail + data).slice(-300);
    if (PROMPT.test(tail)) { tail = ''; if (sent++ >= 1) return fail(); write(password + '\r'); }
  };
}
// With a password: run through a pseudo-terminal, since ssh reads passwords only from a terminal.
function runPty(file, args, password, timeoutMs, extraEnv = null) {
  const pty = require('node-pty');
  return new Promise(resolve => {
    let out = '', finished = false;
    const term = pty.spawn(process.platform === 'win32' ? file + '.exe' : file, args, { name: 'dumb', cols: 200, rows: 50, env: { ...process.env, ...extraEnv, TERM: 'dumb' } });
    const finish = (code, extra = '') => { if (finished) return; finished = true; clearTimeout(timer); try { term.kill(); } catch {} const clean = (out + extra).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, ''); resolve({ code, output: clean.length > OUTPUT_LIMIT ? '[earlier output cut]\n' + clean.slice(-OUTPUT_LIMIT) : clean }); };
    const answer = answerer(password, s => term.write(s), () => finish(255, '\n[the saved password was rejected]'));
    term.onData(d => { out += d; if (out.length > OUTPUT_LIMIT * 2) out = out.slice(-OUTPUT_LIMIT * 2); answer(d); });
    term.onExit(({ exitCode }) => finish(exitCode));
    const timer = setTimeout(() => finish(-1, `\n[stopped after ${Math.round(timeoutMs / 1000)} s]`), timeoutMs);
  });
}
function run(file, args, timeoutMs, extraEnv = null) {
  return new Promise(resolve => {
    let out = '', done = false;
    const child = spawn(file, args, { windowsHide: true, env: extraEnv ? { ...process.env, ...extraEnv } : process.env });
    const add = d => { out += d; if (out.length > OUTPUT_LIMIT * 2) out = out.slice(-OUTPUT_LIMIT * 2); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { if (!done) { child.kill(); out += `\n[stopped after ${Math.round(timeoutMs / 1000)} s]`; } }, timeoutMs);
    child.on('error', e => { done = true; clearTimeout(timer); resolve({ code: -1, output: e.code === 'ENOENT' ? `${file} was not found. Install OpenSSH.` : e.message }); });
    child.on('close', code => { done = true; clearTimeout(timer); resolve({ code, output: out.length > OUTPUT_LIMIT ? '[earlier output cut]\n' + out.slice(-OUTPUT_LIMIT) : out }); });
  });
}
// pw: the server's password ('' for key auth).
const exec = (s, command, timeoutMs = 120000, pw = '', vpnOpts = {}) => pw ? runPty('ssh', [...sshArgs(s, { batch: true, password: true, ...vpnOpts }), command], pw, timeoutMs, vpnOpts.env) : run('ssh', [...sshArgs(s, { batch: true, ...vpnOpts }), command], timeoutMs, vpnOpts.env);
const test = (s, pw = '', vpnOpts = {}) => exec(s, 'echo dispatch-ok', 15000, pw, vpnOpts).then(r => ({ ok: r.code === 0 && r.output.includes('dispatch-ok'), output: r.output.trim() }));
const upload = (s, local, remote, timeoutMs = 600000, pw = '', vpnOpts = {}) => (pw ? (f, a, t) => runPty(f, a, pw, t, vpnOpts.env) : (f, a, t) => run(f, a, t, vpnOpts.env))('scp', [...scpArgs(s, !!pw, vpnOpts), local, remoteSpec(s, remote, vpnOpts)], timeoutMs);
const download = (s, remote, local, timeoutMs = 600000, pw = '', vpnOpts = {}) => (pw ? (f, a, t) => runPty(f, a, pw, t, vpnOpts.env) : (f, a, t) => run(f, a, t, vpnOpts.env))('scp', [...scpArgs(s, !!pw, vpnOpts), remoteSpec(s, remote, vpnOpts), local], timeoutMs);

module.exports = { create, sshArgs, scpArgs, remoteSpec, exec, test, upload, download, answerer, ACCESS };
