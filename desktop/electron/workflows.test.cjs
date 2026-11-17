const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workflows = require('./workflows.cjs');
const templates = require('./templates.cjs');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
  const home = path.join(root, 'home'); const ws = path.join(root, 'ws');
  fs.mkdirSync(home); fs.mkdirSync(ws);
  process.env.DISPATCH_HOME = home;
  return { root, home, ws };
}

test('steps round-trip through the numbered list', () => {
  const steps = [{ template: 'reviewer', instruction: 'Review the diff' }, { template: '', instruction: 'Do it\nsecond line' }];
  const body = workflows.serializeSteps(steps, 'Intro text');
  assert.match(body, /^Intro text\n\n1\. \[reviewer\] Review the diff\n2\. Do it\n   second line$/);
  const parsed = workflows.parseSteps(body);
  assert.deepStrictEqual(parsed.steps, steps);
  assert.strictEqual(parsed.notes, 'Intro text');
});

test('hand-edited files parse', () => {
  const parsed = workflows.parseSteps('1. [tester] Run tests\n\n2) Publish\n');
  assert.deepStrictEqual(parsed.steps, [{ template: 'tester', instruction: 'Run tests' }, { template: '', instruction: 'Publish' }]);
});

test('save, list, rename and delete in both scopes', () => {
  const { ws, home } = sandbox();
  const f = workflows.save(ws, { name: 'Release', description: 'Ship it: carefully', scope: 'project', steps: [{ template: 'reviewer', instruction: 'Review' }] });
  assert.strictEqual(f, path.join(ws, '.dispatch', 'workflows', 'release.md'));
  const g = workflows.save(ws, { name: 'Daily', scope: 'global', steps: [{ template: '', instruction: 'Check inbox' }] });
  assert.ok(g.startsWith(path.join(home, '.dispatch', 'workflows')));
  const all = workflows.list(ws);
  assert.deepStrictEqual(all.map(w => [w.name, w.scope]).sort(), [['Daily', 'global'], ['Release', 'project']]);
  assert.strictEqual(all.find(w => w.name === 'Release').description, 'Ship it: carefully');
  const r = all.find(w => w.name === 'Release');
  workflows.save(ws, { ...r, name: 'Ship' });
  assert.ok(!fs.existsSync(f));
  assert.throws(() => workflows.save(ws, { name: 'Daily', scope: 'global', steps: [] }), /already exists/);
  workflows.remove(g);
  assert.strictEqual(workflows.list(ws).length, 1);
  assert.throws(() => workflows.remove(path.join(ws, 'x.md')), /Not a workflow/);
});

test('templates keep working and mount workflows', () => {
  const t = templates.parse('---\nname: dev\ndescription: d\nprovider: claude\nworkflows: Release, Daily\n---\n\nrole\n');
  assert.strictEqual(t.meta.workflows, 'Release, Daily');
  const out = templates.serialize({ name: 'dev', description: 'd', provider: 'claude', extra: t.meta, body: t.body });
  assert.match(out, /workflows: Release, Daily/);
  const all = [{ name: 'Release', description: 'Ship', steps: [{ template: 'tester', instruction: 'Run tests' }], notes: '' }, { name: 'Other', description: '', steps: [], notes: '' }];
  const p = workflows.promptFor({ extra: t.meta }, all);
  assert.match(p, /## Workflows you follow/);
  assert.match(p, /### Release - Ship\n1\. \[tester\] Run tests/);
  assert.ok(!p.includes('Other'));
  assert.strictEqual(workflows.promptFor({ extra: {} }, all), '');
  assert.match(workflows.catalogueFor(all), /### Other/);
  assert.strictEqual(workflows.catalogueFor([]), '');
});
