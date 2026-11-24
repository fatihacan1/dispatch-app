// Stands in for the real agy / claude in cli-states.spec.ts: draws the screens those CLIs draw and writes the transcripts
// they write, including the cases that are rare with the real ones (a start that hangs, menus, a turn that never ends).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const kind = process.env.FAKE_KIND, W = () => Math.max(40, process.stdout.columns || 100);
const out = s => process.stdout.write(s);
const wait = ms => new Promise(r => setTimeout(r, ms));
const note = s => fs.appendFileSync(path.join(process.env.FAKE_LOG), `${kind} ${s}\n`);
try { process.stdin.setRawMode(true); } catch {}
process.stdin.resume(); process.stdin.setEncoding('utf8');
let onKey = null, typed = '', busy = 0, spin = null, body = [];
const rule = () => '─'.repeat(W());
const SPIN = '⣾⣽⣻⢿⡿⣟⣯⣷';

// ── agy ──
function draw(footer, above = '') { out(`\x1b[2J\x1b[H${body.slice(-14).join('\r\n')}\r\n${above}\r\n${rule()}\r\n> ${typed}\r\n${rule()}\r\n${footer.padEnd(60)} auto · Gemini 4 Hydrogen · low`); }
const idle = () => { busy = 0; clearInterval(spin); draw(typed ? '' : '? for shortcuts'); };
const work = () => { busy = 1; clearInterval(spin); let i = 0; spin = setInterval(() => draw('esc to cancel', `${SPIN[i++ % 8]}  Generating...`), 120); };
let db = null, idx = 0;
const varint = n => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (f, v) => { const b = Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'); return Buffer.concat([varint(f * 8 + 2), varint(b.length), b]); };
function step(type, payload, status = 3) {
  if (!db) {
    const { DatabaseSync } = require('node:sqlite'), dir = path.join(process.env.ANTIGRAVITY_APP_DATA_DIR, 'conversations'); fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, crypto.randomUUID() + '.db'));
    db.exec('create table steps (idx integer, step_type integer, status integer, step_payload blob); create table trajectory_metadata_blob (id text, data blob)');
    db.prepare('insert into trajectory_metadata_blob values (?, ?)').run('main', Buffer.from('\x0a' + 'file:///' + process.cwd().replace(/\\/g, '/').split('/').map((p, i) => i ? encodeURIComponent(p) : p).join('/') + '\x00'));
  }
  db.prepare('insert into steps values (?, ?, ?, ?)').run(idx++, type, status, payload);
}
const say = t => step(15, field(20, field(1, t)));
const tool = (n, a) => step(15, field(20, field(7, Buffer.concat([field(2, n), field(3, JSON.stringify(a))]))));
const FILE = ['File access', null, '', 'Read: D:/Fatih/Kodlar/dispatch-social/DISPATCH.md', 'Reason: outside workspace', '', 'Allow access to this file?'];
async function menu(head, options) {
  clearInterval(spin); let sel = 0;
  const show = () => out(`\x1b[2J\x1b[H${head.map(l => l === null ? rule() : l).join('\r\n')}\r\n${options.map((o, i) => `${i === sel ? '>' : ' '} ${i + 1}. ${o}`).join('\r\n')}\r\n\r\n  ↑/↓ Navigate\r\nesc to cancel`);
  show();
  await new Promise(done => { onKey = k => { if (k === '\x1b[B') sel = Math.min(options.length - 1, sel + 1); else if (k === '\x1b[A') sel = Math.max(0, sel - 1); else if (k === '\r') { onKey = null; done(); return; } show(); }; });
  note(`picked ${options[sel]}`); return options[sel];
}
async function agyTurn(text) {
  step(14, field(19, field(2, text))); work();
  if (text.includes('CASE-PLAIN')) { await wait(1500); say('PLAIN ANSWER'); await wait(150); body.push('PLAIN ANSWER'); return idle(); }
  if (text.includes('CASE-MENU')) {
    await wait(800); tool('read_file', { path: 'D:/x' });
    const a = await menu(FILE, ['Yes, allow access', 'Yes, and always allow non-workspace access', 'No, deny access']);
    const b = await menu(['Allow calling this tool?'], ['Yes, allow tool call', "Yes, and always allow tool 'dispatch-mcp_dispatch_memory/memory_open' in this conversation and one more long tail of it", 'No, deny tool call']);
    work(); await wait(700); say(`PICKED ${a} + ${b}`); await wait(150); return idle();
  }
  if (text.includes('CASE-INTERIM')) { await wait(800); say('Looking around first.'); await wait(5000); tool('run_command', { CommandLine: 'git status' }); await wait(1200); say('REAL FINAL'); await wait(150); return idle(); }
  if (text.includes('CASE-ERROR')) { await wait(800); step(17, field(24, field(3, field(1, 'The stream was interrupted. Please continue the task you were working on.')))); await wait(4000); tool('run_command', { CommandLine: 'git log' }); await wait(600); say('RECOVERED'); await wait(150); return idle(); }
  if (text.includes('CASE-PROSE')) { body.push('Example of a menu:', 'Do you want to proceed?', '❯ 1. Yes', '  2. No', 'Esc to cancel'); await wait(1500); say('PROSE DONE'); await wait(150); return idle(); }
  if (text.includes('CASE-FOREVER')) { await wait(400); tool('run_command', { CommandLine: 'ping' }); onKey = k => { if (k === '\x1b') { onKey = null; note('escaped'); body.push('  ⎿  Interrupted · What should Antigravity CLI do instead?'); idle(); } }; return; }
  if (text.includes('CASE-CANCELLED')) { await wait(400); onKey = k => { if (k === '\x1b') { onKey = null; step(15, field(20, field(1, 'half a tex')), 6); idle(); } }; return; }
}

// ── claude ──
const session = process.env.FAKE_SESSION;
const jsonl = () => path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`);
const line = o => { fs.mkdirSync(path.dirname(jsonl()), { recursive: true }); fs.appendFileSync(jsonl(), JSON.stringify(o) + '\n'); };
const reply = (text, stop) => line({ type: 'assistant', message: { content: [{ type: 'text', text }], stop_reason: stop } });
const cprompt = () => out(`\x1b[2J\x1b[H${body.slice(-14).join('\r\n')}\r\n${rule()}\r\n❯ ${typed}\r\n${rule()}\r\n  ? for shortcuts`);
async function claudeTurn(text) {
  line({ type: 'user', message: { content: text } });
  let i = 0; const t0 = Date.now(); spin = setInterval(() => out(`\x1b[2J\x1b[H✻ Thinking… (${Math.round((Date.now() - t0) / 1000)}s · esc to interrupt) ${i++}`), 150);
  if (text.includes('CASE-LOST-END')) { await wait(2500); reply('THE ANSWER WHOSE END WAS LOST', null); clearInterval(spin); body.push('THE ANSWER WHOSE END WAS LOST'); return cprompt(); }
  if (text.includes('CASE-BASH')) {
    await wait(1200); clearInterval(spin); let sel = 0; const thin = '╌'.repeat(W());
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rm -f /d/zz-probe.txt' } }], stop_reason: 'tool_use' } });
    const opts = ['Yes', 'No'];
    const show = () => out(`\x1b[2J\x1b[H● Bash(rm -f)\r\n${rule()}\r\n Bash command\r\n Run shell command\r\n${thin}\r\n │ rm -f /d/zz-probe.txt; sleep 2\r\n${thin}\r\n Dangerous rm operation on critical path: /d/zz-probe.txt\r\n ⚠ Claude Code will automatically block this request in 0:55, to avoid holding up an unattended session\r\n\r\n\r\n Do you want to proceed?\r\n${opts.map((o, n) => ` ${n === sel ? '❯' : ' '} ${n + 1}. ${o}`).join('\r\n')}\r\n\r\n Esc to cancel · Tab to amend`);
    show(); await new Promise(done => { onKey = k => { if (k === '\x1b[B') sel = 1; else if (k === '\x1b[A') sel = 0; else if (k === '\r') { onKey = null; return done(); } show(); }; });
    note(`picked ${opts[sel]}`); line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
    reply(`BASH ${opts[sel]}`, 'end_turn'); return cprompt();
  }
}

// ── keys: bracketed paste, Enter, arrows ──
let pasting = false;
process.stdin.on('data', d => {
  for (const k of String(d).match(/\x1b\[20[01]~|\x1b\[[A-Z]|\x1b|\r|[^\x1b\r]+/g) || []) {
    if (k === '\x1b[200~') { pasting = true; continue; } if (k === '\x1b[201~') { pasting = false; if (!busy && !onKey) kind === 'agy' ? idle() : cprompt(); continue; }
    if (pasting) { typed += k; continue; }
    if (onKey) { onKey(k); continue; }
    if (k === '\r' && typed && !started) continue;
    if (k === '\r' && typed) { const t = typed; typed = ''; note(`got ${t.slice(0, 60).replace(/\s+/g, ' ')}`); (kind === 'agy' ? agyTurn : claudeTurn)(t).catch(e => note('error ' + e.stack)); }
  }
});
let started = false;
(async () => {
  if (kind === 'agy' && process.env.FAKE_LATE) {
    // Draws nothing useful and reads nothing until its terminal is resized, like the start that hung.
    out('Signing in...'); const c0 = `${process.stdout.columns}x${process.stdout.rows}`; const t0 = Date.now();
    while (Date.now() - t0 < 90000) { await wait(150); try { process.stdout._refreshSize(); } catch {} if (`${process.stdout.columns}x${process.stdout.rows}` !== c0) break; }
    note(`resized after ${Math.round((Date.now() - t0) / 1000)}s`); typed = '';
  } else await wait(1500);
  started = true; kind === 'agy' ? idle() : cprompt();
})();
