const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskBoard, titleOf, KEEP } = require('./tasks.cjs');

function board(leads = { coder: 'boss', tester: 'coder' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tasks-'));
  const file = path.join(dir, 'op', 'tasks.json');
  let t = 1000; const changes = [];
  const b = createTaskBoard({ file: () => file, leadOf: n => leads[n] || (n === 'boss' ? null : 'boss'), onChange: l => changes.push(l), now: () => (t += 1000) });
  return { b, file, changes };
}
const send = (from, to, text, extra = {}) => ({ id: `${from}-${to}-${text}`, from, to, text, kind: 'send', ...extra });

test('a lead sending work opens a card; the agent reporting back closes it', () => {
  const { b, file, changes } = board();
  assert.equal(b.message(send('boss', 'coder', '## Build the login page\nDetails...')), true);
  let [task] = b.list();
  assert.equal(task.agent, 'coder'); assert.equal(task.lead, 'boss'); assert.equal(task.title, 'Build the login page'); assert.equal(task.status, 'working');
  assert.equal(b.message(send('coder', 'boss', 'done')), true);
  [task] = b.list(); assert.equal(task.status, 'done'); assert.ok(task.endedAt);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].status, 'done');
  assert.equal(changes.length, 2);
});

test('only a lead to its own agent starts a task', () => {
  const { b } = board();
  assert.equal(b.message(send('you', 'coder', 'hi')), false);
  assert.equal(b.message(send('dispatch', 'coder', 'note')), false);
  assert.equal(b.message(send('boss', 'tester', 'not yours')), false); // tester is led by coder
  assert.equal(b.message(send('coder', 'tester', 'test it')), true);
  assert.equal(b.message(send('boss', 'coder', 'a question', { kind: 'ask' })), false);
  assert.equal(b.message(send('boss', 'coder', 'an answer', { reply_to: 'x' })), false);
  assert.deepEqual(b.list().map(t => t.agent), ['tester']);
});

test('an agent asking its lead does not end the task; a newer task supersedes the open one', () => {
  const { b } = board();
  b.message(send('boss', 'coder', 'first'));
  b.message(send('coder', 'boss', 'which branch?', { kind: 'ask-wait' }));
  assert.equal(b.list()[0].status, 'working');
  b.message(send('boss', 'coder', 'second'));
  const [first, second] = b.list();
  assert.equal(first.status, 'done'); assert.equal(first.reason, 'Superseded'); assert.equal(second.status, 'working');
});

test('attention, stall, progress and stop move the card', () => {
  const { b } = board();
  b.message(send('boss', 'coder', 'work'));
  b.attention('coder', 'Approve command'); assert.equal(b.list()[0].status, 'waiting'); assert.equal(b.list()[0].waitReason, 'Approve command');
  assert.equal(b.attention('coder', 'Trust folder'), false);
  b.attention('coder', null); assert.equal(b.list()[0].status, 'working');
  b.stalled('coder'); assert.equal(b.list()[0].status, 'stalled');
  b.progress('coder'); assert.equal(b.list()[0].status, 'working');
  b.attention('coder', 'Exited'); assert.equal(b.list()[0].status, 'stopped');
  assert.equal(b.stopped('coder'), false);
  b.message(send('boss', 'coder', 'again')); b.stopped('coder');
  assert.equal(b.list()[1].status, 'stopped'); assert.equal(b.list()[1].reason, 'Stopped');
});

test('reconcile stops cards of agents that are gone; the board keeps the last entries', () => {
  const { b } = board();
  b.message(send('boss', 'coder', 'work'));
  b.reconcile(n => n === 'coder'); assert.equal(b.list()[0].status, 'stopped');
  for (let i = 0; i < KEEP + 5; i++) b.message(send('boss', 'coder', 'task ' + i, { id: 'id' + i }));
  assert.equal(b.list().length, KEEP); assert.equal(b.list().at(-1).title, `task ${KEEP + 4}`);
});

test('no operation means no board', () => {
  const b = createTaskBoard({ file: () => null, leadOf: () => 'boss' });
  assert.equal(b.message(send('boss', 'coder', 'x')), false); assert.deepEqual(b.list(), []);
});

test('titles are the first real line, shortened', () => {
  assert.equal(titleOf('\n\n# Fix bug\nmore'), 'Fix bug');
  assert.equal(titleOf('x'.repeat(200)).length, 90);
  assert.equal(titleOf(''), 'Task');
});

test('a card waiting 3 minutes tells its lead once; stalls are left to the watchdog', () => {
  const { b } = board(); let t = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tasks-'));
  const mirror = path.join(dir, 'tasks.json');
  const nb = createTaskBoard({ file: () => path.join(dir, 'op', 'tasks.json'), leadOf: () => 'boss', now: () => t, mirror: () => mirror });
  nb.message(send('boss', 'coder', 'Fix the bug'));
  nb.stalled('coder'); assert.deepEqual(nb.dueNotices(), []);
  nb.progress('coder'); nb.attention('coder', 'Question');
  t = 179000; assert.deepEqual(nb.dueNotices(), []);
  t = 181000; const first = nb.dueNotices();
  assert.equal(first.length, 1); assert.equal(first[0].lead, 'boss');
  assert.equal(first[0].text, 'Task board: coder waiting 3m (Question) on Fix the bug.');
  assert.deepEqual(nb.dueNotices(), []);
  assert.equal(JSON.parse(fs.readFileSync(mirror, 'utf8'))[0].agent, 'coder');
});
