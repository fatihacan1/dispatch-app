const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const s = require('./schedules.cjs');

test('intervals and times', () => {
  assert.strictEqual(s.parseEvery('2h'), 7200e3);
  assert.strictEqual(s.parseEvery('1d'), 86400e3);
  assert.throws(() => s.parseEvery('1m'), /5 minutes/);
  assert.throws(() => s.parseEvery('soon'), /not an interval/);
  assert.deepStrictEqual(s.parseAt('9:05'), { time: '09:05' });
  const from = new Date(2026, 10, 10, 10, 0).getTime();
  assert.strictEqual(new Date(s.nextRun({ every: 86400e3, time: '09:00' }, from)).getDate(), 11);
  assert.strictEqual(new Date(s.nextRun({ every: 86400e3, time: '11:30' }, from)).getHours(), 11);
  assert.strictEqual(s.describe({ every: 86400e3, time: '09:00' }), 'every day at 09:00');
  assert.strictEqual(s.describe({ every: 2 * 3600e3 }), 'every 2 hours');
});

test('access: boss, team lead, plain agent', () => {
  const agents = [{ name: 'boss' }, { name: 'studio', enlistedBy: 'boss' }, { name: 'editor', enlistedBy: 'studio' }, { name: 'cutter', enlistedBy: 'editor' }, { name: 'solo', enlistedBy: 'boss' }];
  assert.strictEqual(s.access('boss', agents).role, 'boss');
  const lead = s.access('studio', agents);
  assert.strictEqual(lead.role, 'lead');
  assert.deepStrictEqual([...lead.team].sort(), ['cutter', 'editor', 'studio']);
  assert.strictEqual(s.access('solo', agents), null);
  assert.strictEqual(s.access('cutter', agents), null);
});

test('store: add, approve, due, missed runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-sched-'));
  try {
    const store = s.create({ dir });
    assert.throws(() => store.add({ task: 'x', every: '1d' }, { by: 'boss', approved: true }), /--why/);
    const a = store.add({ title: 'Daily video', why: 'User wants one video a day', task: 'Make today\'s video', every: '1d', at: '09:00' }, { by: 'boss', approved: true });
    assert.strictEqual(a.status, 'active');
    const b = store.add({ why: 'Weekly report', task: 'Report', every: '1w', to: 'editor' }, { by: 'studio', approved: false });
    assert.strictEqual(b.status, 'pending');
    // Pretend the app was closed past both run times: each due schedule runs once, then moves to the future.
    const later = Date.now() + 30 * 86400e3;
    const due = store.due(later);
    assert.deepStrictEqual(due.map(x => x.id), [a.id]);
    assert.ok(store.find(a.id).next > later);
    assert.strictEqual(store.due(later).length, 0);
    store.setStatus(b.id, 'active');
    assert.strictEqual(store.find(b.id).status, 'active');
    store.remove(a.id);
    assert.strictEqual(store.list().length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
