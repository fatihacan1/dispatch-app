const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const serversLib = require('./servers.cjs');
const vpnsLib = require('./vpns.cjs');

const fakeVault = {
  seal: text => 'sealed:' + Buffer.from(text, 'utf8').toString('base64'),
  open: s => Buffer.from(String(s).replace(/^sealed:/, ''), 'base64').toString('utf8'),
};

const baseServer = { id: 'srv-1', name: 'Prod', host: '10.20.30.40', port: 2222, user: 'deploy', key: '/tmp/id_ed25519', note: '', icon: '', access: 'on' };

test('sshArgs and scpArgs without VPN', () => {
  const ssh = serversLib.sshArgs(baseServer, { batch: true });
  assert.deepEqual(ssh.slice(0, 2), ['-p', '2222']);
  assert.ok(!ssh.includes('-J'));
  assert.ok(!ssh.some(a => a.includes('ProxyCommand') || a.includes('HostKeyAlias')));
  assert.equal(ssh[ssh.length - 1], 'deploy@10.20.30.40');

  const scp = serversLib.scpArgs(baseServer, false);
  assert.deepEqual(scp.slice(0, 2), ['-P', '2222']);
  assert.equal(serversLib.remoteSpec(baseServer, '/srv/app'), 'deploy@10.20.30.40:/srv/app');
});

test('sshArgs, scpArgs, and remoteSpec with WireGuard tunnel', () => {
  const vpnOpts = { vpn: { id: 'v1', name: 'WG', type: 'wireguard' }, tunnel: { host: '127.0.0.1', port: 45123 } };
  const ssh = serversLib.sshArgs(baseServer, { batch: true, ...vpnOpts });
  assert.deepEqual(ssh.slice(0, 4), ['-p', '45123', '-o', 'HostKeyAlias=10.20.30.40']);
  assert.equal(ssh[ssh.length - 1], 'deploy@127.0.0.1');

  const scp = serversLib.scpArgs(baseServer, true, vpnOpts);
  assert.deepEqual(scp.slice(0, 4), ['-P', '45123', '-o', 'HostKeyAlias=10.20.30.40']);
  assert.ok(scp.includes('NumberOfPasswordPrompts=1'));
  assert.equal(serversLib.remoteSpec(baseServer, '/tmp/f', vpnOpts), 'deploy@127.0.0.1:/tmp/f');
});

test('sshArgs and scpArgs with SOCKS5 / HTTP proxy VPN', () => {
  const vpnOpts = {
    vpn: { id: 'v2', name: 'Proxy', type: 'proxy', protocol: 'socks5', host: '127.0.0.1', port: 1080 },
    proxyScript: '/app/electron/proxy-tunnel.cjs',
    nodeExe: '/app/Dispatch.exe',
  };
  const ssh = serversLib.sshArgs(baseServer, vpnOpts);
  const pcIdx = ssh.indexOf('-o');
  assert.ok(pcIdx >= 0);
  assert.equal(ssh[pcIdx + 1], 'ProxyCommand="/app/Dispatch.exe" "/app/electron/proxy-tunnel.cjs" %h %p');
  assert.equal(ssh[ssh.length - 1], 'deploy@10.20.30.40');

  const scp = serversLib.scpArgs(baseServer, false, vpnOpts);
  assert.ok(scp.includes('ProxyCommand="/app/Dispatch.exe" "/app/electron/proxy-tunnel.cjs" %h %p'));
});

test('sshArgs and scpArgs with SSH jump host VPN', () => {
  const vpnOpts = { vpn: { id: 'v3', name: 'Bastion', type: 'jump', host: 'jump.example.com', port: 2200, user: 'bastion' } };
  const ssh = serversLib.sshArgs(baseServer, vpnOpts);
  const jIdx = ssh.indexOf('-J');
  assert.ok(jIdx >= 0);
  assert.equal(ssh[jIdx + 1], 'bastion@jump.example.com:2200');

  const scp = serversLib.scpArgs(baseServer, false, vpnOpts);
  assert.equal(scp[scp.indexOf('-J') + 1], 'bastion@jump.example.com:2200');

  const defaultPortJump = { vpn: { id: 'v4', name: 'SimpleJump', type: 'jump', host: 'jump2.example.com', port: 22, user: '' } };
  const ssh2 = serversLib.sshArgs(baseServer, defaultPortJump);
  assert.equal(ssh2[ssh2.indexOf('-J') + 1], 'jump2.example.com');
});

test('vpns store seals secrets, redacts WireGuard config, and clears server vpnId', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-vpn-test-'));
  try {
    const vpnStore = vpnsLib.create(path.join(dir, 'vpns.json'), fakeVault, { dataDir: dir });
    const srvStore = serversLib.create(path.join(dir, 'servers.json'), fakeVault);

    const wgConf = [
      '[Interface]',
      'PrivateKey = SUPER_SECRET_PRIVATE_KEY',
      'Address = 10.0.0.2/32',
      'PostUp = iptables -A FORWARD',
      '[Peer]',
      'PublicKey = PEER_PUB_KEY',
      'PresharedKey = SUPER_SECRET_PSK',
      'Endpoint = vpn.example.com:51820',
    ].join('\n');

    const savedWg = vpnStore.save({ name: 'Office', type: 'wireguard', config: wgConf });
    assert.equal(savedWg.hasKey, true);
    assert.ok(!savedWg.config.includes('SUPER_SECRET_PRIVATE_KEY'));
    assert.ok(!savedWg.config.includes('SUPER_SECRET_PSK'));
    assert.ok(!savedWg.config.includes('PostUp'));

    // Re-saving redacted config preserves the sealed keys.
    const resaved = vpnStore.save({ id: savedWg.id, name: 'Office 2', type: 'wireguard', config: savedWg.config });
    assert.equal(resaved.hasKey, true);
    const rawWg = vpnStore.get(savedWg.id);
    assert.deepEqual(vpnStore.openSecrets(rawWg), { privateKey: 'SUPER_SECRET_PRIVATE_KEY', presharedKey: 'SUPER_SECRET_PSK' });

    const built = vpnsLib.buildWireproxyConfig(rawWg.config, vpnStore.openSecrets(rawWg), [{ localPort: 50001, targetHost: '10.0.0.9', targetPort: 22 }]);
    assert.ok(built.includes('PrivateKey = SUPER_SECRET_PRIVATE_KEY'));
    assert.ok(built.includes('PresharedKey = SUPER_SECRET_PSK'));
    assert.ok(built.includes('[TCPClientTunnel]\nBindAddress = 127.0.0.1:50001\nTarget = 10.0.0.9:22'));

    const savedProxy = vpnStore.save({ name: 'Corp Proxy', type: 'proxy', protocol: 'http', host: 'proxy.local', port: 8080, user: 'alice', password: 'pw' });
    assert.equal(savedProxy.hasPassword, true);
    assert.equal(savedProxy.password, undefined);

    const srv = srvStore.save({ ...baseServer, vpnId: savedProxy.id });
    const prep = await vpnStore.prepareForServer(srv);
    assert.equal(prep.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(prep.env.DISPATCH_PROXY_TYPE, 'http');
    assert.equal(prep.env.DISPATCH_PROXY_PASS, 'pw');

    srvStore.clearVpn(savedProxy.id);
    assert.equal(srvStore.get(srv.id).vpnId, '');

    // Jump host validation rejects spaces, quotes, semicolons, @ in host, and leading '-'.
    assert.throws(() => vpnStore.save({ name: 'Bad1', type: 'jump', host: 'jump host' }), /valid jump host/);
    assert.throws(() => vpnStore.save({ name: 'Bad2', type: 'jump', host: 'jump;rm' }), /valid jump host/);
    assert.throws(() => vpnStore.save({ name: 'Bad3', type: 'jump', host: 'u@jump.com' }), /valid jump host/);
    assert.throws(() => vpnStore.save({ name: 'Bad4', type: 'jump', host: '-oProxyCommand=x' }), /valid jump host/);
    assert.throws(() => vpnStore.save({ name: 'Bad5', type: 'jump', host: 'jump.com', user: 'bad user' }), /valid jump user/);
    assert.throws(() => vpnStore.save({ name: 'Bad6', type: 'jump', host: 'jump.com', user: '-bad' }), /valid jump user/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
