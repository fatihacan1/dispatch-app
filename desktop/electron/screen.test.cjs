const test = require('node:test');
const assert = require('node:assert');
const screen = require('./screen.cjs');
const L = s => s.split('\n');
const R = '─'.repeat(60);

const FILE = L(`● Explored 2 files\n○ Running (Get-ChildItem)\n\nFile access\n${R}\n\nRead: D:/Fatih/Kodlar/dispatch-social/DISPATCH.md\nReason: outside workspace\n\nAllow access to this file?\n> 1. Yes, allow access\n  2. Yes, and always allow non-workspace access\n  3. No, deny access\n\n  ↑/↓ Navigate\nesc to cancel`);
const TOOL = L(`Allow calling this tool?\n> 1. Yes, allow tool call\n  2. Yes, and always allow tool 'dispatch-mcp_dispatch_memory/memory_open' in\nthis conversation\n  3. Yes, and always allow tool 'dispatch-mcp_dispatch_memory/memory_open'\n(Persist to settings.json)\n  4. No, deny tool call\n  5. No, and always deny tool 'x' in\nthis conversation\n  6. No, and always deny tool 'x'\n(Persist to settings.json)\n\n  ↑/↓ Navigate\nesc to cancel`);
const TRUST = L(`Accessing workspace:\n\nD:\\x\\proj\n\nDo you trust the contents of this project?\n\nAntigravity CLI requires permission to read, edit, and execute files here.\n\n> Yes, I trust this folder\n  No, exit\n\n  ↑/↓ Navigate · enter Confirm\n                         auto · Gemini 4 Hydrogen · low`);
const box = (text, footer, above = '') => L(`${above}\n${R}\n> ${text}\n${R}\n${footer}          auto · Gemini 4 Hydrogen · low`);

test('agy file access menu is read whole', () => {
  const m = screen.parseMenu(FILE);
  assert.deepStrictEqual(m.options, ['Yes, allow access', 'Yes, and always allow non-workspace access', 'No, deny access']);
  assert.strictEqual(m.question, 'Allow access to this file?'); assert.strictEqual(m.title, 'File access');
  assert.match(m.body, /Reason: outside workspace/); assert.strictEqual(m.selected, 0);
  assert.strictEqual(screen.menuKind(m), 'Approve command'); assert.strictEqual(screen.agyState(FILE), 'menu');
});
test('agy tool call menu with wrapped labels', () => {
  const m = screen.parseMenu(TOOL);
  assert.strictEqual(m.options.length, 6); assert.match(m.options[1], /in this conversation$/); assert.match(m.options[3], /^No, deny/);
  assert.strictEqual(screen.menuKind(m), 'Approve command');
});
test('agy trust question', () => {
  const m = screen.parseMenu(TRUST);
  assert.deepStrictEqual(m.options, ['Yes, I trust this folder', 'No, exit']); assert.strictEqual(screen.menuKind(m), 'Trust folder');
});
test('claude approval menu', () => {
  const m = screen.parseMenu(L(`${R}\n Bash command\n\n   npm test\n   Run tests\n\n Do you want to proceed?\n   1. Yes\n ❯ 2. Yes, and don't ask again for npm test\n   3. No\n\n Esc to cancel · Tab to amend`));
  assert.strictEqual(m.options.length, 3); assert.strictEqual(m.selected, 1); assert.strictEqual(screen.menuKind(m), 'Approve command');
  assert.strictEqual(screen.menuKeys(m, 2), '\x1b[B\r'); assert.strictEqual(screen.menuKeys(m, 0), '\x1b[A\r');
});
test('claude approval menu with a command between thin rules', () => {
  const thin = '╌'.repeat(60);
  const m = screen.parseMenu(L(`● Bash(rm)
${R}
 Bash command
 Run shell command
${thin}
 │ rm -f /d/x.txt; cd y
${thin}
 Dangerous rm operation on critical path: /d/x.txt


 Do you want to proceed?
 > 1. Yes
   2. No

 Esc to cancel · Tab to amend`));
  assert.strictEqual(screen.menuKind(m), 'Approve command'); assert.match(m.body, /rm -f \/d\/x.txt/); assert.match(m.body, /Dangerous rm/); assert.match(m.body, /Bash command/);
});
test('a boxed menu (Gemini) is read without its frame', () => {
  const m = screen.parseMenu(L(`╭──────────────────────────╮\n│ Allow execution of: 'npm'? │\n│                          │\n│ ● 1. Yes, allow once     │\n│   2. No (esc)            │\n╰──────────────────────────╯`));
  assert.deepStrictEqual(m && m.options, ['Yes, allow once', 'No (esc)']);
});
test('a list in a reply is not a menu', () => {
  assert.strictEqual(screen.parseMenu(box('', '? for shortcuts', 'Do you want to proceed?\n> 1. Yes\n  2. No')), null);
  assert.strictEqual(screen.parseMenu(L('Which one?\n1. Yes\n2. No')), null);
  assert.strictEqual(screen.parseMenu(L('Ready for orders.\n> ')), null);
});
test('agy state from its footer', () => {
  assert.strictEqual(screen.agyState(box('', '? for shortcuts')), 'idle');
  assert.strictEqual(screen.agyState(box('', 'esc to cancel', '⣷  Generating...')), 'busy');
  assert.strictEqual(screen.agyState(box('hello there', '')), 'typing');
  assert.strictEqual(screen.agyState(L('Signing in...\n⣷ ')), 'loading');
  assert.strictEqual(screen.shownMode('antigravity', box('', '? for shortcuts')), 'auto');
});
test('headless screen puts partial redraws together', async () => {
  const s = screen.create(40, 6); await new Promise(r => s.write('\x1b[2;1HAllow\x1b[2;7Haccess?\x1b[4;1H  2. No\x1b[3;1H> 1. Yes', r));
  assert.deepStrictEqual(screen.parseMenu(s.lines()).options, ['Yes', 'No']); s.dispose();
});
