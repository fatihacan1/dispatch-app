const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-pack-'));
process.env.DISPATCH_HOME = path.join(root, 'home');
const zip = require('./zip.cjs');
const pack = require('./pack.cjs');
const skillsLib = require('./skills.cjs');

const w = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); };
const globalDir = path.join(root, 'home', '.dispatch'), claudeHome = path.join(root, 'home', '.claude');

test('zip round trip and unsafe names', () => {
  const big = 'x'.repeat(5000);
  const out = zip.read(zip.write([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: Buffer.from([0, 1, 2]) }, { name: 'c.txt', data: big }]));
  assert.deepStrictEqual(out.map(e => e.name), ['a.txt', 'dir/b.bin', 'c.txt']);
  assert.strictEqual(out[2].data.toString(), big);
  assert.throws(() => zip.read(zip.write([{ name: '../evil.txt', data: 'x' }])), /unsafe/);
  assert.throws(() => zip.read(Buffer.from('not a zip')), /not a Dispatch pack/);
});

test('export a trained workspace and import it into a new folder', async () => {
  const src = path.join(root, 'src');
  w(path.join(src, '.dispatch', 'agents', 'editor.md'), '---\nname: editor\ndescription: Cuts videos\nprovider: claude\n---\nEdit the daily video.\n');
  w(path.join(src, '.dispatch', 'teams', 'studio.json'), JSON.stringify({ name: 'studio', description: 'Daily videos', boss: { template: 'boss' }, members: [{ name: 'ed', template: 'editor' }] }));
  w(path.join(src, '.dispatch', 'memory', 'project.jsonl'), [JSON.stringify({ type: 'entity', name: 'Format', entityType: 'convention', observations: ['16:9, 8 minutes'], summary: 'Video format' }), JSON.stringify({ type: 'relation', from: 'Format', to: 'Format', relationType: 'is' })].join('\n') + '\n');
  w(path.join(globalDir, 'memory', 'global.jsonl'), JSON.stringify({ type: 'entity', name: 'Me', entityType: 'person', observations: ['private'] }) + '\n');
  w(path.join(src, '.dispatch', 'boss-providers.json'), '{"claude":true}');
  const store = skillsLib.create({ globalDir, projectDir: path.join(src, '.dispatch') });
  store.ensurePlugin('project');
  w(path.join(src, '.dispatch', 'skills', 'skills', 'thumbs', 'SKILL.md'), '---\nname: thumbs\ndescription: Make thumbnails\n---\nSteps');
  w(path.join(src, '.dispatch', 'skills', 'skills', 'thumbs', 'run.py'), 'print(1)');

  const inv = pack.inventory({ workspace: src, globalDir, claudeHome });
  assert.strictEqual(inv.memory.project.entities, 1);
  assert.strictEqual(inv.memory.global.entities, 1);
  const thumbs = inv.skills.find(s => s.name === 'thumbs');
  assert.strictEqual(thumbs.scripts, 1);
  const { buffer, manifest } = pack.build({ workspace: src, globalDir, claudeHome, meta: { name: 'Video studio', author: 'A friend' }, selection: { agents: inv.agents.map(a => a.id), teams: inv.teams.map(t => t.id), skills: [thumbs.id], memory: ['project'], settings: true } });
  assert.strictEqual(manifest.kind, 'workspace');
  assert.ok(!zip.read(buffer).some(e => e.name.startsWith('memory/global')), 'global memory stays out unless chosen');

  const dest = path.join(root, 'dest');
  fs.mkdirSync(dest);
  const opened = pack.open(buffer);
  const desc = pack.describe(opened, { workspace: dest, globalDir });
  assert.strictEqual(desc.agents[0].exists, false);
  assert.ok(desc.warnings.some(x => /scripts/.test(x)));
  const r = await pack.apply(opened, { workspace: dest, globalDir, choice: { settings: true } });
  assert.deepStrictEqual([r.agents, r.teams, r.skills, r.settings], [1, 1, 1, 1]);
  assert.ok(fs.existsSync(path.join(dest, '.dispatch', 'agents', 'editor.md')));
  assert.ok(fs.existsSync(path.join(dest, '.dispatch', 'skills', 'skills', 'thumbs', 'run.py')));
  assert.ok(fs.existsSync(path.join(dest, '.dispatch', 'skills', '.claude-plugin', 'plugin.json')));
  assert.match(fs.readFileSync(path.join(dest, '.dispatch', 'memory', 'project.jsonl'), 'utf8'), /16:9/);

  // Importing again skips what exists, unless replace is on; memory merges without duplicates.
  const again = await pack.apply(pack.open(buffer), { workspace: dest, globalDir, choice: {} });
  assert.strictEqual(again.agents, 0); assert.ok(again.skipped.includes('agent editor'));
  const lines = fs.readFileSync(path.join(dest, '.dispatch', 'memory', 'project.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  const replaced = await pack.apply(pack.open(buffer), { workspace: dest, globalDir, choice: { replace: true } });
  assert.strictEqual(replaced.agents, 1);
});

test('memory merge unions observations', async () => {
  const f = path.join(root, 'm', 'project.jsonl');
  w(f, JSON.stringify({ type: 'entity', name: 'A', entityType: 't', observations: ['one'], pinned: true }) + '\nnot json\n');
  const r = await pack.mergeMemory(f, [JSON.stringify({ type: 'entity', name: 'A', entityType: 't', observations: ['one', 'two'] }), JSON.stringify({ type: 'entity', name: 'B', entityType: 't', observations: [] })].join('\n'));
  assert.deepStrictEqual(r, { added: 1, merged: 1 });
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /"one","two"/); assert.match(text, /not json/); assert.match(text, /"pinned":true/);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
