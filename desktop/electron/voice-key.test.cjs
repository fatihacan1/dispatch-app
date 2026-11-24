const test = require('node:test');
const assert = require('node:assert');
const { valid, of, DEFAULT } = require('./voice-key.cjs');
test('voice shortcut: single keys and combinations, nothing else', () => {
  for (const ok of ['F9', 'Control+Alt+Space', 'Insert', 'Scrolllock', 'num0', 'Super+Shift+V', '`', 'Alt+-']) assert.ok(valid(ok), ok);
  for (const bad of ['', 'Control', 'Foo', 'Control+Control+A', 'A+B', 'Escape', null, 'Hyper+A']) assert.ok(!valid(bad), String(bad));
  assert.strictEqual(of({ voiceShortcut: 'Foo' }), DEFAULT); assert.strictEqual(of({ voiceShortcut: 'F9' }), 'F9');
});
