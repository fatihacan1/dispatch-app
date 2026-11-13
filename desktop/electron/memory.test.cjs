const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { create } = require('./memory.cjs');
const { KnowledgeGraphManager } = require('./memory-graph.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-mem-'));
const make = root => create({ globalDir: path.join(root, 'home'), projectDir: path.join(root, 'ws', '.dispatch'), log: path.join(root, 'ws', '.dispatch', 'memory-log.jsonl') });

test('graph keeps upstream semantics and Dispatch fields', async () => {
  const root = tmp();
  try {
    const file = path.join(root, 'm.jsonl');
    fs.writeFileSync(file, 'not json\n{"type":"entity","name":"old","entityType":"x","observations":["a"],"createdBy":"other"}\n');
    const g = new KnowledgeGraphManager(file);
    assert.deepEqual(await g.createEntities([{ name: 'old', entityType: 'x', observations: [] }, { name: 'pnpm', entityType: 'decision', summary: 'Use pnpm', observations: ['use pnpm', 'use pnpm'] }]), ['pnpm']);
    await g.addObservations([{ entityName: 'pnpm', contents: ['because of workspaces', 'use pnpm'] }]);
    await g.createRelations([{ from: 'pnpm', to: 'old', relationType: 'replaces' }, { from: 'pnpm', to: 'old', relationType: 'replaces' }]);
    await assert.rejects(g.createRelations([{ from: 'pnpm', to: 'nope', relationType: 'x' }]), /nope not found/);
    await g.updateEntity('pnpm', { pinned: true });
    const raw = fs.readFileSync(file, 'utf8');
    assert.match(raw, /not json/, 'unreadable line kept');
    assert.match(raw, /"createdBy":"other"/, 'unknown field kept');
    const graph = await g.readGraph();
    const p = graph.entities.find(e => e.name === 'pnpm');
    assert.deepEqual(p.observations, ['use pnpm', 'because of workspaces']);
    assert.equal(p.summary, 'Use pnpm'); assert.equal(p.pinned, true); assert.ok(p.updatedAt);
    assert.equal(graph.relations.length, 1);
    await Promise.all([1, 2, 3, 4, 5].map(i => g.addObservations([{ entityName: 'old', contents: [`fact ${i}`] }])));
    assert.equal((await g.readGraph()).entities.find(e => e.name === 'old').observations.length, 6, 'concurrent writes are serialized');
    assert.deepEqual(await g.deleteEntities(['old', 'ghost']), { deleted: ['old'], notFound: ['ghost'] });
    assert.equal((await g.readGraph()).relations.length, 0, 'relations of deleted entities go too');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scopes, settings, tiered reads and budget', async () => {
  const root = tmp();
  try {
    const m = make(root);
    await m.writable('project').createEntities([
      { name: 'build-system', entityType: 'decision', summary: 'pnpm workspaces, not npm', observations: ['Use pnpm for every install', 'npm broke the lockfile in March', 'CI runs pnpm -r test'] },
      { name: 'deploy', entityType: 'convention', summary: 'Deploy from main only', observations: ['Tags trigger the release workflow'] },
    ]);
    await m.writable('global').createEntities([{ name: 'user', entityType: 'user', summary: 'Answers in Turkish', observations: ['Prefers Turkish replies'], pinned: true }]);
    const hits = await m.search('pnpm lockfile');
    assert.equal(hits[0].name, 'build-system');
    assert.ok(hits[0].observations.length <= 3 && hits[0].observations.every(o => /pnpm|lockfile/i.test(o)), 'L1 returns only matching facts');
    const full = await m.open(['build-system']);
    assert.equal(full.entities[0].observations.length, 3, 'L2 returns everything');
    let o = m.overview();
    assert.match(o.text, /user \[user, global\] \(pinned\)/); assert.match(o.text, /Prefers Turkish replies/);
    assert.match(o.text, /build-system \[decision\]: pnpm workspaces/);
    assert.doesNotMatch(o.text, /npm broke the lockfile/, 'L0 has no unpinned facts');
    o = m.overview(30); assert.ok(o.shown < o.total); assert.match(o.text, /not listed; memory_search/);
    m.saveSettings({ includeGlobal: false });
    assert.deepEqual(m.active(), ['project']);
    await assert.rejects(async () => m.search('turkish', { scope: 'global' }), /turned off/);
    assert.equal((await m.search('turkish')).length, 0);
    m.saveSettings({ bossCanWrite: false });
    assert.throws(() => m.writable('project'), /read-only/);
    assert.equal(JSON.parse(fs.readFileSync(m.settingsFiles.project, 'utf8')).includeGlobal, false, 'project switches stored per workspace');
    assert.equal(JSON.parse(fs.readFileSync(m.settingsFiles.global, 'utf8')).bossCanWrite, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('MCP server speaks JSON-RPC and logs activity', async () => {
  const root = tmp();
  try {
    const env = { ...process.env, DISPATCH_MEMORY_GLOBAL_DIR: path.join(root, 'home'), DISPATCH_MEMORY_PROJECT_DIR: path.join(root, 'ws', '.dispatch'), DISPATCH_MEMORY_LOG: path.join(root, 'log.jsonl'), DISPATCH_AGENT: 'boss' };
    const child = spawn(process.execPath, [path.join(__dirname, 'mcp-memory.cjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = ''; const waiting = new Map();
    child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(msg.id)?.(msg); } });
    let id = 0; const call = (method, params) => new Promise(r => { const n = ++id; waiting.set(n, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
    const tool = async (name, args) => (await call('tools/call', { name, arguments: args })).result;
    assert.equal((await call('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'dispatch-memory');
    const names = (await call('tools/list')).result.tools.map(t => t.name);
    for (const n of ['memory_search', 'memory_open', 'create_entities', 'add_observations', 'delete_observations']) assert.ok(names.includes(n), n);
    await tool('create_entities', { entities: [{ name: 'tests', entityType: 'convention', summary: 'Run node --test', observations: ['Unit tests use node:test'] }] });
    const found = JSON.parse((await tool('memory_search', { query: 'node test' })).content[0].text);
    assert.equal(found[0].name, 'tests');
    const bad = await tool('memory_search', { query: 'x', scope: 'nowhere' });
    assert.equal(bad.isError, true);
    child.kill();
    const log = fs.readFileSync(env.DISPATCH_MEMORY_LOG, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(log.map(l => [l.tool, l.ok]), [['create_entities', true], ['memory_search', true], ['memory_search', false]]);
    assert.ok(log[1].tokens > 0 && log[1].by === 'boss');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
