const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restartRoster } = require('./roster.cjs');
test('new chat: stopped agents stay stopped and a missing CLI does not abort the reset', () => {
 const started = [], parked = [];
 const roster = [{ name: 'boss' }, { name: 'fixer-gem', stopped: true }, { name: 'coder' }, { name: 'gone' }, { name: 'scout' }];
 const failed = restartRoster(roster, {
  start: a => { if (a.name === 'gone') throw new Error('"gemini" was not found. Install it or set its path in Settings.'); started.push(a.name); },
  park: a => parked.push(a.name),
 });
 assert.deepEqual(started, ['boss', 'coder', 'scout']);
 assert.deepEqual(parked, ['fixer-gem', 'gone']);
 assert.deepEqual(failed, [{ name: 'gone', text: 'gone could not start: "gemini" was not found. Install it or set its path in Settings.' }]);
});
