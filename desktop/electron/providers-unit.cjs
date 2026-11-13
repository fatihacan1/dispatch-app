const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, parseAuth, parseModels } = require('./providers.cjs');
const p = id => PROVIDERS.find(x => x.id === id);
const result = (out, ok = true) => ({ out, ok });
test('Antigravity recorded model output signals authentication and yields IDs', () => {
  const r = result('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n');
  assert.equal(parseAuth(p('antigravity'), r).auth, 'signed-in');
  assert.deepEqual(parseModels('antigravity', r), ['gemini-3.8-flash-high', 'claude-sonnet-4-6']);
  assert.equal(parseAuth(p('antigravity'), result('network unavailable', false)).auth, 'unknown');
});
test('OpenCode database failure is repairable and credential counts are respected', () => {
  assert.equal(parseAuth(p('opencode'), result('Database is not empty and has no session table', false)).canRepair, true);
  assert.equal(parseAuth(p('opencode'), result('2 credentials')).auth, 'signed-in');
  assert.equal(parseAuth(p('opencode'), result('0 credentials')).auth, 'signed-out');
  assert.deepEqual(parseModels('opencode', result('anthropic/claude-sonnet\nopenai/gpt-5\n')), ['anthropic/claude-sonnet', 'openai/gpt-5']);
});
test('Qoder recorded status and empty model output and JSON model lists', () => {
  assert.equal(parseAuth(p('qoder'), result('{"logged_in":true,"version":"1.1.85"}')).auth, 'signed-in');
  assert.deepEqual(parseModels('qoder', result('Warning: no models available for your account.')), []);
  assert.deepEqual(parseModels('qoder', result('{"models":[{"id":"model-a"},"model-b"]}')), ['model-a', 'model-b']);
});

