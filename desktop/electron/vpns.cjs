// Per-server VPNs / tunnels: WireGuard (userspace via wireproxy), SOCKS5/HTTP proxy, and SSH jump hosts.
// No system-wide routing, no TUN adapter, no admin rights required.
const fs = require('fs');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { connectViaProxy } = require('./proxy-tunnel.cjs');

const VPN_TYPES = ['wireguard', 'proxy', 'jump'];
const PROXY_PROTOCOLS = ['socks5', 'http'];
const IDLE_MS = 5 * 60 * 1000;
const WG_IGNORED_KEYS = new Set(['preup', 'postup', 'predown', 'postdown', 'table', 'saveconfig']);
const SHELL_BAD = /[\s'"`;|&$<>]/;
const WIREPROXY_VERSION = 'v1.1.3';
const WIREPROXY_SHA256 = {
  'wireproxy_windows_386.tar.gz': '512bd0b724ef50125f00b6d7e978009caa359066ab7f777ae473f734278f326e',
  'wireproxy_windows_amd64.tar.gz': 'bce041ea9fe0f8a3351301dcbe29cdf6a523bb25cf9c62f17ebb5699a8051d0f',
  'wireproxy_darwin_amd64.tar.gz': '5d89742a0f381d9508d3ad828a0d300dceee24fa49015427eaff42a23f7a50bd',
  'wireproxy_darwin_arm64.tar.gz': '28d34342c48c309b628d9c06ab4efc05b82fba49821f360605c02139c02547a5',
  'wireproxy_linux_386.tar.gz': 'e24340318d5e9ea5f9e5746ec80370736d8712c76c5fa9868d449d69d2373244',
  'wireproxy_linux_amd64.tar.gz': 'e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c',
  'wireproxy_linux_arm.tar.gz': '19bbc5571f8f7a00e35f6f0d653201f25de2ce1a25659e4a45fb9e00929c954c',
  'wireproxy_linux_arm64.tar.gz': '370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6',
};

const activeTunnels = new Map(); // vpnId -> { child, confPath, tunnels: Map<targetKey, port>, idleTimer }
let downloading = null;

function wireproxyAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    const a = arch === 'ia32' ? '386' : 'amd64';
    return { asset: `wireproxy_windows_${a}.tar.gz`, binName: 'wireproxy.exe' };
  }
  if (platform === 'darwin') {
    const a = arch === 'arm64' ? 'arm64' : 'amd64';
    return { asset: `wireproxy_darwin_${a}.tar.gz`, binName: 'wireproxy' };
  }
  if (platform === 'linux') {
    const a = arch === 'arm64' ? 'arm64' : arch === 'arm' ? 'arm' : arch === 'ia32' ? '386' : 'amd64';
    return { asset: `wireproxy_linux_${a}.tar.gz`, binName: 'wireproxy' };
  }
  throw new Error(`Unsupported platform for wireproxy: ${platform}/${arch}`);
}

/** Extract a single named file from a .tar.gz buffer without external tools. */
function extractTarGzFile(gzBuf, targetName) {
  const tar = zlib.gunzipSync(gzBuf);
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeOct = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOct || '0', 8) || 0;
    const typeFlag = header[156];
    off += 512;
    const base = path.posix.basename(rawName);
    if ((typeFlag === 0 || typeFlag === 48) && base === targetName && size > 0) {
      return tar.subarray(off, off + size);
    }
    off += Math.ceil(size / 512) * 512;
  }
  throw new Error(`${targetName} was not found in archive`);
}

function verifyBinary(binPath) {
  return new Promise((resolve, reject) => {
    execFile(binPath, ['-v'], { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return reject(new Error('binary missing'));
      if (err && err.killed) return reject(new Error('wireproxy timed out'));
      const out = String(stdout || stderr || '').trim();
      if (err && !out) return reject(new Error(err.message));
      resolve(out || 'ok');
    });
  });
}

async function ensureWireproxy(dataDir, vpnName = 'WireGuard') {
  const { asset, binName } = wireproxyAsset();
  const binDir = path.join(dataDir, 'bin');
  const binPath = path.join(binDir, binName);
  if (fs.existsSync(binPath)) {
    try { await verifyBinary(binPath); return binPath; } catch {}
  }
  if (!downloading) {
    downloading = (async () => {
      const expectedSha = WIREPROXY_SHA256[asset];
      if (!expectedSha) throw new Error(`No pinned SHA-256 for ${asset}`);
      const url = `https://github.com/whyvl/wireproxy/releases/download/${WIREPROXY_VERSION}/${asset}`;
      const res = await fetch(url, { headers: { 'user-agent': 'dispatch' }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${asset}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
      if (actualSha !== expectedSha) throw new Error(`SHA-256 mismatch for ${asset} (got ${actualSha})`);
      const binBuf = extractTarGzFile(buf, binName);
      fs.mkdirSync(binDir, { recursive: true });
      const tmp = binPath + '.tmp';
      fs.writeFileSync(tmp, binBuf);
      if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, binPath);
      await verifyBinary(binPath);
      return binPath;
    })().finally(() => { downloading = null; });
  }
  try {
    return await downloading;
  } catch (e) {
    throw new Error(`VPN ${vpnName} could not start: could not download wireproxy (${e.message})`);
  }
}

/** Parse a WireGuard .conf into redacted config (no private/preshared keys) + extracted secrets. */
function parseWireGuardConfig(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  let section = '';
  let hasInterface = false, hasPeer = false, hasPublicKey = false, hasEndpoint = false;
  let privateKey = '', presharedKey = '';
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      out.push(line);
      continue;
    }
    const sec = /^\[([^\]]+)\]$/.exec(trimmed);
    if (sec) {
      section = sec[1].trim().toLowerCase();
      if (section === 'interface') hasInterface = true;
      else if (section === 'peer') hasPeer = true;
      out.push(`[${sec[1].trim()}]`);
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) { out.push(line); continue; }
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    const kl = key.toLowerCase();

    if (section === 'interface') {
      if (kl === 'privatekey') { privateKey = val; continue; }
      if (WG_IGNORED_KEYS.has(kl)) continue;
    } else if (section === 'peer') {
      if (kl === 'presharedkey') { presharedKey = val; continue; }
      if (kl === 'publickey') hasPublicKey = !!val;
      if (kl === 'endpoint') hasEndpoint = !!val;
    }
    out.push(`${key} = ${val}`);
  }

  if (!hasInterface || !hasPeer) throw new Error('WireGuard config must have [Interface] and [Peer] sections');
  if (!hasPublicKey || !hasEndpoint) throw new Error('WireGuard [Peer] must include PublicKey and Endpoint');

  return {
    redactedConfig: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    secrets: { privateKey, presharedKey },
  };
}

/** Reassemble a wireproxy config with decrypted keys and [TCPClientTunnel] entries. */
function buildWireproxyConfig(redactedConfig, secrets, tunnels) {
  const lines = String(redactedConfig || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inInterface = false, inPeer = false, injectedPriv = false, injectedPsk = false;

  for (const line of lines) {
    const sec = /^\[([^\]]+)\]$/.exec(line.trim());
    if (sec) {
      inInterface = sec[1].trim().toLowerCase() === 'interface';
      inPeer = sec[1].trim().toLowerCase() === 'peer';
      out.push(line);
      if (inInterface && secrets.privateKey && !injectedPriv) {
        out.push(`PrivateKey = ${secrets.privateKey}`);
        injectedPriv = true;
      }
      if (inPeer && secrets.presharedKey && !injectedPsk) {
        out.push(`PresharedKey = ${secrets.presharedKey}`);
        injectedPsk = true;
      }
      continue;
    }
    out.push(line);
  }

  for (const t of tunnels) {
    out.push('', '[TCPClientTunnel]', `BindAddress = 127.0.0.1:${t.localPort}`, `Target = ${t.targetHost}:${t.targetPort}`);
  }
  return out.join('\n') + '\n';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function tcpProbe(host, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: Number(port) });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`Timed out connecting to ${host}:${port}`)); }, timeoutMs);
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error', err => { clearTimeout(timer); sock.destroy(); reject(err); });
  });
}

function stopVpn(id) {
  const entry = activeTunnels.get(id);
  if (!entry) return;
  activeTunnels.delete(id);
  clearTimeout(entry.idleTimer);
  try { entry.child.kill(); } catch {}
  try { if (entry.confPath && fs.existsSync(entry.confPath)) fs.unlinkSync(entry.confPath); } catch {}
}

function stopAll() {
  for (const id of [...activeTunnels.keys()]) stopVpn(id);
}

function bumpIdle(id) {
  const entry = activeTunnels.get(id);
  if (!entry) return;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => stopVpn(id), IDLE_MS);
  entry.idleTimer.unref?.();
}

async function ensureWireguardTunnel(vpn, secrets, targetHost, targetPort, dataDir, extraTargets = []) {
  if (!secrets.privateKey) throw new Error(`VPN ${vpn.name} could not start: WireGuard private key is missing`);
  const targetKey = `${targetHost}:${targetPort}`;
  const existing = activeTunnels.get(vpn.id);
  if (existing && !existing.child.killed && existing.child.exitCode === null && existing.tunnels.has(targetKey)) {
    bumpIdle(vpn.id);
    return { host: '127.0.0.1', port: existing.tunnels.get(targetKey) };
  }

  const binPath = await ensureWireproxy(dataDir, vpn.name);
  if (existing) stopVpn(vpn.id);

  // Deduplicate targets: include requested target + any servers already assigned to this VPN.
  const allTargets = [];
  const seen = new Set();
  for (const t of [{ targetHost, targetPort }, ...extraTargets]) {
    const k = `${t.targetHost}:${t.targetPort}`;
    if (!t.targetHost || !t.targetPort || seen.has(k)) continue;
    seen.add(k);
    allTargets.push({ targetHost: t.targetHost, targetPort: Number(t.targetPort), key: k });
  }

  const tunnelList = [];
  const tunnelMap = new Map();
  for (const t of allTargets) {
    const localPort = await getFreePort();
    tunnelList.push({ ...t, localPort });
    tunnelMap.set(t.key, localPort);
  }

  const runDir = path.join(dataDir, 'vpn-run');
  fs.mkdirSync(runDir, { recursive: true });
  const confPath = path.join(runDir, `wireproxy-${vpn.id}.conf`);
  const confText = buildWireproxyConfig(vpn.config, secrets, tunnelList);
  fs.writeFileSync(confPath, confText, { mode: 0o600 });

  const child = spawn(binPath, ['-c', confPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const addOut = d => { output = (output + d).slice(-2000); };
  child.stdout.on('data', addOut);
  child.stderr.on('data', addOut);

  const entry = { child, confPath, tunnels: tunnelMap, idleTimer: null };
  activeTunnels.set(vpn.id, entry);
  child.on('exit', () => {
    if (activeTunnels.get(vpn.id) === entry) stopVpn(vpn.id);
  });

  const primaryPort = tunnelMap.get(targetKey);
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      stopVpn(vpn.id);
      throw new Error(`VPN ${vpn.name} could not start: ${output.trim() || `wireproxy exited (${child.exitCode})`}`);
    }
    try {
      await tcpProbe('127.0.0.1', primaryPort, 300);
      bumpIdle(vpn.id);
      return { host: '127.0.0.1', port: primaryPort };
    } catch {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  stopVpn(vpn.id);
  throw new Error(`VPN ${vpn.name} could not start: ${output.trim() || 'tunnel did not listen in time'}`);
}

/** Create a VPN store backed by vpns.json and safeStorage vault. */
function create(file, vault, { dataDir = path.dirname(file) } = {}) {
  const read = () => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = list => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)); return list; };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);

  function openSecrets(v) {
    if (!v?.secret || !vault) return {};
    try {
      const raw = vault.open(v.secret);
      if (v.type === 'wireguard') {
        try { return JSON.parse(raw); } catch { return { privateKey: raw, presharedKey: '' }; }
      }
      return { password: raw };
    } catch {
      return {};
    }
  }

  function clean(v, old = null) {
    const id = str(v.id, 40) || crypto.randomUUID();
    const name = str(v.name, 40);
    const type = VPN_TYPES.includes(v.type) ? v.type : '';
    if (!name) throw new Error('Give the VPN a name');
    if (!type) throw new Error('Choose a VPN type');

    if (type === 'wireguard') {
      const parsed = parseWireGuardConfig(v.config);
      const oldSec = old?.type === 'wireguard' ? openSecrets(old) : {};
      const privateKey = parsed.secrets.privateKey || (v.clearKey ? '' : oldSec.privateKey || '');
      const presharedKey = parsed.secrets.presharedKey || (v.clearKey ? '' : oldSec.presharedKey || '');
      if (!privateKey) throw new Error('WireGuard config must include PrivateKey');
      const secret = vault.seal(JSON.stringify({ privateKey, presharedKey }));
      return { id, name, type, config: parsed.redactedConfig, secret };
    }

    if (type === 'proxy') {
      const protocol = PROXY_PROTOCOLS.includes(v.protocol) ? v.protocol : 'socks5';
      const host = str(v.host, 255);
      const port = Number(v.port) || 0;
      const user = str(v.user, 64);
      if (!host || SHELL_BAD.test(host)) throw new Error('Enter a valid proxy host');
      if (port < 1 || port > 65535) throw new Error('Proxy port must be 1-65535');
      const secret = typeof v.password === 'string'
        ? (v.password ? vault.seal(v.password) : '')
        : (old?.type === 'proxy' ? old.secret || '' : '');
      return { id, name, type, protocol, host, port, user, secret };
    }

    // SSH jump host
    const host = str(v.host, 255);
    const port = Number(v.port) || 22;
    const user = str(v.user, 64);
    if (!host || SHELL_BAD.test(host) || host.includes('@') || host.startsWith('-')) throw new Error('Enter a valid jump host');
    if (user && (/[\s'"`;|&$<>@]/.test(user) || user.startsWith('-'))) throw new Error('Enter a valid jump user name');
    if (port < 1 || port > 65535) throw new Error('Jump port must be 1-65535');
    return { id, name, type, host, port, user, secret: '' };
  }

  function sanitize(v) {
    const { secret, ...rest } = v;
    if (v.type === 'wireguard') return { ...rest, hasKey: !!secret };
    if (v.type === 'proxy') return { ...rest, hasPassword: !!secret };
    return rest;
  }

  return {
    list: () => read().map(sanitize),
    get: id => read().find(v => v.id === id),
    save(v) {
      const list = read();
      const old = list.find(x => x.id === v.id) || null;
      const item = clean(v, old);
      const i = list.findIndex(x => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      write(list);
      stopVpn(item.id);
      return sanitize(item);
    },
    remove(id) {
      stopVpn(id);
      return write(read().filter(v => v.id !== id)).map(sanitize);
    },
    openSecrets,
    async prepareForServer(server, allServers = []) {
      if (!server?.vpnId) return { vpn: null, tunnel: null, env: null, proxyScript: '' };
      const vpn = read().find(v => v.id === server.vpnId);
      if (!vpn) throw new Error(`VPN could not start: assigned VPN was not found`);
      if (vpn.type === 'wireguard') {
        const secrets = openSecrets(vpn);
        const extra = allServers
          .filter(x => x.vpnId === vpn.id)
          .map(x => ({ targetHost: x.host, targetPort: x.port || 22 }));
        const tunnel = await ensureWireguardTunnel(vpn, secrets, server.host, server.port || 22, dataDir, extra);
        return { vpn: sanitize(vpn), tunnel, env: null, proxyScript: '' };
      }
      if (vpn.type === 'proxy') {
        const { password = '' } = openSecrets(vpn);
        return {
          vpn: sanitize(vpn),
          tunnel: null,
          proxyScript: path.join(__dirname, 'proxy-tunnel.cjs'),
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            DISPATCH_PROXY_TYPE: vpn.protocol,
            DISPATCH_PROXY_HOST: vpn.host,
            DISPATCH_PROXY_PORT: String(vpn.port),
            DISPATCH_PROXY_USER: vpn.user || '',
            DISPATCH_PROXY_PASS: password,
          },
        };
      }
      return { vpn: sanitize(vpn), tunnel: null, env: null, proxyScript: '' };
    },
    async test(vInput, targetHost = '', targetPort = 22, allServers = []) {
      const old = vInput.id ? read().find(x => x.id === vInput.id) || null : null;
      const item = clean(vInput, old);
      const tHost = String(targetHost || '').trim();
      const tPort = Number(targetPort) || 22;

      if (item.type === 'wireguard') {
        const secrets = openSecrets(item);
        const firstServer = allServers.find(x => x.vpnId === item.id);
        const probeHost = tHost || firstServer?.host || '';
        const probePort = tHost ? tPort : (firstServer?.port || 22);
        if (!probeHost) {
          // No target host yet: still download/verify wireproxy and start the tunnel to verify config.
          const dummyPort = await getFreePort();
          const tempVpn = { ...item, id: `test-${item.id}` };
          try {
            await ensureWireguardTunnel(tempVpn, secrets, '127.0.0.1', dummyPort, dataDir);
          } finally {
            stopVpn(tempVpn.id);
          }
          return { ok: true, output: 'wireproxy started. Enter a target host:port to test TCP connectivity through the tunnel.' };
        }
        const tempVpn = { ...item, id: `test-${item.id}` };
        try {
          const tunnel = await ensureWireguardTunnel(tempVpn, secrets, probeHost, probePort, dataDir);
          await tcpProbe(tunnel.host, tunnel.port, 5000);
          return { ok: true, output: `Connected to ${probeHost}:${probePort} via WireGuard` };
        } finally {
          stopVpn(tempVpn.id);
        }
      }

      if (item.type === 'proxy') {
        const { password = '' } = openSecrets(item);
        if (tHost) {
          const { sock } = await connectViaProxy({
            type: item.protocol,
            host: item.host,
            port: item.port,
            user: item.user || '',
            pass: password,
            targetHost: tHost,
            targetPort: tPort,
            timeoutMs: 6000,
          });
          sock.destroy();
          return { ok: true, output: `Connected to ${tHost}:${tPort} via ${item.protocol.toUpperCase()} proxy` };
        }
        await tcpProbe(item.host, item.port, 5000);
        return { ok: true, output: `Proxy ${item.host}:${item.port} is reachable` };
      }

      await tcpProbe(item.host, item.port, 5000);
      return { ok: true, output: `SSH jump host ${item.host}:${item.port} is reachable` };
    },
  };
}

module.exports = {
  create,
  stopVpn,
  stopAll,
  ensureWireproxy,
  wireproxyAsset,
  extractTarGzFile,
  parseWireGuardConfig,
  buildWireproxyConfig,
  WIREPROXY_VERSION,
  WIREPROXY_SHA256,
  VPN_TYPES,
  PROXY_PROTOCOLS,
};
