const test = require('node:test');
const assert = require('node:assert');
const u = require('./usage.cjs');

test('claude: session, weekly and scoped weekly windows', () => {
  const r = u.parseClaude({
    five_hour: { utilization: 75.0, resets_at: '2026-11-10T15:19:59.768182+00:00' },
    seven_day: { utilization: 19.0, resets_at: '2026-11-17T00:59:59.768204+00:00' },
    seven_day_opus: null,
    limits: [{ kind: 'session', percent: 75 }, { kind: 'weekly_scoped', percent: 4, resets_at: '2026-11-17T00:59:59.768589+00:00', scope: { model: { id: null, display_name: 'Fable' } } }],
  }, 'pro');
  assert.deepStrictEqual(r.windows.map(w => [w.label, w.usedPercent]), [['Session (5h)', 75], ['Weekly', 19], ['Weekly Fable', 4]]);
  assert.strictEqual(r.windows[0].resetsAt, '2026-11-10T15:19:59.768Z');
  assert.strictEqual(r.plan, 'pro');
});

test('claude: legacy opus/sonnet fields and empty response', () => {
  const r = u.parseClaude({ five_hour: { utilization: 1, resets_at: null }, seven_day_opus: { utilization: 40, resets_at: '2026-11-17T00:00:00Z' }, seven_day_sonnet: null });
  assert.deepStrictEqual(r.windows.map(w => w.label), ['Session (5h)', 'Weekly Opus']);
  assert.strictEqual(r.windows[0].resetsAt, null);
  assert.strictEqual(u.parseClaude({}).windows.length, 0);
});

test('codex: app-server response (camelCase)', () => {
  const r = u.parseCodexLimits({ rateLimits: { limitId: 'codex', primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1794339617 }, secondary: { usedPercent: 98, windowDurationMins: 10080, resetsAt: 1794514567 }, planType: 'plus' },
    rateLimitsByLimitId: { codex: { limitId: 'codex' }, other: { limitId: 'other', limitName: 'GPT-X', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1794339617 } } } });
  assert.deepStrictEqual(r.windows.map(w => [w.label, w.usedPercent]), [['Session (5h)', 3], ['Weekly', 98], ['GPT-X Session (5h)', 10]]);
  assert.strictEqual(r.plan, 'plus');
  assert.strictEqual(r.windows[1].resetsAt, new Date(1794514567 * 1000).toISOString());
});

test('codex: newest rollout token_count event, reset windows read as 0%', () => {
  const old = { timestamp: '2026-11-01T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 50, window_minutes: 300, resets_at: 1 }, secondary: null } } };
  const fresh = { timestamp: '2026-11-10T13:56:00.000Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 3.0, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 98.0, window_minutes: 10080, resets_at: 4102444800 }, plan_type: 'plus' } } };
  const text = [JSON.stringify(old), 'not json "rate_limits"', JSON.stringify({ type: 'other' }), JSON.stringify(fresh)].join('\n');
  const r = u.parseCodexRollout(text);
  assert.strictEqual(r.windows.length, 2);
  assert.strictEqual(r.windows[0].usedPercent, 0); // resets_at in the past
  assert.strictEqual(r.windows[1].usedPercent, 98);
  assert.strictEqual(r.plan, 'plus');
  assert.strictEqual(u.parseCodexRollout('{"a":1}\n'), null);
});

test('antigravity: /usage json groups', () => {
  const r = u.parseAntigravity({ command: { name: 'usage', data: { groups: [
    { name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.3869, reset_time: '2026-11-17T14:41:05Z' }, { id: 'gemini-5h', window: '5h', remaining_fraction: 0.8, reset_time: '2026-11-10T20:00:00Z' }] },
    { name: 'Claude and GPT models', buckets: [{ id: '3p-5h', window: '5h', remaining_fraction: 0.5, disabled: true, reset_time: '2026-11-10T20:00:00Z' }] },
  ] } } });
  assert.deepStrictEqual(r.windows.map(w => [w.label, w.usedPercent]), [['Gemini Weekly', 61.3], ['Gemini Session (5h)', 20], ['Claude/GPT Session (5h)', 100]]);
  assert.strictEqual(u.parseAntigravity({}).windows.length, 0);
});

test('antigravity: never queries the CLI without an explicit Refresh', async () => {
  let called = false;
  const r = await u.getUsage('antigravity', { resolveCommand: () => { called = true; return { file: 'agy', args: [] }; } });
  assert.strictEqual(called, false);
  assert.strictEqual(r.errorCode, 'manual');
  assert.strictEqual(r.windows.length, 0);
});

test('getUsage never throws and reports unsupported providers', async () => {
  const r = await u.getUsage('opencode');
  assert.strictEqual(r.errorCode, 'unsupported');
  const c = await u.getUsage('codex', { resolveCommand: () => { throw new Error('nf'); }, force: true });
  assert.strictEqual(c.errorCode, 'not-installed');
});

test('claude: a failed first reading falls back to the last good one saved on disk', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  const file = path.join(home, 'usage.json');
  fs.writeFileSync(file, JSON.stringify({ claude: { provider: 'claude', windows: [{ id: 'session', label: 'Session (5h)', usedPercent: 40, resetsAt: null }], updatedAt: '2026-11-14T10:00:00.000Z', source: 'x' } }));
  fs.mkdirSync(path.join(home, '.claude')); fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt: 1 } })); // expired -> error
  const prevHome = process.env.DISPATCH_USAGE_HOME; process.env.DISPATCH_USAGE_HOME = home;
  try {
    u.setCacheFile(file);
    const r = await u.getUsage('claude', { force: true });
    assert.strictEqual(r.windows.length, 1); assert.strictEqual(r.stale, true);
  } finally { u.setCacheFile(null); if (prevHome === undefined) delete process.env.DISPATCH_USAGE_HOME; else process.env.DISPATCH_USAGE_HOME = prevHome; }
});
