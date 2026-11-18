const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PROVIDERS, filterClaudeModels, claudeBundleModels, allModels } = require('./providers.cjs');

test('filterClaudeModels keeps current 5.x+ families and drops dated, -v1, and pre-5 ids', () => {
  const sample = [
    'claude-fable-5',
    'claude-fable-5-1',
    'claude-fable-5-2',
    'claude-fable-5-mythos-5',
    'claude-haiku-3-5',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-5-20251001-v1',
    'claude-haiku-5-5',
    'claude-mythos-5',
    'claude-mythos-5-1',
    'claude-mythos-5-2',
    'claude-mythos-preview',
    'claude-opus-4-8',
    'claude-opus-4-6-v1',
    'claude-opus-5-5',
    'claude-opus-5-5-20251101',
    'claude-opus-5-5-v1',
    'claude-sonnet-3-7',
    'claude-sonnet-4-6',
    'claude-sonnet-5-5',
    'claude-sonnet-latest',
    'claude-opus-6-0',
  ];
  assert.deepEqual(filterClaudeModels(sample), [
    'claude-opus-6-0',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-2',
    'claude-mythos-5-2',
    'claude-fable-5-1',
    'claude-mythos-5-1',
  ]);
});

test('claudeBundleModels reads ids from a bundle file and falls back cleanly when missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-claude-bin-'));
  const bin = path.join(dir, 'claude.exe');
  fs.writeFileSync(bin, 'binary...\0claude-mythos-5-2\0claude-opus-4-8\0claude-opus-5-5-v1\0claude-mythos-5-1\0', 'latin1');
  try {
    assert.deepEqual(claudeBundleModels(bin), ['claude-mythos-5-2', 'claude-mythos-5-1']);
    assert.deepEqual(claudeBundleModels(path.join(dir, 'missing.exe')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude known models include Mythos 5.2 and 5.1 newest first', () => {
  const claude = PROVIDERS.find(p => p.id === 'claude');
  assert.ok(claude.known.includes('claude-mythos-5-2'));
  assert.ok(claude.known.includes('claude-mythos-5-1'));
  assert.ok(claude.known.indexOf('claude-mythos-5-2') < claude.known.indexOf('claude-mythos-5-1'));
  const list = allModels().claude;
  assert.ok(list.includes('claude-mythos-5-2'));
  assert.ok(list.includes('claude-mythos-5-1'));
});
