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
