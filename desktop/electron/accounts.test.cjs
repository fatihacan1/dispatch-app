const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const accounts = require('./accounts.cjs');

test('accounts: default account is always present and cannot be removed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-acc-'));
  const home = path.join(root, 'home');
  const globalDir = path.join(root, 'dispatch');
  const store = accounts.create(globalDir, { userHome: home });

  const claude = store.list('claude');
  assert.equal(claude.length, 1);
  assert.equal(claude[0].id, 'default');
  assert.equal(claude[0].label, 'Default');
  assert.equal(claude[0].active, true);
  assert.equal(claude[0].dir, path.join(home, '.claude'));
  assert.throws(() => store.remove('claude', 'default'), /Default account cannot be removed/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('accounts: add seeds settings and skills without copying credentials, respects max 10', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-acc-'));
  const home = path.join(root, 'home');
  const globalDir = path.join(root, 'dispatch');
  const defClaude = path.join(home, '.claude');
  fs.mkdirSync(path.join(defClaude, 'skills', 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(defClaude, 'settings.json'), '{"theme":"dark"}');
  fs.writeFileSync(path.join(defClaude, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"secret"}}');
  fs.writeFileSync(path.join(defClaude, 'skills', 'my-skill', 'SKILL.md'), '# My skill');

  const store = accounts.create(globalDir, { userHome: home });
  const added = store.add('claude', 'Work');
  assert.equal(added.label, 'Work');
  assert.equal(added.active, true);
  assert.equal(fs.existsSync(path.join(added.dir, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(added.dir, 'skills', 'my-skill', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(added.dir, '.credentials.json')), false);

  assert.deepEqual(accounts.envFor('claude', added), { CLAUDE_CONFIG_DIR: added.dir });
  assert.deepEqual(accounts.envFor('claude', store.get('claude', 'default')), {});

  // Fill up to 10 accounts
  for (let i = 3; i <= 10; i++) store.add('claude', `Acc ${i}`);
  assert.equal(store.list('claude').length, 10);
  assert.throws(() => store.add('claude', 'Acc 11'), /Maximum of 10/);

  // Rename and remove
  store.rename('claude', added.id, 'Work Pro');
  assert.equal(store.get('claude', added.id).label, 'Work Pro');
  store.activate('claude', added.id);
  assert.equal(store.active('claude').id, added.id);
  store.remove('claude', added.id);
  assert.equal(store.active('claude').id, 'default');
  assert.equal(fs.existsSync(added.dir), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('accounts: reads codex JWT email and plan cheaply', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-acc-'));
  const dir = path.join(root, 'codex');
  fs.mkdirSync(dir, { recursive: true });
  const payload = Buffer.from(JSON.stringify({
    email: 'user@example.com',
    'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' },
  })).toString('base64url');
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ tokens: { id_token: `hdr.${payload}.sig` } }));

  const meta = accounts.readAccountMeta('codex', dir);
  assert.equal(meta.email, 'user@example.com');
  assert.equal(meta.plan, 'plus');

  fs.rmSync(root, { recursive: true, force: true });
});

test('accounts: rejects antigravity multi-account add/activate and emits no env vars', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-acc-'));
  const store = accounts.create(path.join(root, 'dispatch'), { userHome: path.join(root, 'home') });
  assert.throws(() => store.add('antigravity', 'Second'), /does not support multiple accounts/);
  assert.throws(() => store.activate('antigravity', 'default'), /does not support multiple accounts/);
  assert.deepEqual(accounts.envFor('antigravity', { id: 'acc-1', dir: root }), {});
  fs.rmSync(root, { recursive: true, force: true });
});
