const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { calmC, languageId } = require('./lsp.cjs');
const s = require('./lsp-servers.cjs');
const { parseMenu, isLimitMenu } = require('./screen.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-lsp-'));

test('a missing library shows once, as a warning, without the errors that follow from it', () => {
  const out = calmC([{ message: "'lib.h' file not found", code: 'pp_file_not_found', severity: 1 }, { message: 'Unknown type name Foo', severity: 1 }]);
  assert.equal(out.length, 1); assert.equal(out[0].severity, 2);
  assert.deepEqual(calmC([{ message: 'In included file: __float128 is not supported' }, { message: 'Use of undeclared x' }]).map(d => d.message), ['Use of undeclared x']);
});
test('C and C++ settings: found by themselves, chosen per project, Off', () => {
  const ws = tmp(), root = path.join(ws, 'fw'); fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'platformio.ini'), '[platformio]\ndefault_envs = b\n[env:a]\nboard=x\n[env:b]\nboard=y\n'); fs.writeFileSync(path.join(root, 'build', 'compile_commands.json'), '[]');
  fs.writeFileSync(path.join(root, 'src', 'CMakeLists.txt'), '');
  assert.equal(s.rootFor('cpp', ws, path.join(root, 'src', 'main.cpp')), root);
  assert.equal(s.resolveChoice(ws, root), 'pio:b');
  assert.deepEqual(s.cOptions(ws, root).options.map(o => o.id), ['auto', 'pio:a', 'pio:b', 'db:build', 'plain', 'off']);
  s.setChoice(ws, root, 'db:build'); assert.equal(s.resolveChoice(ws, root), 'db:build');
  fs.rmSync(path.join(root, 'build'), { recursive: true }); assert.equal(s.resolveChoice(ws, root), 'pio:b'); // gone: automatic again
  s.setChoice(ws, root, 'off'); assert.equal(s.resolveChoice(ws, root), 'off');
});
test('compiler flags clang does not know are left out', () => {
  assert.deepEqual(['-std=gnu++26', '-mlongcalls', '-Werror', '-fno-tree-switch-conversion', '-fno-exceptions', '-DX=1'].filter(s.keepFlag), ['-std=gnu++26', '-fno-exceptions', '-DX=1']);
  assert.match(s.targetOf('/x/xtensa-esp32-elf-gcc')[0], /i386/); assert.equal(languageId('typescript', 'a.tsx'), 'typescriptreact'); assert.equal(languageId('cpp', 'a.c'), 'c');
});
test("Claude's usage limit list is recognised", () => {
  const menu = parseMenu(['What do you want to do?', '', '❯ 1. Stop and wait for limit to reset', '  2. Upgrade your plan', '', 'Enter to confirm · Esc to cancel']);
  assert.ok(isLimitMenu(menu)); assert.ok(!isLimitMenu(parseMenu(['Do it?', '', '❯ 1. Yes', '  2. No', '', 'Enter to confirm'])));
});
