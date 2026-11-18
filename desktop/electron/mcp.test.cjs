const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configure, selected } = require('./mcp.cjs');
const resolver = cmd => ({ file: `/bin/${cmd}`, args: [] });
test('each agent receives only selected Dispatch MCP servers', () => {
 const agent = { extra: { dispatch_mcp: 'rustxng' } }, other = { extra: { dispatch_mcp: 'ddgs' } };
 assert.deepEqual(selected(agent), ['rustxng']);
 const claude = configure('claude', agent, resolver);
 assert.deepEqual(JSON.parse(claude.args[1]).mcpServers, { dispatch_rustxng: { command: '/bin/rustxng', args: ['mcp'] } });
 const code = configure('codex', other, resolver);
 assert.match(code.args[1], /^mcp_servers\.dispatch_ddgs=/);
 assert.doesNotMatch(code.args[1], /rustxng/);
 const local = configure('local', other, resolver, JSON.stringify({ provider: { existing: {} } }));
 const config = JSON.parse(local.env.OPENCODE_CONFIG_CONTENT);
 assert.ok(config.provider.existing);
 assert.deepEqual(config.mcp.dispatch_ddgs.command, ['/bin/ddgs', 'mcp']);
});
test('missing tools and unsupported clients fail explicitly', () => {
 assert.throws(() => configure('claude', { extra: { dispatch_mcp: 'ddgs' } }, () => { throw Error('missing'); }), /DDGS MCP is not installed/);
 assert.throws(() => configure('qoder', { extra: { dispatch_mcp: 'ddgs' } }, resolver), /not yet supported/);
 assert.throws(() => selected({ extra: { dispatch_mcp: 'unexpected' } }), /Unknown Dispatch MCP/);
});
test('unreal is an HTTP server the editor runs, in each client format', () => {
 const t = { extra: { dispatch_mcp: 'unreal' } }, url = 'http://127.0.0.1:8000/mcp';
 assert.deepEqual(JSON.parse(configure('claude', t, resolver).args[1]).mcpServers, { dispatch_unreal: { type: 'http', url } });
 assert.equal(configure('codex', t, resolver).args[1], `mcp_servers.dispatch_unreal={url="${url}"}`);
 assert.deepEqual(JSON.parse(configure('opencode', t, resolver).env.OPENCODE_CONFIG_CONTENT).mcp.dispatch_unreal, { type: 'remote', url, enabled: true });
});
test('connected MCP apps reach every supported agent and are skipped elsewhere', () => {
 const connectors = [{ id: 'notion', name: 'Notion', url: 'http://127.0.0.1:5/x/notion' }, { id: 'playwright', name: 'Playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }];
 const claude = configure('claude', { extra: {} }, resolver, null, { connectors });
 assert.deepEqual(JSON.parse(claude.args[1]).mcpServers, { mcp_notion: { type: 'http', url: connectors[0].url }, mcp_playwright: { command: '/bin/npx', args: ['-y', '@playwright/mcp@latest'] } });
 assert.deepEqual(claude.connected, ['Notion', 'Playwright']);
 assert.ok(configure('codex', { extra: {} }, resolver, null, { connectors }).args.some(a => a.startsWith('mcp_servers.mcp_notion={url=')));
 const qoder = configure('qoder', { extra: {} }, resolver, null, { connectors });
 assert.deepEqual([qoder.args, qoder.connected], [[], []]);
 assert.deepEqual(configure('claude', { extra: {} }, () => { throw Error('no npx'); }, null, { connectors }).connected, ['Notion'], 'a missing npx drops only that app');
});
test('memory is boss-only and never comes from a template', () => {
 assert.throws(() => selected({ extra: { dispatch_mcp: 'memory' } }), /Unknown Dispatch MCP/);
 assert.ok(configure('claude', { extra: {} }, resolver, null, { memory: true }).ids.includes('memory'));
 assert.ok(!configure('claude', { extra: {} }, resolver).ids.includes('memory'));
 assert.deepEqual(configure('qoder', { extra: {} }, resolver, null, { memory: true }).ids, [], 'unsupported provider gets no memory and no error');
});
test('antigravity and gemini receive stdio, HTTP, and connected MCP servers', () => {
 const url = 'http://127.0.0.1:8000/mcp';
 const connectors = [{ id: 'canva', name: 'Canva', url: 'http://127.0.0.1:5/x/canva' }];
 const ag = configure('antigravity', { extra: { dispatch_mcp: 'rustxng,unreal' } }, resolver, null, { connectors, memory: true });
 assert.deepEqual(ag.antigravityConfig, {
  mcpServers: {
   dispatch_rustxng: { command: '/bin/rustxng', args: ['mcp'] },
   dispatch_unreal: { url },
   dispatch_memory: { command: process.execPath, args: [require('path').join(__dirname, 'mcp-memory.cjs')], env: { ELECTRON_RUN_AS_NODE: '1' } },
   mcp_canva: { url: connectors[0].url },
  },
 });
 assert.deepEqual(ag.connected, ['Canva']);
 assert.equal(configure('antigravity', { extra: {} }, resolver).antigravityConfig, null);

 const gem = configure('gemini', { extra: { dispatch_mcp: 'ddgs,unreal' } }, resolver, null, { connectors });
 assert.deepEqual(gem.geminiConfig, {
  mcpServers: {
   dispatch_ddgs: { command: '/bin/ddgs', args: ['mcp'] },
   dispatch_unreal: { httpUrl: url },
   mcp_canva: { httpUrl: connectors[0].url },
  },
 });
 assert.deepEqual(gem.connected, ['Canva']);
 assert.equal(configure('gemini', { extra: {} }, resolver).geminiConfig, null);
});
