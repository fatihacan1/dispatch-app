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
