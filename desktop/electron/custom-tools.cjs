// Custom tools: anything the user wants their agents to know about, added by hand in Tools. A tool is a name, an
// optional command Dispatch keeps running in a terminal of its own, and a note for the agents (what it is, where it
// listens, how to use it). Dispatch knows nothing else about it: a sign-in or any other question the program asks is
// answered by the user in that terminal. One process per tool for the whole app, shared by every project tab.
// Saved in ~/.dispatch/custom-tools.json; the terminal's text is mirrored to ~/.dispatch/tools/<id>.log for agents.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const LOG_MAX = 200000;
const strip = s => String(s).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][A-Z0-9]/g, '').replace(/\r(?!\n)/g, '\n');
const cleanId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const termName = id => `ctool-${id}`;

function create({ dir, spawn, platform = process.platform }) {
  const file = () => path.join(dir(), 'custom-tools.json');
  const logFile = id => path.join(dir(), 'tools', `${id}.log`);
  const running = new Map(); // id -> { terminal, output, log, startedAt, exitCode }
  const listeners = new Set();
  const emit = (channel, value) => { for (const fn of listeners) try { fn(channel, value); } catch {} };

  function list() { try { const v = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(v) ? v.filter(t => t && t.id && t.name) : []; } catch { return []; } }
  function write(items) { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(items, null, 2)); emit('custom-tools-changed', null); }
  function status() {
    return list().map(t => { const r = running.get(t.id); return { ...t, terminal: termName(t.id), log: logFile(t.id), running: !!r && r.exitCode == null, exitCode: r?.exitCode ?? null, startedAt: r?.startedAt || null }; });
  }
  function save(input) {
    const name = String(input?.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Give the tool a name.');
    const command = String(input?.command || '').trim(), cwd = String(input?.cwd || '').trim(), note = String(input?.note || '').trim().slice(0, 4000);
    if (!command && !note) throw new Error('Add a command to run, a note for the agents, or both.');
    if (cwd && !fs.existsSync(cwd)) throw new Error(`Folder not found: ${cwd}`);
    const items = list();
    const old = input.id ? items.find(t => t.id === input.id) : null;
    let id = old?.id || cleanId(name) || 'tool';
    if (!old) { const base = id; for (let i = 2; items.some(t => t.id === id); i++) id = `${base}-${i}`; }
    const tool = { id, name, command, cwd, note, autostart: !!input.autostart && !!command, agents: input.agents !== false };
    write(old ? items.map(t => t.id === id ? tool : t) : [...items, tool]);
    return tool;
  }
  function remove(id) { stop(id); write(list().filter(t => t.id !== id)); try { fs.rmSync(logFile(id), { force: true }); } catch {} return true; }

  // The command line as the user typed it, through the system shell, so "start-api.bat", "npm start" or
  // "python server.py --port 8000" all work. The folder defaults to the folder of a file given by its path.
  // Windows: node-pty takes the command line as one string there, so cmd gets it exactly as typed (quotes intact).
  function shellFor(command) { return platform === 'win32' ? { file: process.env.ComSpec || 'cmd.exe', args: `/d /s /c "${command}"` } : { file: process.env.SHELL || '/bin/sh', args: ['-lc', command] }; }
  function folderFor(t) {
    if (t.cwd) return t.cwd;
    const m = t.command.match(/^"([^"]+)"|^(\S+)/); const first = m ? (m[1] || m[2]) : '';
    if (first && path.isAbsolute(first) && fs.existsSync(first)) return path.dirname(first);
    return dir();
  }
  function start(id) {
    const t = list().find(x => x.id === id); if (!t) throw new Error('Tool not found.');
    if (!t.command) throw new Error(`${t.name} has no command to run.`);
    const now = running.get(id); if (now && now.exitCode == null) return termName(id);
    const sh = shellFor(t.command);
    const terminal = spawn(sh.file, sh.args, { name: 'xterm-256color', cols: 110, rows: 30, cwd: folderFor(t), env: process.env });
    fs.mkdirSync(path.dirname(logFile(id)), { recursive: true });
    const header = `[Dispatch] ${new Date().toISOString()} started: ${t.command}\n`;
    const entry = { terminal, output: '', log: header, startedAt: new Date().toISOString(), exitCode: null };
    running.set(id, entry);
    let flush = null;
    const save = () => { flush = null; try { fs.writeFileSync(logFile(id), entry.log); } catch {} };
    terminal.onData(data => {
      entry.output = (entry.output + data).slice(-LOG_MAX);
      entry.log = (entry.log + strip(data)).replace(/\n{3,}/g, '\n\n').slice(-LOG_MAX);
      if (!flush) flush = setTimeout(save, 500);
      emit('terminal', { name: termName(id), data });
    });
    terminal.onExit(({ exitCode }) => { entry.exitCode = exitCode ?? 0; entry.log += `\n[Dispatch] stopped (exit code ${entry.exitCode})\n`; clearTimeout(flush); save(); emit('custom-tools-changed', null); });
    save(); emit('custom-tools-changed', null);
    return termName(id);
  }
  // The whole process tree: a .bat that starts node that starts Chrome must not leave anything behind.
  function stop(id) {
    const r = running.get(id); if (!r) return false;
    if (r.exitCode == null) { const pid = r.terminal.pid; try { if (platform === 'win32' && pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); else r.terminal.kill(); } catch {} try { r.terminal.kill(); } catch {} }
    running.delete(id); emit('custom-tools-changed', null); return true;
  }
  function stopAll() { for (const id of [...running.keys()]) stop(id); }
  function autostart() { for (const t of list()) if (t.autostart) try { start(t.id); } catch (e) { console.error(`Custom tool ${t.name}:`, e.message); } }
  const byTerm = name => [...running.entries()].find(([id]) => termName(id) === name)?.[1];
  // What the agents are told, in their start prompt.
  function prompt() {
    const items = status().filter(t => t.agents);
    if (!items.length) return '';
    return `\nCustom tools the user added (use them when they fit the task):\n${items.map(t => `- ${t.name}${t.command ? ` (Dispatch runs it for the user; its terminal output is in ${t.log}, read the end of it to see whether it is up or waiting for something)` : ''}${t.note ? `: ${t.note.replace(/\s*\n\s*/g, ' ')}` : ''}`).join('\n')}\nIf a custom tool is not running or its terminal waits for the user (a sign-in, a question), tell the user; do not try to start it yourself.`;
  }
  return {
    list: status, save, remove, start, stop, stopAll, autostart, prompt,
    output: name => byTerm(name)?.output ?? null,
    input: (name, data) => { const r = byTerm(name); if (!r || r.exitCode != null) return false; try { r.terminal.write(data); } catch {} return true; },
    resize: (name, cols, rows) => { const r = byTerm(name); if (!r || r.exitCode != null) return false; try { r.terminal.resize(cols, rows); } catch {} return true; },
    on: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
module.exports = { create, cleanId, strip };
