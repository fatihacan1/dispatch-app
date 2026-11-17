const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseClaude, parseCodex } = require('./activity.cjs');
const line = (content, stop_reason, extra = {}) => ({ type: 'assistant', message: { content, stop_reason }, ...extra });
test('claude: text between tools is a step, the closing text is the reply', () => {
 assert.deepEqual(parseClaude(line([{ type: 'text', text: 'Looking at the tests.' }], 'tool_use')), { steps: [{ kind: 'text', text: 'Looking at the tests.' }] });
 const end = parseClaude(line([{ type: 'text', text: '## Done\n\n- a\n- b' }], 'end_turn'));
 assert.equal(end.turn, false); assert.equal(end.final, '## Done\n\n- a\n- b'); assert.deepEqual(end.steps, []);
 assert.deepEqual(parseClaude(line([{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }], 'tool_use')).steps, [{ kind: 'tool', text: 'Bash · npm test' }]);
});
test('claude: slash commands, skill bodies and sub-agents do not start a turn', () => {
 assert.equal(parseClaude({ type: 'user', message: { content: '[Dispatch] message from you (id 1): hi' } }).turn, true);
 assert.equal(parseClaude({ type: 'user', message: { content: '<command-name>/model</command-name>' } }).turn, undefined);
 assert.equal(parseClaude({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill' }] } }).turn, undefined);
 assert.equal(parseClaude({ type: 'user', isSidechain: true, message: { content: 'sub-agent task' } }).turn, undefined);
 assert.equal(parseClaude({ type: 'user', message: { content: '[Request interrupted by user]' } }).turn, false);
 // A background task's notice starts no turn by itself (seen on resume: the agent showed as working for 27 min).
 assert.equal(parseClaude({ type: 'user', message: { content: '<task-notification>\n<task-id>b1</task-id>\n<status>stopped</status>' } }).turn, undefined);
});
test('codex: messages, turn start and the final reply', () => {
 assert.equal(parseCodex({ type: 'event_msg', payload: { type: 'task_started' } }).turn, true);
 assert.deepEqual(parseCodex({ type: 'event_msg', payload: { type: 'agent_message', message: 'Checking.' } }).steps, [{ kind: 'text', text: 'Checking.' }]);
 const end = parseCodex({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'All good.' } });
 assert.equal(end.turn, false); assert.equal(end.final, 'All good.');
});
test('claude: AskUserQuestion becomes a question the chat can answer, its tool result closes it', () => {
 const ask = parseClaude(line([{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input: { questions: [{ question: 'Pick a color', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] }, { question: 'Toppings?', header: 'Toppings', multiSelect: true, options: [{ label: 'Cheese' }, { label: 'Olives' }, { label: 'Ham' }] }] } }], 'tool_use'));
 assert.equal(ask.ask.id, 'toolu_1'); assert.equal(ask.ask.questions.length, 2);
 assert.deepEqual(ask.ask.questions[0].options[0], { label: 'Red', description: 'warm' }); assert.equal(ask.ask.questions[1].multiSelect, true);
 assert.match(ask.steps[0].text, /^Asks you · Pick a color/);
 assert.deepEqual(parseClaude({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'answered' }] } }).answered, ['toolu_1']);
});
test('question keys: a number per single choice, toggles then Submit for several, own text in "Type something"', () => {
 const { questionKeys } = require('./activity.cjs');
 const D = '\x1b[B';
 const qs = [{ question: 'Color', multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] }, { question: 'Toppings', multiSelect: true, options: [{ label: 'Cheese' }, { label: 'Olives' }, { label: 'Ham' }] }];
 assert.deepEqual(questionKeys(qs, [{ picks: [2] }, { picks: [0, 2] }]), [['3'], ['1', '3', D, D, D, D, '\r']]);
 assert.deepEqual(questionKeys(qs, [{ picks: [], other: 'Purple\nsky' }, { picks: [1], other: 'Pineapple' }]), [[D, D, D, 'Purple sky', '\r'], ['2', D, D, D, 'Pineapple', D, '\r']]);
 assert.throws(() => questionKeys(qs, [{ picks: [] }, { picks: [0] }]), /Pick an answer/);
 assert.throws(() => questionKeys(qs, [{ picks: [7] }, { picks: [0] }]), /Pick an answer/);
});

// Antigravity steps are protobuf rows: a tiny encoder builds them (length-delimited fields only).
const { parseAgyStep, agyMatchesAgent, antigravityWorking } = require('./activity.cjs');
const pb = fields => Buffer.concat(fields.map(([f, v]) => {
  const body = Array.isArray(v) ? pb(v) : Buffer.from(v, 'utf8');
  const varint = n => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
  return Buffer.concat([varint(f * 8 + 2), varint(body.length), body]);
}));
test('antigravity: tool steps, text between them and the closing reply', () => {
 const tool = parseAgyStep(15, pb([[20, [[1, 'Checking the logs.'], [7, [[2, 'run_command'], [3, '{"CommandLine":"npm test"}']]]]]]));
 assert.equal(tool.turn, true);
 assert.deepEqual(tool.steps, [{ kind: 'text', text: 'Checking the logs.' }, { kind: 'tool', text: 'run_command · npm test' }]);
 const end = parseAgyStep(15, pb([[20, [[1, '## Done']]]]));
 assert.equal(end.turn, false); assert.equal(end.final, '## Done');
 assert.equal(parseAgyStep(14, pb([[19, [[2, 'hi']]]])).turn, true);
});
test('antigravity: a failed turn (quota reached) ends the turn and says why', () => {
 const e = parseAgyStep(17, pb([[24, [[3, [[1, 'Individual quota reached. Resets in 97h.'], [2, 'RESOURCE_EXHAUSTED (code 429)']]]]]]));
 assert.equal(e.turn, false); assert.equal(e.error, true);
 assert.equal(e.final, 'Antigravity error: Individual quota reached. Resets in 97h.');
});
test('antigravity: the first message names its agent even with the NULs newer agy versions store', () => {
 const msg = Buffer.from('Senior engineer. \0You are ui-theme. \0You report to boss. \0Squad', 'latin1');
 assert.equal(agyMatchesAgent(msg, 'ui-theme'), true);
 assert.equal(agyMatchesAgent(msg, 'ui-tree'), false);
 assert.equal(agyMatchesAgent(Buffer.from('a conversation the user started by hand'), 'ui-tree'), true);
});
test('antigravity: loading or signing in is not working; a delivered message or a real turn is', () => {
 const now = 100000;
 // Spinner while it signs in, no prompt on screen: nothing was asked yet.
 assert.equal(antigravityWorking({ spinAt: now - 100, atPrompt: false, lastOutput: now }, now), false);
 // A message went in: working right away, before the transcript shows the turn.
 assert.equal(antigravityWorking({ deliveredAt: now - 500, atPrompt: false, lastOutput: now }, now), true);
 // The transcript ended the turn after that message: idle again, even with the prompt box redrawn.
 assert.equal(antigravityWorking({ deliveredAt: now - 9000, turnEndAt: now - 1000, turn: false, spinAt: now - 100, lastOutput: now }, now), false);
 // A turn running with long thinking (spinner, no transcript lines): working.
 assert.equal(antigravityWorking({ turn: true, spinAt: now - 500, atPrompt: true, eventAt: now - 60000, lastOutput: now - 60000 }, now), true);
 // Stopped with Esc: the turn never ended in the transcript, but it is back at its prompt and quiet.
 assert.equal(antigravityWorking({ turn: true, atPrompt: true, eventAt: now - 30000, lastOutput: now - 25000 }, now), false);
});
test('agy conversation folder: percent-encoded URIs, spaces and non-ASCII letters match', () => {
  const { agyMetaHasFolder } = require('./activity.cjs');
  const meta = Buffer.concat([Buffer.from([0x0a, 0x30]), Buffer.from('file:///C:/Users/kerem/OneDrive/Masa%C3%BCst%C3%BC/Kerem%20CV'), Buffer.from([0x12, 0x05]), Buffer.from('file:///C:/Users/kerem/OneDrive/Masa%C3%BCst%C3%BC/Kerem%20CVz'), Buffer.from([0xff])]);
  assert.equal(agyMetaHasFolder(meta, 'C:/Users/kerem/OneDrive/Masaüstü/Kerem CV'), true);
  assert.equal(agyMetaHasFolder(meta, 'C:/Users/kerem/OneDrive/Masaüstü/Kerem'), false);
  assert.equal(agyMetaHasFolder(Buffer.from('\x0afile:///D:/Fatih/Kodlar/Dispatch\x12'), 'D:/Fatih/Kodlar/Dispatch'), true);
  assert.equal(agyMetaHasFolder(Buffer.from('\x0afile:///D:/Fatih/Kodlar/Dispatch2\x12'), 'D:/Fatih/Kodlar/Dispatch'), false);
});
test('agy: a conversation in a folder with a space and Turkish letters is found (chat no longer stuck on Thinking)', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { watch } = require('./activity.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  const cwd = path.join(root, 'Masaüstü', 'Kerem CV'); fs.mkdirSync(cwd, { recursive: true });
  const conv = path.join(root, 'account', 'conversations'); fs.mkdirSync(conv, { recursive: true });
  // What agy writes: the folder as a percent-encoded URI in the metadata, the first user message as step type 14.
  const uri = 'file:///' + cwd.split(path.sep).join('/').split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');
  const db = new DatabaseSync(path.join(conv, 'c1.db'));
  db.exec('create table trajectory_metadata_blob (id text, data blob); create table steps (idx integer, step_type integer, status integer, step_payload blob)');
  db.prepare("insert into trajectory_metadata_blob values ('main', ?)").run(Buffer.concat([Buffer.from([0x0a, uri.length]), Buffer.from(uri), Buffer.from([0x12, 0x01, 0x7a])]));
  db.prepare('insert into steps values (0, 14, 3, ?)').run(Buffer.from('You are boss. You report to you'));
  db.close();
  let session = null;
  const stop = watch({ provider: 'antigravity', cwd, name: 'boss', accountDir: path.join(root, 'account'), onEvent: () => {}, onSession: id => { session = id; } });
  try { for (let i = 0; i < 30 && !session; i++) await new Promise(r => setTimeout(r, 100)); } finally { stop(); fs.rmSync(root, { recursive: true, force: true }); }
  assert.equal(session, 'c1');
});
