const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('./connectors.cjs');

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
