const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create, strip } = require('./custom-tools.cjs');

function fakeSpawn(calls) {
  return (file, args, opts) => {
    const t = { pid: 0, file, args, opts, data: [], exit: [], written: [], onData(fn) { this.data.push(fn); }, onExit(fn) { this.exit.push(fn); }, write(d) { this.written.push(d); }, resize() {}, kill() { for (const fn of this.exit) fn({ exitCode: 0 }); } };
    calls.push(t); return t;
  };
}
const setup = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ctools-')); const calls = []; return { dir, calls, tools: create({ dir: () => dir, spawn: fakeSpawn(calls), platform: 'linux' }) }; };

test('custom tools: saved with an id from the name, a command or a note is needed', () => {
  const { tools, dir } = setup();
  assert.throws(() => tools.save({ name: '' }), /name/);
  assert.throws(() => tools.save({ name: 'Empty' }), /command to run, a note/);
  const a = tools.save({ name: 'Image API', command: 'npm start', note: 'Read /help', autostart: true });
  const b = tools.save({ name: 'Image API', note: 'second one' });
  assert.equal(a.id, 'image-api'); assert.equal(b.id, 'image-api-2');
  assert.equal(tools.save({ name: 'Note only', note: 'x', autostart: true }).autostart, false, 'nothing to start');
  tools.save({ ...a, note: 'Read GET /help first' });
  assert.equal(tools.list().find(t => t.id === 'image-api').note, 'Read GET /help first');
  tools.remove('image-api-2');
  assert.deepEqual(tools.list().map(t => t.id), ['image-api', 'note-only']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('custom tools: the command runs in a terminal, its text goes to the log agents read, and the prompt names it', async () => {
  const { tools, dir, calls } = setup();
  const t = tools.save({ name: 'Bridge', command: 'node server.js', cwd: dir, note: 'API at http://127.0.0.1:3210' });
  tools.save({ name: 'Hidden', note: 'secret', agents: false });
  assert.equal(tools.start(t.id), 'ctool-bridge');
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].args, ['-lc', 'node server.js']); assert.equal(calls[0].opts.cwd, dir);
  assert.equal(tools.start(t.id), 'ctool-bridge'); assert.equal(calls.length, 1, 'already running: not started twice');
  for (const fn of calls[0].data) fn('\x1b[32mSign in to ChatGPT in the window\x1b[0m\r\n');
  assert.match(tools.output('ctool-bridge'), /Sign in/);
  assert.equal(tools.input('ctool-bridge', 'y\r'), true); assert.deepEqual(calls[0].written, ['y\r']);
  await new Promise(r => setTimeout(r, 600));
  assert.match(fs.readFileSync(path.join(dir, 'tools', 'bridge.log'), 'utf8'), /Sign in to ChatGPT in the window/);
  const p = tools.prompt();
  assert.match(p, /Bridge \(Dispatch runs it for the user; its terminal output is in .*bridge\.log/); assert.match(p, /API at http:\/\/127\.0\.0\.1:3210/);
  assert.doesNotMatch(p, /secret/);
  assert.equal(tools.list().find(x => x.id === 'bridge').running, true);
  tools.stop(t.id);
  assert.equal(tools.list().find(x => x.id === 'bridge').running, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('custom tools: a tool stopped by hand stays off at the next launch until started again; quitting does not count', () => {
  const { tools, dir, calls } = setup();
  const a = tools.save({ name: 'Bridge', command: 'node a.js', autostart: true });
  const b = tools.save({ name: 'Other', command: 'node b.js', autostart: true });
  tools.autostart(); assert.equal(calls.length, 2);
  tools.stop(a.id);
  assert.equal(tools.list().find(t => t.id === a.id).stopped, true);
  tools.stopAll();
  assert.equal(tools.list().find(t => t.id === b.id).stopped, undefined, 'quitting is not a manual stop');
  const next = create({ dir: () => dir, spawn: fakeSpawn(calls), platform: 'linux' });
  next.autostart(); assert.deepEqual(calls.slice(2).map(c => c.args[1]), ['node b.js'], 'only the tool not stopped by hand starts');
  next.save({ ...next.list().find(t => t.id === a.id), note: 'edited' });
  assert.equal(next.list().find(t => t.id === a.id).stopped, true, 'editing keeps it off');
  next.start(a.id); assert.equal(next.list().find(t => t.id === a.id).stopped, undefined, 'starting by hand turns autostart back on');
  next.stopAll(); fs.rmSync(dir, { recursive: true, force: true });
});

test('custom tools: windows runs the command line through cmd as typed; ANSI is stripped from the log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ctools-')); const calls = [];
  const tools = create({ dir: () => dir, spawn: fakeSpawn(calls), platform: 'win32' });
  const bat = path.join(dir, 'start api.bat'); fs.writeFileSync(bat, '@echo off');
  const t = tools.save({ name: 'x', command: `"${bat}" --port 1` });
  tools.start(t.id);
  assert.equal(calls[0].args, `/d /s /c ""${bat}" --port 1"`);
  assert.equal(calls[0].opts.cwd, dir, 'a command given by its path runs in that folder');
  assert.equal(strip('\x1b[1mbold\x1b[0m\x1b]0;title\x07 ok\x1b[2Cx'), 'bold ok x');
  tools.stopAll(); fs.rmSync(dir, { recursive: true, force: true });
});
