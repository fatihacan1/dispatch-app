const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create, shared } = require('./connectors.cjs');

// A fake remote MCP server with OAuth 2.1 + dynamic client registration. Access tokens can be expired on demand.
function fakeServer() {
  const st = { valid: new Set(), refreshes: 0, registered: 0, sessions: 0 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, base());
    const json = (code, v, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(v)); };
    const body = () => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
    if (u.pathname === '/.well-known/oauth-protected-resource/mcp') return json(200, { resource: base() + '/mcp', authorization_servers: [base()] });
    if (u.pathname === '/.well-known/oauth-authorization-server') return json(200, { issuer: base(), authorization_endpoint: base() + '/authorize', token_endpoint: base() + '/token', registration_endpoint: base() + '/register', code_challenge_methods_supported: ['S256'] });
    if (u.pathname === '/register') return body().then(b => { st.registered++; const r = JSON.parse(b); json(201, { client_id: 'c' + st.registered, redirect_uris: r.redirect_uris }); });
    if (u.pathname === '/authorize') { const to = new URL(u.searchParams.get('redirect_uri')); to.searchParams.set('code', 'code1'); to.searchParams.set('state', u.searchParams.get('state')); res.writeHead(302, { location: to.toString() }); return res.end(); }
    if (u.pathname === '/token') return body().then(b => {
      const p = new URLSearchParams(b);
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'code1' && p.get('code_verifier')) { st.valid.add('a1'); return json(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }); }
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'r1') { st.refreshes++; const t = 'a' + (st.refreshes + 1); st.valid.add(t); return json(200, { access_token: t, expires_in: 3600 }); }
      json(400, { error: 'invalid_grant' });
    });
    if (u.pathname === '/mcp') return body().then(b => {
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      if (!st.valid.has(tok)) return json(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${base()}/.well-known/oauth-protected-resource/mcp"` });
      const m = JSON.parse(b);
      if (m.method === 'initialize') { st.sessions++; return json(200, { jsonrpc: '2.0', id: m.id, result: { serverInfo: { name: 'fake' } } }, { 'mcp-session-id': 's1' }); }
      if (!m.id) { res.writeHead(202); return res.end(); }
      // tools/list answers as SSE, like many real servers.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'a' }, { name: 'b' }] } })}\n\n`);
    });
    res.writeHead(404); res.end();
  });
  const base = () => `http://127.0.0.1:${srv.address().port}`;
  return { st, srv, base, ready: new Promise(r => srv.listen(0, '127.0.0.1', r)) };
}
const vault = { seal: s => Buffer.from(s).toString('base64'), open: s => Buffer.from(s, 'base64').toString() };

test('browser sign-in, tool count, proxy with token refresh, log out', async () => {
  const f = fakeServer(); await f.ready;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conn-')), 'connectors.json');
  // "Open the browser": follow the authorize redirect to Dispatch's loopback callback.
  const hub = create({ file, vault, open: url => { fetch(url).catch(() => {}); } });
  await hub.ready;
  const c = await hub.connect({ name: 'Fake', url: f.base() + '/mcp' });
  assert.equal(c.status, 'connected');
  assert.equal(c.auth, 'oauth');
  assert.equal(c.tools, 2);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('"a1"'), 'tokens are sealed, not stored in plain text');

  const [agent] = hub.forAgents();
  assert.match(agent.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/custom_fake$/);
  const call = () => fetch(agent.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }) });
  let r = await call();
  assert.equal(r.status, 200);
  assert.match(await r.text(), /"tools"/);

  // The provider revokes the access token: the proxy refreshes and retries without the agent noticing.
  f.st.valid.clear();
  r = await call();
  assert.equal(r.status, 200);
  assert.equal(f.st.refreshes, 1);

  // A wrong secret in the path is refused.
  assert.equal((await fetch(agent.url.replace(/\/[0-9a-f]{32}\//, '/' + '0'.repeat(32) + '/'), { method: 'POST' })).status, 404);

  hub.remove(c.id);
  assert.equal(hub.list().length, 0);
  assert.equal(hub.forAgents().length, 0);
  hub.close(); f.srv.close();
});

test('an expired sign-in is reported, never answered with 401', async () => {
  const f = fakeServer(); await f.ready;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conn-')), 'connectors.json');
  const hub = create({ file, vault, open: url => { fetch(url).catch(() => {}); } });
  await hub.ready;
  await hub.connect({ name: 'Fake', url: f.base() + '/mcp' });
  const [agent] = hub.forAgents();
  f.st.valid.clear();
  const d = JSON.parse(fs.readFileSync(file, 'utf8')); const s = JSON.parse(vault.open(d.connections.custom_fake.secret)); s.refresh_token = 'gone'; d.connections.custom_fake.secret = vault.seal(JSON.stringify(s)); fs.writeFileSync(file, JSON.stringify(d));
  const r = await fetch(agent.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error.message, /reconnect/);
  assert.equal(hub.list()[0].status, 'expired');
  assert.equal(hub.forAgents().length, 0, 'agents do not get a dead connection');
  hub.close(); f.srv.close();
});

test('catalog entries are well formed', () => {
  const { CATALOG, GROUPS } = require('./connectors.cjs');
  const ids = new Set();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), c.id); ids.add(c.id);
    assert.ok(GROUPS.some(g => g.id === c.group), c.id);
    assert.ok(c.auth === 'local' ? c.command : /^https?:\/\//.test(c.url), c.id);
  }
});

// A server like most real ones: refresh tokens work once, using one a second time ends the sign-in. `down`: token endpoint fails.
function rotating() {
  const st = { refresh: 'r1', access: 'a1', n: 1, refreshes: 0, reused: 0, down: '' };
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const d of req) chunks.push(d); const body = Buffer.concat(chunks).toString();
    const json = (code, v, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(v)); };
    if (req.url === '/token') {
      await new Promise(r => setTimeout(r, 120));
      if (st.down === 'html') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<html>Just a moment...</html>'); }
      if (st.down) return json(503, { error: 'temporarily_unavailable' });
      const p = new URLSearchParams(body);
      if (p.get('refresh_token') !== st.refresh) { st.reused++; return json(400, { error: 'invalid_grant' }); }
      st.n++; st.refreshes++; st.refresh = 'r' + st.n; st.access = 'a' + st.n;
      return json(200, { access_token: st.access, refresh_token: st.refresh, expires_in: 3600 });
    }
    if ((req.headers.authorization || '') !== 'Bearer ' + st.access) return json(401, { error: 'invalid_token' });
    const m = JSON.parse(body); if (!m.id) { res.writeHead(202); return res.end(); }
    json(200, { jsonrpc: '2.0', id: m.id, result: m.method === 'initialize' ? { serverInfo: { name: 'rot' } } : { tools: [{ name: 'a' }] } });
  });
  return { st, srv, ready: new Promise(r => srv.listen(0, '127.0.0.1', r)), base: () => `http://127.0.0.1:${srv.address().port}` };
}
async function rotSetup(t, secret = {}) {
  const f = rotating(); await f.ready;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conn-')), 'connectors.json');
  fs.writeFileSync(file, JSON.stringify({ connections: { rot: { id: 'rot', name: 'Rot', url: f.base() + '/mcp', auth: 'oauth', status: 'connected', addedAt: Date.now(), secret: vault.seal(JSON.stringify({ client_id: 'c', token_endpoint: f.base() + '/token', access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() + 3600e3, refreshed_at: Date.now(), ...secret })) } } }));
  const status = () => JSON.parse(fs.readFileSync(file, 'utf8')).connections.rot.status;
  const call = hub => fetch(hub.forAgents()[0].url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  t.after(() => f.srv.close());
  return { ...f, file, status, call };
}
test('two project tabs and many calls at once renew a one-time refresh token once, and stay connected', async t => {
  const r = await rotSetup(t, { access_token: 'old', expires_at: Date.now() - 1000 });
  const one = shared({ file: r.file, vault, open() {} }), two = shared({ file: r.file, vault, open() {} }); await one.ready;
  const answers = await Promise.all([r.call(one), r.call(two), r.call(one), r.call(two), one.check('rot'), two.token('rot')]);
  for (const a of answers.slice(0, 4)) assert.equal(a.status, 200);
  assert.equal(r.st.refreshes, 1); assert.equal(r.st.reused, 0); assert.equal(r.status(), 'connected');
  // The server ends the token early: again one renewal for all.
  r.st.access = 'revoked-early';
  const more = await Promise.all([r.call(one), r.call(two), r.call(one)]);
  for (const a of more) assert.equal(a.status, 200);
  assert.equal(r.st.refreshes, 2); assert.equal(r.st.reused, 0);
});
test('a second Dispatch that renewed first does not drop the connection', async t => {
  const r = await rotSetup(t, { access_token: 'old', expires_at: Date.now() - 1000 });
  const a = create({ file: r.file, vault, open() {} }), b = create({ file: r.file, vault, open() {} }); await a.ready; await b.ready;
  const [x, y] = await Promise.all([r.call(a), r.call(b)]);
  assert.equal(x.status, 200); assert.equal(y.status, 200); assert.equal(r.status(), 'connected'); assert.equal(r.st.refreshes, 1);
  a.close(); b.close();
});
test('no network, a server error or a bot check is not an expired sign-in', async t => {
  const r = await rotSetup(t, { access_token: 'old', expires_at: Date.now() - 1000 });
  const hub = create({ file: r.file, vault, open() {} }); await hub.ready;
  for (const how of ['503', 'html']) { r.st.down = how; const x = await r.call(hub); assert.equal(x.status, 502); assert.equal(r.status(), 'connected'); assert.equal(hub.forAgents().length, 1); }
  r.st.down = ''; assert.equal((await r.call(hub)).status, 200); assert.equal(r.status(), 'connected');
  hub.close();
});
test('tokens are renewed ahead of time without any agent, and a wrongly expired one comes back', async t => {
  const r = await rotSetup(t, { expires_at: Date.now() + 5 * 60000 });
  const hub = create({ file: r.file, vault, open() {} }); await hub.ready;
  await hub.keepAlive(); assert.equal(r.st.refreshes, 1);
  await hub.keepAlive(); assert.equal(r.st.refreshes, 1, 'not again while it is fresh');
  const d = JSON.parse(fs.readFileSync(r.file, 'utf8')); d.connections.rot.status = 'expired'; fs.writeFileSync(r.file, JSON.stringify(d));
  const hub2 = create({ file: r.file, vault, open() {} }); await hub2.ready; await hub2.keepAlive();
  assert.equal(r.status(), 'connected');
  // Idle for a day: renewed so the refresh token is not dropped.
  const d2 = JSON.parse(fs.readFileSync(r.file, 'utf8')), s = JSON.parse(vault.open(d2.connections.rot.secret)); s.refreshed_at = Date.now() - 25 * 3600e3; d2.connections.rot.secret = vault.seal(JSON.stringify(s)); fs.writeFileSync(r.file, JSON.stringify(d2));
  const n = r.st.refreshes; await hub.keepAlive(); assert.equal(r.st.refreshes, n + 1);
  hub.close(); hub2.close();
});
