const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, Menu, clipboard } = require('electron');
// Must run before any ipcMain.handle: it records the handlers so another computer can call them (remote mode).
const remote = require('./remote.cjs')(ipcMain, dialog);
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const chokidar = require('chokidar');
const pty = require('node-pty');
const activity = require('./activity.cjs');
const gitLib = require('./git.cjs');
const { parseMessage } = require('./bus.cjs');
const { createDemoTerminal } = require('./demo-terminal.cjs');
const { attentionFrom, trustAnswer, nudgeAnswer, BLOCKING } = require('./attention.cjs');
const localAI = require('./local-ai.cjs');
const mcp = require('./mcp.cjs');
const storage = require('./storage.cjs');
// Dispatch started from inside a Claude Code session (npm run dev in its terminal) inherits that session's markers.
// An agent that sees them thinks it is a child session and stops saving its transcript: no live steps, no turn
// state, no resume. Agents must start as sessions of their own.
for (const key of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT']) delete process.env[key];
let win, workspace = process.cwd(), watcher, operation = null;
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
let codeIndexWorker, codeIndexInfo;
function startCodeIndex(target) {
  if (codeIndexWorker) codeIndexWorker.postMessage('close');
  const dir = path.join(os.tmpdir(), 'dispatch-code-index', crypto.createHash('sha256').update(path.resolve(target)).digest('hex'));
  codeIndexInfo = path.join(dir, `connection-${crypto.randomUUID()}.json`);
  const worker = new Worker(path.join(__dirname, 'code-index-worker.cjs'), { workerData: { root: target, dir, info: codeIndexInfo, token: crypto.randomBytes(24).toString('hex') } });
  codeIndexWorker = worker;
  worker.on('message', m => { if (m.type === 'error') console.error('Code index:', m.message); });
  worker.on('error', e => console.error('Code index worker:', e.message));
}

const os = require('node:os');
const globalDir = () => path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch');
const operationsDir = () => path.join(workspace, '.dispatch', 'operations');
const logPath = () => path.join(workspace, '.dispatch', 'log.jsonl');
const logSize = () => { try { return fs.statSync(logPath()).size; } catch { return 0; } };
function saveOperation() { if (!operation) return; fs.mkdirSync(operationsDir(), { recursive: true }); fs.writeFileSync(path.join(operationsDir(), operation.id + '.json'), JSON.stringify(operation, null, 2)); }
function finishOperation() { for (const name of exited) notify('attention', { name, reason: null }); exited.clear(); if (!operation) return; const segment = operation.segments.at(-1); if (segment && segment.end == null) segment.end = logSize(); saveOperation(); operation = null; }
function newOperation() { finishOperation(); operation = { id: crypto.randomUUID(), name: 'Operation ' + new Date().toLocaleString(), created: new Date().toISOString(), agents: [], segments: [{ start: logSize(), end: null }] }; saveOperation(); }
function listOperations() { try { return fs.readdirSync(operationsDir()).filter(f => /^[\w-]+\.json$/.test(f)).map(f => { try { return JSON.parse(fs.readFileSync(path.join(operationsDir(), f), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a,b) => b.created.localeCompare(a.created)); } catch { return []; } }
// The dev mock workspace is never reopened at launch and never kept in the recent list once left.
// Each load gets its own folder (dispatch-mock-<id>), so a folder Windows still holds open never blocks a reload.
const mockDir = () => path.join(os.tmpdir(), 'dispatch-mock-' + crypto.randomBytes(3).toString('hex'));
const isMock = w => !!w && path.resolve(path.dirname(w)).toLowerCase() === path.resolve(os.tmpdir()).toLowerCase() && /^dispatch-mock(-[0-9a-f]+)?$/i.test(path.basename(w));
const cleanMocks = keep => { try { for (const n of fs.readdirSync(os.tmpdir())) { const p = path.join(os.tmpdir(), n); if (isMock(p) && p !== keep) try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch {} } } catch {} };
let mockPrevious = null;
function recentWorkspaces() { try { return JSON.parse(fs.readFileSync(path.join(globalDir(), 'workspaces.json'), 'utf8')).filter(w => !isMock(w) || isMock(workspace)); } catch { return []; } }
function rememberWorkspace() { fs.mkdirSync(globalDir(), { recursive: true }); fs.writeFileSync(path.join(globalDir(), 'workspaces.json'), JSON.stringify([workspace, ...recentWorkspaces().filter(w => w !== workspace)].slice(0, 20), null, 2)); }
function stopAgents() { for (const [name, a] of processes) { clearTimeout(a.timer); setAttention(name, a, null); a.terminal.kill(); } processes.clear(); }
function history(op) { let log; try { log = fs.readFileSync(logPath()); } catch { return []; } return (op.segments || []).flatMap(s => log.subarray(s.start, s.end ?? log.length).toString('utf8').split('\n').map(parseMessage).filter(Boolean)); }

function chatPath(name, id) { return path.join(operationsDir(), operation.id, 'chats', name, id + '.json'); }
function readChat(name, id) { try { return JSON.parse(fs.readFileSync(chatPath(name, id), 'utf8')); } catch { return null; } }
function writeChat(name, chat) { const file = chatPath(name, chat.id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(chat, null, 2)); }
function chats(name) { try { return fs.readdirSync(path.dirname(chatPath(name, '_'))).filter(f => f.endsWith('.json')).map(f => readChat(name, f.slice(0, -5))).filter(Boolean).sort((a,b) => b.created.localeCompare(a.created)); } catch { return []; } }
function createChat(saved) { const chat = { id: crypto.randomUUID(), title: 'New chat', sessionId: demo || saved.provider === 'claude' ? crypto.randomUUID() : null, created: new Date().toISOString(), messages: [] }; writeChat(saved.name, chat); saved.chatId = chat.id; saved.sessionId = chat.sessionId; saveOperation(); return chat; }
function recordMessage(msg) { const sender = processes.get(msg.from); if (sender && msg.to !== 'orchestrator') sender.owes = null; if (!operation) return msg; const refs = {}; for (const name of new Set([msg.from, msg.to])) { const saved = operation.agents.find(a => a.name === name); if (!saved?.chatId) continue; const chat = readChat(name, saved.chatId); if (!chat) continue; refs[name] = chat.id; if (!chat.messages.some(m => m.id === msg.id)) { chat.messages.push(msg); if (chat.title === 'New chat') chat.title = msg.text.slice(0, 80); writeChat(name, chat); } } return { ...msg, chats: refs }; }
// A message Dispatch itself adds to the conversation (an agent's own reply, a notice). It goes into the log too,
// so it is still there when the operation is resumed.
function emitMessage({ from, to, text }) {
  const msg = { id: crypto.randomUUID(), from, to, text, kind: 'send', time: new Date().toISOString() };
  try { fs.mkdirSync(path.dirname(logPath()), { recursive: true }); fs.appendFileSync(logPath(), JSON.stringify(msg) + '\n'); } catch {}
  notify('message', recordMessage(msg));
  if (to === 'you') tgForward(msg);
}
// Agents about to start in the same batch (a team, a reset), so the first ones already know who else is on board.
let rosterHint = [];
function switchChat(name, id) { const saved = operation?.agents.find(a => a.name === name); if (!saved) throw new Error('Agent not found'); if (name !== 'boss' && id) throw new Error('Only Boss chats can be resumed'); const target = id ? readChat(name, id) : null; if (id && !target) throw new Error('Chat not found'); if (target && !demo && (!target.sessionId || !['claude','codex'].includes(saved.provider))) throw new Error(`Cannot resume this ${saved.provider} chat: provider session ID or resume support is unavailable.`); const old = processes.get(name); const queued = old ? [...(old.inFlight ? [old.inFlight] : []), ...old.queue] : []; if (old) { clearTimeout(old.timer); processes.delete(name); old.terminal.kill(); } const chat = target || createChat(saved); if (name !== 'boss') { for (const previous of chats(name)) if (previous.id !== chat.id) fs.unlinkSync(chatPath(name, previous.id)); } saved.chatId = chat.id; saved.sessionId = chat.sessionId; saved.stopped = false; saveOperation(); const agent = startAgent(name, saved.template, saved.enlistedBy, saved, !!target); for (const item of queued) if (!agent.queue.some(x => x.file === item.file)) agent.queue.push(item); agent.queue = agent.queue.map(item => ({ ...item, previous: true })); return chat; }
const processes = new Map();
const pendingAsks = new Set();
const trustFile = () => path.join(workspace, '.dispatch', 'trust.json');
function trusted() { try { return JSON.parse(fs.readFileSync(trustFile(), 'utf8')).trusted === true; } catch { return false; } }
function setAttention(name, agent, reason) { if (agent.attention === reason) return; if (reason !== 'Trust folder') agent.trustInteracted = false; agent.attention = reason; agent.blocked = BLOCKING.includes(reason); if (agent.blocked) clearTimeout(agent.timer); notify('attention', { name, reason }); }
function answerTrust(agent) {
  if (agent.attention !== 'Trust folder' || !trusted() || agent.trustInteracted) return;
  const answer = trustAnswer(agent.template.provider, agent.promptBuffer || '');
  if (!answer) return false;
  agent.promptBuffer = ''; agent.awaitingAnswer = true; agent.terminal.write(answer);
  return true;
}

let demo = process.argv.includes('--demo');
const bin = () => { const local = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources'), 'bin', process.platform === 'win32' ? 'dispatch.exe' : 'dispatch'); return fs.existsSync(local) ? local : 'dispatch'; };
// Resolve a CLI name to something node-pty can spawn (Windows needs full paths; .cmd/.ps1 shims need a host shell).
function resolveCommand(cmd) {
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return { file: cmd, args: [] };
  const extraDirs = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin'), path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.USERPROFILE || '', '.local', 'bin')]
    : [path.join(process.env.HOME || '', '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const dirs = [...tools.binDirs(), ...(process.env.PATH || '').split(path.delimiter), ...extraDirs].filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', '.ps1'] : [''];
  for (const dir of dirs) for (const ext of exts) {
    const full = path.join(dir, cmd + ext);
    if (!fs.existsSync(full)) continue;
    if (ext === '.cmd' || ext === '.bat') return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', full] };
    if (ext === '.ps1') return { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', full] };
    return { file: full, args: [] };
  }
  throw new Error(`"${cmd}" was not found. Install it or set its path in Settings.`);
}
function notify(channel, value) { if (win && !win.isDestroyed()) win.webContents.send(channel, value); }
const bossProviderFile = () => path.join(workspace, '.dispatch', 'boss-providers.json');
function bossProviders() { try { const data = JSON.parse(fs.readFileSync(bossProviderFile(), 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } }
const providerEnabled = (id) => bossProviders()[id]?.enabled !== false;
const visibilityFile = () => path.join(workspace, '.dispatch', 'boss-visible-templates.json');
function bossVisibleTemplates() {
  let selected = null;
  try { const value = JSON.parse(fs.readFileSync(visibilityFile(), 'utf8')); if (Array.isArray(value)) selected = new Set(value); } catch {}
  return templates.list(workspace).filter(t => t.extra?.role !== 'boss' && providerEnabled(t.provider) && (selected === null || selected.has(t.file)));
}
function watch() {
  watcher?.close();
  storage.migrate(workspace);
  startCodeIndex(workspace);
  const inbox = path.join(workspace, '.dispatch', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  for (const scope of templates.scopes(workspace).filter(s => !s.readonly)) fs.mkdirSync(scope.dir, { recursive: true });
  watchTools();
  watchMemory();
  watcher = chokidar.watch([inbox, ...templates.scopes(workspace).map(s => s.dir)], { ignoreInitial: false, awaitWriteFinish: { stabilityThreshold: 100 } });
  watcher.on('all', (event, file) => {
    if (file.endsWith('.md')) { notify('templates-changed', null); return; }
    if (event !== 'add' || !file.endsWith('.json')) return;
    let msg = null;
    try {
      msg = parseMessage(fs.readFileSync(file, 'utf8')); if (!msg) { if (file.startsWith(inbox)) fs.unlinkSync(file); return; }
      if (msg.kind === 'spawn' && msg.to === 'orchestrator') {
        const [name, templateName, ...task] = msg.text.split('\n');
        if (!templateName) throw new Error('Missing template name');
        let template;
        if (templateName.startsWith('{')) {
          // Temporary agent: inline role prompt, nothing saved to disk. Provider/model default to the caller's.
          const inline = JSON.parse(templateName); const parent = processes.get(msg.from)?.template || {};
          template = { name: inline.name || name, description: 'Temporary agent', scope: 'temporary', temporary: true, provider: inline.provider || parent.provider || 'claude', model: inline.model || (inline.provider ? '' : parent.model) || 'default', body: inline.body || '', extra: { ...(inline.tools ? { dispatch_mcp: String(inline.tools) } : {}), ...(inline.autoApprove ? { dispatch_approve: 'auto' } : {}) } };
        } else {
          const candidates = msg.from === 'boss' ? bossVisibleTemplates() : templates.list(workspace);
          const auto = templateName.endsWith('+auto-approve'), tplName = auto ? templateName.slice(0, -'+auto-approve'.length) : templateName;
          template = candidates.find(t => t.name === tplName);
          if (template && auto) template = { ...template, extra: { ...(template.extra || {}), dispatch_approve: 'auto' } };
        }
        if (!template) throw new Error(`Template ${templateName} not found`);
        const firstMember = !['boss', 'you', 'user'].includes(msg.from) && !operation?.agents.some(a => a.enlistedBy === msg.from);
        startAgent(name, template, msg.from); notify('enlisted', { name, template, enlistedBy: msg.from });
        // An agent that enlists its first member becomes a team lead: only now does it learn about schedules.
        if (firstMember && processes.has(msg.from)) void sendMessage(msg.from, `You now lead a team. ${SCHEDULE_HELP} As a team lead, a schedule you add waits until the boss approves it, and you only see your team's schedules.`, 'dispatch').catch(() => {});
        fs.unlinkSync(file); if (task.join('\n')) sendMessage(name, task.join('\n'), msg.from); return;
      }
      if (msg.to === 'orchestrator' && msg.kind === 'schedule') {
        fs.unlinkSync(file); handleSchedule(msg); return;
      }
      if (msg.to === 'orchestrator' && msg.kind === 'telegram') {
        fs.unlinkSync(file); void handleTelegram(msg); return;
      }
      if (msg.to === 'orchestrator' && ['kill', 'stop', 'restart'].includes(msg.kind)) {
        agentAction(msg.text, msg.kind === 'kill' ? 'dismiss' : msg.kind);
        fs.unlinkSync(file); return;
      }
      const recorded = recordMessage(msg); notify('message', recorded);
      if (msg.kind === 'ask-wait') pendingAsks.add(msg.id);
      if (msg.reply_to && pendingAsks.delete(msg.reply_to)) return;
      if (msg.to === 'you' || msg.to === 'user') { const from = processes.get(msg.from); if (from) from.toldYou = true; tgForward(msg); fs.unlinkSync(file); return; }
      const agent = processes.get(msg.to);
      if (!agent) {
        // Without a loaded roster (launch) agents are not started yet: keep the file and stay quiet.
        const saved = operation?.agents.find(a => a.name === msg.to);
        if (!operation) return;
        if (!saved) { fs.unlinkSync(file); feedback(msg, `Agent ${msg.to} does not exist. Squad: ${operation.agents.map(a => a.name).join(', ') || 'none'}.`); }
        else if (saved.stopped) feedback(msg, `${msg.to} is stopped. Your message is waiting; dispatch restart ${msg.to} starts it.`);
        return;
      }
      if (!agent.queue.some(item => item.file === file)) agent.queue.push({ msg, file });
      deliver(agent);
    } catch (error) {
      console.error(error);
      if (msg?.to === 'orchestrator') { try { fs.unlinkSync(file); } catch {} feedback(msg, `${msg.kind}${['spawn', 'kill', 'stop', 'restart'].includes(msg.kind) ? ' ' + String(msg.text).split('\n')[0].trim() : ''} failed: ${error.message}`); }
    }
  });
}
function deliver(agent) {
  if (agent.submitting || agent.blocked || !agent.ready) return;
  clearTimeout(agent.timer);
  if (!agent.queue.length) return;
  if (agent.command === 'codex' && agent.codexStateKnown && !agent.atPrompt) return;
  // Claude takes a message typed mid-turn and hands it to the model at its next step, so never wait for the turn
  // to end (its spinner keeps the output busy, which held every message until the turn finished).
  const midTurn = agent.command === 'claude';
  const delay = agent.atPrompt || midTurn ? 0 : Math.max(0, 1500 - (Date.now() - agent.lastOutput));
  agent.timer = setTimeout(() => {
    const item = agent.queue.shift(); if (!item) return; agent.inFlight = item;
    agent.atPrompt = false;
    const text = `[Dispatch] message from ${item.msg.from} (id ${item.msg.id})${item.previous ? ' (from previous chat)' : ''}: ${item.msg.text}`;
    agent.submitting = true; agent.lastFrom = item.msg.from;
    // It now owes whoever wrote a reply; the watchdog below speaks up if it goes quiet without one.
    if (item.msg.from !== 'dispatch') agent.owes = { to: item.msg.from, at: Date.now() };
    const wasIdle = !agent.turn, pastedAt = Date.now();
    try { agent.terminal.write(`\x1b[200~${text}\x1b[201~`); } catch {}
    // Press Enter only after the CLI has taken the whole paste in (its echo went quiet). A fixed 200 ms was too
    // early for long messages: the Enter landed inside the paste and the text sat in the prompt, never sent.
    const submit = () => {
      const age = Date.now() - pastedAt;
      if (age < (midTurn && !wasIdle ? 800 : 3000) && (age < 350 || Date.now() - agent.lastOutput < 300)) { agent.timer = setTimeout(submit, 100); return; }
      try { agent.terminal.write('\r'); } catch {}
      agent.submitting = false; agent.inFlight = null;
      try { fs.unlinkSync(item.file); } catch {}
      confirmSubmit(agent, pastedAt, wasIdle, 0);
      if (agent.queue.length) deliver(agent);
    };
    agent.timer = setTimeout(submit, 350);
  }, delay);
}
// Claude and Codex record every turn they start. If none started a few seconds after Enter, the text is still
// sitting in the prompt: press Enter again (an empty prompt ignores it).
function confirmSubmit(agent, pastedAt, wasIdle, tries) {
  if (demo || !wasIdle || !agent.tracksTurns || tries >= 3) return;
  setTimeout(() => {
    if (![...processes.values()].includes(agent) || agent.blocked || agent.submitting || (agent.turnAt || 0) >= pastedAt) return;
    try { agent.terminal.write('\r'); } catch {}
    confirmSubmit(agent, pastedAt, wasIdle, tries + 1);
  }, 4000);
}
// Tell a message's sender what went wrong. Never loops: dispatch/scheduler/orchestrator senders get nothing, failures are swallowed.
const notified = new Set();
const exited = new Set(); // agents that died with nobody to tell; shown to the user until restarted or dismissed
function feedback(msg, text) {
  try {
    if (['dispatch', 'scheduler', 'orchestrator'].includes(msg.from) || notified.has(msg.id + text)) return;
    notified.add(msg.id + text);
    if (msg.kind !== 'ask-wait' && (msg.from === 'you' || msg.from === 'user')) { notify('message', recordMessage({ id: crypto.randomUUID(), from: 'dispatch', to: msg.from, text, kind: 'send', time: new Date().toISOString() })); return; }
    // An ask --wait CLI polls for a reply to its message id, so answer it as a reply or it hangs forever.
    if (msg.kind === 'ask-wait') void sendMessage(msg.from, text, 'dispatch', msg.id).catch(() => {});
    else if (processes.has(msg.from)) void sendMessage(msg.from, text, 'dispatch').catch(() => {});
  } catch (error) { console.error(error); }
}
function sendMessage(to, text, from = 'you', replyTo = '') {
  return new Promise((resolve, reject) => execFile(bin(), replyTo ? ['reply', '--from', from, '--to', to, '--reply-to', replyTo, text] : ['send', '--from', from, '--to', to, text], { cwd: workspace, env: { ...process.env, DISPATCH_HOME: path.join(workspace, '.dispatch'), MYARMY_HOME: path.join(workspace, '.dispatch') } }, (error, _stdout, stderr) => error ? reject(new Error(`dispatch send failed: ${stderr.trim() || error.message}`)) : resolve(true)));
}
function agentAction(name, action) {
  const saved = operation?.agents.find(a => a.name === name);
  if (!saved) throw new Error('Agent not found');
  if (action === 'dismiss' && name === 'boss') throw new Error('The boss cannot be dismissed');
  const agent = processes.get(name);
  if (action === 'stop' || action === 'dismiss') {
    if (agent) { clearTimeout(agent.timer); setAttention(name, agent, null); processes.delete(name); agent.terminal.kill(); }
    if (action === 'dismiss') {
      if (exited.delete(name)) notify('attention', { name, reason: null });
      operation.agents = operation.agents.filter(a => a !== saved);
      const inbox = path.join(workspace, '.dispatch', 'inbox', name);
      fs.rmSync(inbox, { recursive: true, force: true });
    } else saved.stopped = true;
  } else if (action === 'restart') {
    if (agent) { clearTimeout(agent.timer); setAttention(name, agent, null); processes.delete(name); agent.terminal.kill(); }
    startAgent(name, saved.template, saved.enlistedBy, saved); saved.stopped = false;
  } else throw new Error('Unknown action');
  saveOperation();
  fs.writeFileSync(path.join(workspace, '.dispatch', 'agents.json'), JSON.stringify(operation.agents.map(a => a.name)));
  notify('agent-action', { name, action });
  return true;
}
function startAgent(name, template, enlistedBy, saved, resumeSession = true) {
  if (!operation) newOperation();
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || processes.has(name)) throw new Error('Invalid or duplicate agent name');
  if (exited.delete(name)) notify('attention', { name, reason: null });
  const provider = template.provider;
  const localProvider = provider === 'local' || provider.startsWith('local:');
  const localModel = provider.startsWith('local:') ? decodeURIComponent(provider.slice(6)) : template.model;
  const command = provider === 'antigravity' ? 'agy' : provider === 'qoder' ? 'qodercli' : localProvider ? 'opencode' : provider;
  const localConfig = localProvider ? localAI.read(localModel) : null;
  if (provider === 'local' && !localConfig) throw new Error('Configure Local AI in Providers first.');
  // Dispatch memory belongs to the boss alone; sub-agents get facts from the boss in their task.
  const mem = name === 'boss' ? memoryStore() : null;
  const mcpConfig = mcp.configure(localProvider ? 'local' : provider, template, demo ? cmd => ({ file: cmd, args: [] }) : resolveCommand, localConfig ? localAI.envConfig(localConfig) : null, { memory: !!mem && mem.active().length > 0, servers: serverStore().list().some(s => s.access !== 'off'), agent: name });
  const memoryOn = mcpConfig.ids.includes('memory');
  const memoryText = memoryOn ? (mem.settings().autoInject ? mem.overview().text : '') + `\nDispatch memory is on (${mem.active().join(' + ')}${mem.settings().bossCanWrite ? '' : ', read-only'}). Use the memory_* tools from the dispatch_memory server for all long-term memory, never your own built-in memory or memory files.` : '';
  const providerSettings = bossProviders();
  const providerInfo = [...providersLib.PROVIDERS.map(p => ({ id: p.id, name: p.name })), { id: 'local', name: 'Local AI' }].filter(p => providerEnabled(p.id)).map(p => { const settings = providerSettings[p.id] || {}; return `${p.name} (${p.id})${settings.plan && settings.plan !== 'unknown' ? ' · ' + settings.plan : ''}${settings.note ? ' · ' + settings.note : ''}`; }).join('\n');
  // Claude and Codex keep a transcript Dispatch can read, so their own replies go to the chat as written.
  const direct = !demo && ['claude', 'codex'].includes(provider);
  const catalogue = bossVisibleTemplates().map(t => `${t.name}: ${t.description} (${t.provider}, ${t.model || 'default'}; Dispatch tools: ${mcp.selected(t).join(', ') || 'none'})`).join('\n');
  const prompt = `${template.body || ''}\nA workspace symbol index is available: run dispatch index search <name> to locate functions and types with file paths and line numbers before opening targeted code. The index may lag recent edits; verify source files.\nYou are ${name}. You report to ${name === 'boss' ? 'you (the user)' : enlistedBy && enlistedBy !== 'user' ? enlistedBy : 'boss'}. Squad: ${[...new Set([...operation.agents.map(a => a.name), ...rosterHint, name])].map(n => `${n} (${operation.agents.find(a => a.name === n)?.stopped ? 'stopped' : processes.has(n) || n === name ? 'running' : 'starting'})`).join(', ')}. ${direct
    ? `The user reads your replies in the Dispatch chat exactly as you write them here, rendered as Markdown. ${name === 'boss' ? 'To talk to the user' : 'When a message is from you (the user)'}, simply write your answer as your normal final reply: use short paragraphs, headings, lists, tables and code blocks where they help. Never run dispatch send --to you; that would show the user a second, unformatted copy. Use dispatch send only for other agents: when another agent gave you the task or you need its input, report with dispatch send --to <agent> "<report>".`
    : `When you finish a task or need input, report to the requester using dispatch send --to <requester> "<short report>". For a message from you, run dispatch send --to you "<short report>"; for a message from another agent, use that agent's name.`} A message with line breaks, quotes or backticks gets cut by the shell: write it to a file and send it with dispatch send --to <agent> --file <path> (dispatch spawn takes --task-file <path> the same way). Keep reports to other agents short. Use dispatch list to see the squad.${name === 'boss' ? `\nAvailable providers (plan and notes are supplied by the user):\n${providerInfo}\nTemplate catalogue:\n${catalogue}\nUse dispatch spawn --template <name> --name <id> --task <task> and dispatch template create --name <name> --provider <provider> --description <description> --role <prompt>.\n${SCHEDULE_HELP}${telegramHelp()}` : (tgOwner() === name ? telegramHelp(name) : '')}\nShared outputs: save every finished deliverable (images, video, audio, documents, exports) in ${path.join(workspace, '.dispatch', 'outputs', name)} so the user and the other agents can find it. Run dispatch outputs [agent] to see what the squad has produced and reuse those files by path.${memoryText}`;
  if (!saved) { saved = { name, template, provider, model: template.model || '', enlistedBy }; operation.agents.push(saved); createChat(saved); resumeSession = false; } else if (!saved.chatId) { const previousSession = saved.sessionId; const chat = createChat(saved); if (previousSession) { chat.sessionId = previousSession; saved.sessionId = previousSession; writeChat(name, chat); saveOperation(); } }
  const session = saved.sessionId;
  // Claude can only resume a session it has written down. An agent that never got a message has none yet
  // (a team member without a task, a fresh chat): resuming it fails with "No conversation found" and the agent dies.
  if (provider === 'claude' && resumeSession && !demo && !fs.existsSync(activity.claudeFile(workspace, session))) resumeSession = false;
  const args = [...mcpConfig.args];
  // Auto-approve (template "Approvals: Auto", or dispatch spawn --auto-approve): the CLI runs commands without
  // stopping for a yes/no in a terminal nobody watches. Only for CLIs with a known flag.
  if (!localProvider && autoApprove(template)) args.push(...(APPROVE_FLAGS[provider] || []));
  // Antigravity's terminal sandbox blocks writes into .dispatch (dispatch send fails with "access denied") and
  // localhost (Unreal/Blender MCP), so its reports never arrived. Session-only settings; the user's file is untouched.
  if (provider === 'antigravity' && !demo) {
    const file = path.join(workspace, '.dispatch', 'antigravity-session.json');
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ enableTerminalSandbox: false })); args.push('--settings', file); } catch {}
  }
  // The shared Codex daemon may run in another workspace with a different
  // environment. Each Dispatch agent needs its own bus and identity.
  if (provider === 'codex') args.push('--no-daemon');
  if (provider === 'codex' && resumeSession && saved?.sessionId) args.push('resume', saved.sessionId);
  if (localProvider) args.push('--model', `dispatch-local/${localConfig.model}`);
  else if (template.model && template.model !== 'default') args.push(provider === 'codex' ? '-m' : '--model', template.model);
  // Reasoning effort, only for CLIs that take it and only for a level that CLI knows.
  const effort = !localProvider && template.effort && (providersLib.EFFORTS[provider] || []).includes(template.effort) ? template.effort : '';
  if (effort) {
    if (provider === 'codex') args.push('-c', `model_reasoning_effort=${effort}`);
    else if (provider === 'qoder') args.push('--reasoning-effort', effort);
    else args.push('--effort', effort);
  }
  // Dispatch skills are Claude Code plugins: the boss always gets them, other Claude agents only if the user chose so.
  if (provider === 'claude' && !demo) { const sk = skillStore(); if (name === 'boss' || sk.settings().claudeAgents) for (const dir of sk.pluginDirs()) args.push('--plugin-dir', dir); }
  if (provider === 'claude') args.push('--append-system-prompt', prompt, resumeSession ? '--resume' : '--session-id', session);
  const resolved = demo ? null : resolveCommand(command);
  const terminal = demo ? createDemoTerminal(name, workspace, bin()) : pty.spawn(resolved.file, [...resolved.args, ...args], { name: 'xterm-256color', cols: 100, rows: 30, cwd: workspace, env: { ...process.env, ...mcpConfig.env, ...(memoryOn && provider === 'claude' && mem.settings().disableProviderMemory ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } : {}), DISPATCH_INDEX_INFO: codeIndexInfo || '', DISPATCH_AGENT: name, MYARMY_AGENT: name, DISPATCH_HOME: path.join(workspace, '.dispatch'), MYARMY_HOME: path.join(workspace, '.dispatch'), PATH: `${path.dirname(bin())}${path.delimiter}${process.env.PATH}` } });
  const agent = { terminal, queue: [], output: '', lastOutput: Date.now(), atPrompt: false, template, session, enlistedBy, command, args, prompt, tracksTurns: direct }; processes.set(name, agent);
  // Transcript: live thinking, tool steps and interim text for the chat, the real turn state, and the reply itself.
  if (!demo) agent.stopActivity = activity.watch({ provider, cwd: workspace, session, onSession: id => { if (saved && !saved.sessionId) { saved.sessionId = id; agent.session = id; saveOperation(); } }, onEvent: e => {
    if (processes.get(name) !== agent) return;
    agent.eventAt = Date.now();
    if (e.turn === true) { agent.turn = true; agent.turnKnown = true; agent.toldYou = false; agent.turnAt = Date.now(); agent.lastText = ''; }
    const said = e.steps.filter(s => s.kind === 'text').at(-1); if (said) agent.lastText = said.text;
    let dropLastText = false;
    if (e.turn === false) {
      agent.turn = false; agent.turnKnown = true;
      // The reply the agent wrote in its terminal is the chat message, formatting intact. The boss always talks to
      // the user; another agent does when the user was the one who wrote to it.
      const forYou = name === 'boss' || ['you', 'user'].includes(agent.lastFrom);
      if (direct && e.final && forYou && !agent.toldYou) { dropLastText = agent.lastText === e.final; emitMessage({ from: name, to: 'you', text: e.final }); }
      // Other CLIs (Antigravity) must report with dispatch send, and often end the turn without doing it (or the
      // send fails). Their final reply is in the transcript: pass it on to whoever is waiting, if nothing came.
      if (!direct && e.final && agent.owes) {
        const owes = agent.owes, final = e.final;
        setTimeout(() => {
          // Went on working (it was only waiting on a command): that text was not the end; the real one comes later.
          if (agent.owes !== owes || processes.get(name) !== agent || agent.turn) return;
          agent.owes = null;
          const text = `${final}\n\n(Dispatch: ${name} ended its turn without sending this; forwarded from its transcript.)`;
          if (['you', 'user'].includes(owes.to) || !processes.has(owes.to)) emitMessage({ from: name, to: 'you', text }); else void sendMessage(owes.to, text, name).catch(() => {});
        }, 6000);
      }
    }
    notify('activity', { name, steps: e.steps, turn: e.turn, dropLastText });
  } });
  // Messages received while stopped remain on disk; the watcher only emits an
  // add event once, so collect them again when this agent starts.
  const inbox = path.join(workspace, '.dispatch', 'inbox', name);
  try {
    for (const file of fs.readdirSync(inbox).filter(f => f.endsWith('.json')).sort()) {
      const full = path.join(inbox, file);
      const msg = parseMessage(fs.readFileSync(full, 'utf8'));
      if (msg) agent.queue.push({ msg, file: full });
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.writeFileSync(path.join(workspace, '.dispatch', 'agents.json'), JSON.stringify([...processes.keys()]));
  terminal.onData(data => { agent.output = (agent.output + data).slice(-200000);
    agent.promptBuffer = ((agent.promptBuffer || '') + data).slice(-5000);
    // A choice the CLI wants that has one safe answer (Codex: keep the model when the limit is near).
    const nudge = nudgeAnswer(provider, agent.promptBuffer);
    if (nudge && Date.now() - (agent.nudgedAt || 0) > 5000) { agent.nudgedAt = Date.now(); setTimeout(() => { if (processes.get(name) !== agent) return; agent.promptBuffer = ''; try { terminal.write(nudge); } catch {} }, 700); }
    const detected = attentionFrom(agent.promptBuffer);
    // Out of quota: the agent will not answer anyone. Say so to whoever gave it work, once, instead of letting them wait.
    if (detected === 'Limit reached' && !agent.limitTold) {
      agent.limitTold = true;
      const lead = name === 'boss' ? null : agent.enlistedBy && processes.has(agent.enlistedBy) ? agent.enlistedBy : processes.has('boss') ? 'boss' : null;
      const note = `${name} (${provider}) has hit its provider's usage limit and cannot work until the limit resets.`;
      if (lead) void sendMessage(lead, `${note} Give its task to an agent on another provider.`, 'dispatch').catch(() => {});
      else emitMessage({ from: 'dispatch', to: 'you', text: `${note} Its terminal shows when it resets.` });
    }
    // Not signed in: the CLI waits for a browser login (or quits) inside a terminal nobody is looking at. Tell the user and the lead once.
    // Waiting for a command approval: the lead would otherwise think the agent is still working. Tell it once per prompt.
    if (detected === 'Approve command' && !agent.awaitingAnswer && name !== 'boss') {
      const lead = agent.enlistedBy && processes.has(agent.enlistedBy) ? agent.enlistedBy : processes.has('boss') ? 'boss' : null;
      if (lead && lead !== name) void sendMessage(lead, `${name} (${provider}) is paused, waiting for the user to approve a command in its terminal. If this keeps happening, recreate it with auto-approve: dispatch spawn ... --auto-approve, or dispatch template create ... --auto-approve.`, 'dispatch').catch(() => {});
    }
    if (detected === 'Sign in' && !agent.signinTold) { agent.signinTold = true; tellSignIn(name, agent, provider, false); }
    // The prompt is gone from the screen (answered here, in the terminal, or by the CLI itself): the agent is free
    // again. Without this one "needs you" stuck for good and every later message waited in the queue.
    if (!detected && (agent.awaitingAnswer || agent.attention)) { agent.awaitingAnswer = false; setAttention(name, agent, null); if (!agent.ready) setTimeout(agent.initialize, 1000); else if (agent.queue.length) deliver(agent); }
    if (detected && !agent.awaitingAnswer) { setAttention(name, agent, detected); if (detected === 'Trust folder' && trusted()) answerTrust(agent); }
    agent.lastOutput = Date.now(); const codexState = [...data.matchAll(/\x1b\]7501;state=(idle|working|done):app=codex/g)].at(-1); if (codexState) { agent.codexStateKnown = true; agent.atPrompt = codexState[1] !== 'working'; if (codexState[1] === 'working') agent.turnAt = Date.now(); } else if (provider !== 'codex') agent.atPrompt = /(?:^|[\r\n])\s*[>\u276f$]\s*$/.test(agent.output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')); if (agent.queue.length && (provider !== 'codex' || agent.atPrompt)) deliver(agent); notify('terminal', { name, data }); });
  terminal.onExit(() => { agent.stopActivity?.(); if (processes.get(name) === agent) {
    processes.delete(name); clearTimeout(agent.timer); setAttention(name, agent, null); notify('exit', name);
    // Died on its own: mark it stopped (card shows it) and tell whoever enlisted it.
    const entry = operation?.agents.find(a => a.name === name);
    if (entry) { entry.stopped = true; saveOperation(); notify('agent-action', { name, action: 'stop' }); }
    const lead = name === 'boss' ? null : agent.enlistedBy && !['you', 'user'].includes(agent.enlistedBy) && processes.has(agent.enlistedBy) ? agent.enlistedBy : 'boss';
    // Quit because it is not signed in (Antigravity does this): say exactly that, not just "exited".
    if (!agent.signinTold && (attentionFrom(String(agent.output || '').slice(-8000)) === 'Sign in' || (provider === 'antigravity' && /not logged into antigravity/i.test(String(agent.output || ''))))) { agent.signinTold = true; tellSignIn(name, agent, provider, true); return; }
    // Nobody can be told (the boss itself died, or the boss is down too): show it to the user in the attention bar and chat.
    if (!lead || !processes.has(lead)) { exited.add(name); notify('attention', { name, reason: 'Exited' }); notify('message', recordMessage({ id: crypto.randomUUID(), from: 'dispatch', to: 'you', text: `${name} exited unexpectedly. Restart it from the bar at the top.`, kind: 'send', time: new Date().toISOString() })); }
    else if (lead !== name) void sendMessage(lead, `${name} exited unexpectedly. dispatch restart ${name} brings it back.`, 'dispatch').catch(() => {});
  } });
  const initialize = () => {
    if (agent.blocked || processes.get(name) !== agent) return;
    if (!demo && provider !== 'claude') {
      terminal.write(`\x1b[200~${prompt.replace(/\n/g, ' ')}\x1b[201~`);
      agent.timer = setTimeout(() => { terminal.write('\r'); agent.ready = true; if (agent.queue.length) deliver(agent); }, 200);
    } else { agent.ready = true; if (agent.queue.length) deliver(agent); }
  };
  agent.initialize = initialize;
  setTimeout(initialize, 2000);
  return agent;
}
app.setName('Dispatch');
if (process.platform === 'win32') app.setAppUserModelId('com.dispatch.desktop');
const iconPath = () => path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'icon-256.png');
let tray, trayWin, trayPlace, quitting = false;
// Watchdog: an agent that got a task, then went quiet (idle at its prompt, or no terminal output for minutes)
// without sending a single message back. Its requester would wait forever, so tell the requester (or the user).
const QUIET_IDLE = 60000, QUIET_ANY = 4 * 60000;
setInterval(() => {
  for (const [name, agent] of processes) {
    const owes = agent.owes; if (!owes || agent.attention || name === 'boss' && owes.to === 'you' && ['claude', 'codex'].includes(agent.command)) continue;
    const silent = Date.now() - (agent.lastOutput || owes.at);
    if (Date.now() - owes.at < QUIET_IDLE || !(agent.atPrompt ? silent > QUIET_IDLE : silent > QUIET_ANY)) continue;
    agent.owes = null;
    const tail = String(agent.output || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-6).join(' | ').slice(-500);
    const note = `${name} stopped working without reporting back (${agent.atPrompt ? 'idle at its prompt' : `no output for ${Math.round(silent / 60000)} min`}). Last lines in its terminal: ${tail || '(none)'}`;
    const to = owes.to === 'you' || owes.to === 'user' || !processes.has(owes.to) ? null : owes.to;
    if (to) void sendMessage(to, `${note}\nAsk it for a status with dispatch send --to ${name}, or restart it with dispatch restart ${name}.`, 'dispatch').catch(() => {});
    else emitMessage({ from: 'dispatch', to: 'you', text: note });
  }
}, 20000).unref?.();
const APPROVE_FLAGS ={ claude: ['--dangerously-skip-permissions'], codex: ['--dangerously-bypass-approvals-and-sandbox'], antigravity: ['--dangerously-skip-permissions'], gemini: ['--yolo'] };
const autoApprove = t => String(t?.extra?.dispatch_approve || '').toLowerCase() === 'auto';
// An agent's CLI is not signed in. The user must sign in once (Providers > Sign in); the boss/lead should not wait for it.
function tellSignIn(name, agent, provider, quit) {
  const label = providersLib.PROVIDERS.find(p => p.id === provider)?.name || provider;
  const what = quit ? `${name} stopped: ${label} is not signed in.` : `${name} is waiting for a ${label} sign-in.`;
  emitMessage({ from: 'dispatch', to: 'you', text: `${what} Open Providers and press Sign in next to ${label} (a browser window opens), then restart ${name}.` });
  notify('attention', { name, reason: 'Sign in' });
  const lead = name === 'boss' ? null : agent.enlistedBy && processes.has(agent.enlistedBy) ? agent.enlistedBy : processes.has('boss') ? 'boss' : null;
  if (lead && lead !== name) void sendMessage(lead, `${what} The user has to sign in to ${label}; do not wait for ${name}. Give its task to an agent on another provider, or wait until the user signs in and run dispatch restart ${name}.`, 'dispatch').catch(() => {});
}
function createTray() {
  const { Tray, nativeImage, screen } = require('electron');
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'tray.png')));
  tray.setToolTip('Dispatch');
  // Custom right-click menu: one hidden, reused window (opens instantly), placed next to the tray icon.
  trayWin = new BrowserWindow({ width: 280, height: 300, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'tray-preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  void trayWin.loadFile(path.join(__dirname, 'tray-menu.html'));
  // Blur fires when the right-click itself lands on the tray icon; ignore it for a moment so the menu is not hidden right after opening.
  trayWin.on('blur', () => { if (Date.now() - (trayWin.shownAt || 0) > 300) trayWin.hide(); });
  trayWin.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); trayWin.hide(); } });
  trayPlace = height => {
    const b = tray.getBounds(), wa = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea, w = 280, h = Math.min(Math.max(height, 80), wa.height);
    trayWin.setBounds({ x: Math.round(Math.min(Math.max(b.x + b.width / 2 - w / 2, wa.x), wa.x + wa.width - w)), y: Math.round(Math.min(Math.max(b.y < wa.y + wa.height / 2 ? b.y + b.height : b.y - h, wa.y), wa.y + wa.height - h)), width: w, height: h });
    trayWin.shownAt = Date.now(); trayWin.show(); trayWin.focus();
  };
  tray.on('right-click', () => trayWin.webContents.send('tray:state', { icon: nativeImage.createFromPath(iconPath()).resize({ width: 44 }).toDataURL(), folder: path.basename(workspace) || workspace, running: processes.size, attention: [...processes.values()].filter(a => a.attention).length, recent: recentWorkspaces().filter(w => w !== workspace && !path.resolve(w).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()) && fs.existsSync(w)).slice(0, 5).map(w => ({ name: path.basename(w) || w, path: w })) }));
  ipcMain.on('tray:ready', (_e, height) => trayPlace(Number(height) || 300));
  ipcMain.on('tray:action', (_e, action, arg) => {
    trayWin.hide();
    if (action === 'quit') { quitting = true; return app.quit(); }
    if (!win || win.isDestroyed() || action === 'hide') return;
    revealWin();
    if (action === 'view') win.webContents.send('tray-nav', { view: String(arg) }); else if (action === 'workspace') win.webContents.send('tray-nav', { workspace: String(arg) });
  });
  // Click always brings the window back (no toggle): a double click used to show then hide it again.
  tray.on('click', revealWin);
  tray.on('double-click', revealWin);
}
// show() alone does not undo a minimize on Windows, so restore first.
function revealWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
app.whenReady().then(() => {
  if (process.env.DISPATCH_TEST_HOME) process.env.USERPROFILE = process.env.DISPATCH_TEST_HOME;
  storage.migrate(process.env.DISPATCH_HOME || os.homedir());
  win = new BrowserWindow({ title: 'Dispatch', icon: iconPath(), width: 1280, height: 800, minWidth: 800, minHeight: 560, backgroundColor: '#14213a', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 12 } } : { titleBarOverlay: { color: '#131417', symbolColor: '#a3a6ad', height: 43 } }), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  remote.attach(win, globalDir(), require('electron'));
  createTray();
  registerVoiceKey();
  // The close button keeps Dispatch (and its agents) running in the tray; Quit in the tray menu ends it.
  win.on('close', e => { if (!quitting && tray && !process.env.DISPATCH_TEST_HOME) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL); else win.loadFile(path.join(__dirname, '../dist/index.html'));
  const last = recentWorkspaces().find(w => { try { return fs.statSync(w).isDirectory(); } catch { return false; } });
  if (last) workspace = last;
  rememberWorkspace(); watch();
});
ipcMain.handle('workspace', async (_e, target) => { if (!target) { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (r.canceled) return workspace; target = r.filePaths[0]; } if (!fs.statSync(target).isDirectory()) throw new Error('Workspace is not a directory'); switchWorkspace(target); return workspace; });
function switchWorkspace(target) { if (path.resolve(target) !== path.resolve(workspace)) { finishOperation(); stopAgents(); if (isMock(workspace) && !isMock(target)) { demo = process.argv.includes('--demo'); mockPrevious = null; } workspace = path.resolve(target); rememberWorkspace(); watch(); } }
ipcMain.handle('info', () => ({ workspace, demo, mock: isMock(workspace), operations: listOperations(), workspaces: recentWorkspaces() }));
ipcMain.handle('operations:list', () => listOperations());
ipcMain.handle('operations:delete', (_e, id) => { if (!/^[\w-]+$/.test(id)) throw new Error('Invalid operation'); if (operation?.id === id) { stopAgents(); operation = null; } fs.unlinkSync(path.join(operationsDir(), id + '.json')); fs.rmSync(path.join(operationsDir(), id), { recursive: true, force: true }); return listOperations(); });
ipcMain.handle('operations:resume', (_e, id) => { const op = listOperations().find(o => o.id === id); if (!op) throw new Error('Operation not found'); finishOperation(); stopAgents(); const messages = history(op); for (const a of op.agents) { if (a.name !== 'boss' && a.chatId) for (const m of messages) if (m.from === a.name || m.to === a.name) (m.chats ||= {})[a.name] = 'previous'; const dir = path.join(operationsDir(), op.id, 'chats', a.name); try { for (const file of fs.readdirSync(dir)) { if (a.name !== 'boss' && file !== a.chatId + '.json') continue; const chat = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); for (const item of chat.messages) { const m = messages.find(x => x.id === item.id); if (m) (m.chats ||= {})[a.name] = chat.id; } } } catch {} } if (op.segments?.length && op.segments.at(-1).end == null) op.segments.at(-1).end = logSize(); op.segments ||= []; op.segments.push({ start: logSize(), end: null }); operation = op; saveOperation(); try { for (const a of op.agents) if (!a.stopped) startAgent(a.name, a.template, a.enlistedBy, a); } catch (e) { stopAgents(); finishOperation(); throw e; } return { operation: op, messages, notes: op.agents.filter(a => !a.stopped && a.provider !== 'claude' && !(a.provider === 'codex' && a.sessionId)).map(a => ({ name: a.name, text: `${a.name}: started a fresh ${a.provider} session; prior conversation is shown in chat.` })) }; });
const templates = require('./templates.cjs');
ipcMain.handle('chats:list', (_e, name) => chats(name).filter(c => name === 'boss' || c.id === operation?.agents.find(a => a.name === name)?.chatId).map(c => ({ ...c, active: c.id === operation?.agents.find(a => a.name === name)?.chatId })));
ipcMain.handle('chats:switch', (_e, name, id) => switchChat(name, id));
const providersLib = require('./providers.cjs');
const tools = require('./tools.cjs');
const unreal = require('./unreal.cjs');
mcp.setRemoteUrl(id => id === 'unreal' ? unreal.url() : '');
ipcMain.handle('boss-providers:get', () => bossProviders());
ipcMain.handle('boss-providers:set', (_e, data) => {
  const allowed = new Set([...providersLib.PROVIDERS.map(p => p.id), 'local']);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid provider settings');
  const clean = {};
  for (const [id, value] of Object.entries(data)) {
    if (!allowed.has(id) || !value || typeof value !== 'object' || !['unknown', 'free', 'paid'].includes(value.plan || 'unknown') || typeof value.note !== 'string' || value.note.length > 500 || typeof value.enabled !== 'boolean') throw new Error('Invalid provider settings');
    clean[id] = { enabled: value.enabled, plan: value.plan || 'unknown', note: value.note };
  }
  fs.mkdirSync(path.dirname(bossProviderFile()), { recursive: true }); fs.writeFileSync(bossProviderFile(), JSON.stringify(clean, null, 2)); return true;
});
ipcMain.handle('templates:visibility:get', () => { try { const value = JSON.parse(fs.readFileSync(visibilityFile(), 'utf8')); return Array.isArray(value) ? value : null; } catch { return null; } });
ipcMain.handle('templates:visibility:set', (_e, files) => {
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) throw new Error('Invalid template selection');
  fs.mkdirSync(path.dirname(visibilityFile()), { recursive: true });
  fs.writeFileSync(visibilityFile(), JSON.stringify([...new Set(files)], null, 2));
  return true;
});
ipcMain.handle('mcp:status', () => Object.fromEntries(Object.entries(mcp.PRESETS).map(([id, preset]) => { if (preset.remote) return [id, id === 'unreal' ? !!unreal.config().engine : true]; if (preset.builtin) return [id, id === 'blender' ? !!require('./blender.cjs').exe() : id === 'comfyui' ? !!tools.comfyConfig().layout : id === 'voicestudio' ? !!tools.toolFile('voicestudio') : true]; try { resolveCommand(preset.command); return [id, true]; } catch { return [id, false]; } })));
// ── Tools (ComfyUI) and their outputs ────────────────────────────
const outputsFile = () => path.join(workspace, '.dispatch', 'outputs.jsonl');
// ── Skills (Claude Code plugins managed by Dispatch) ────────────
const skillsLib = require('./skills.cjs');
const skillStore = () => skillsLib.create({ globalDir: globalDir(), projectDir: path.join(workspace, '.dispatch') });
const skillScope = s => { if (!skillsLib.SCOPES.includes(s)) throw new Error('Unknown skill scope'); return s; };
// Tiny UI preferences (office scene choice), stored in ~/.dispatch/ui.json so the renderer never touches localStorage.
const uiFile = () => path.join(globalDir(), 'ui.json');
const readUi = () => { try { return JSON.parse(fs.readFileSync(uiFile(), 'utf8')); } catch { return {}; } };
ipcMain.handle('ui:get', () => readUi());
// ── Voice typing: local whisper.cpp, an in-chat mic and a global shortcut with a small overlay (FoneCue style) ──
const whisper = require('./whisper.cjs');
const VOICE_KEYS = ['Control+Alt+Space', 'Control+Shift+Space', 'Control+Alt+D', 'F9'];
const voiceLang = () => readUi().voiceLang || 'tr';
const voiceKey = () => VOICE_KEYS.includes(readUi().voiceShortcut) ? readUi().voiceShortcut : VOICE_KEYS[0];
ipcMain.handle('voice:status', () => ({ ...whisper.status(), lang: voiceLang(), mic: readUi().voiceMic || '', shortcut: voiceKey(), shortcuts: VOICE_KEYS, shortcutOk: voiceKeyOk }));
ipcMain.handle('voice:warm', () => whisper.ensure(voiceLang()).then(() => true));
ipcMain.handle('voice:transcribe', (_e, wav) => whisper.transcribe(Buffer.from(wav), voiceLang()));
let overlay = null, overlayOn = false, voiceKeyOk = false;
function overlayWindow() {
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({ width: 120, height: 36, show: false, frame: false, transparent: true, hasShadow: false, alwaysOnTop: true, focusable: true, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  if (process.env.VITE_DEV_SERVER_URL) void overlay.loadURL(process.env.VITE_DEV_SERVER_URL + '#overlay'); else void overlay.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'overlay' });
  overlay.on('closed', () => { overlay = null; overlayOn = false; });
  return overlay;
}
function showOverlay() {
  const { screen } = require('electron');
  const o = overlayWindow();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  o.setBounds({ x: wa.x + Math.round((wa.width - 120) / 2), y: wa.y + wa.height - 36 - 60, width: 120, height: 36 });
  o.setAlwaysOnTop(true, 'screen-saver', 1);
  // Inactive: the user keeps typing focus in whatever app they were in.
  o.showInactive(); o.moveTop(); overlayOn = true;
  const start = () => o.webContents.send('overlay-start');
  if (o.webContents.isLoading()) o.webContents.once('did-finish-load', start); else start();
}
// e2e only: press the shortcut (forceOverlay = as if another app had focus).
if (process.env.DISPATCH_TEST_HOME) global.__dispatchVoiceKey = forceOverlay => onVoiceKey(forceOverlay);
function onVoiceKey(forceOverlay = false) {
  if (!forceOverlay && win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return notify('voice-toggle', null);
  if (overlayOn && overlay && !overlay.isDestroyed()) return overlay.webContents.send('overlay-stop');
  showOverlay();
}
function registerVoiceKey() {
  const { globalShortcut } = require('electron');
  globalShortcut.unregisterAll();
  if (process.env.DISPATCH_TEST_HOME) { voiceKeyOk = true; return; }
  try { voiceKeyOk = globalShortcut.register(voiceKey(), onVoiceKey); } catch { voiceKeyOk = false; }
}
ipcMain.on('overlay:done', (_e, text) => { overlay?.hide(); overlayOn = false; if (text && String(text).trim()) notify('voice-result', String(text).trim()); });
ipcMain.on('overlay:live', (_e, text) => notify('voice-live', String(text || '')));
ipcMain.on('overlay:close', () => { overlay?.hide(); overlayOn = false; });
app.on('will-quit', () => { try { require('electron').globalShortcut.unregisterAll(); } catch {} whisper.stop(); });
ipcMain.handle('ui:set', (_e, patch) => {
  const next = { ...readUi() };
  if (patch && ['studio', 'pixel', 'office'].includes(patch.scene)) next.scene = patch.scene;
  if (patch && typeof patch.hintSeen === 'boolean') next.hintSeen = patch.hintSeen;
  if (patch && typeof patch.ideOpen === 'boolean') next.ideOpen = patch.ideOpen;
  if (patch && ['tr', 'en', 'auto'].includes(patch.voiceLang)) { if (next.voiceLang !== patch.voiceLang) whisper.stop(); next.voiceLang = patch.voiceLang; }
  if (patch && typeof patch.voiceMic === 'string' && patch.voiceMic.length <= 300) next.voiceMic = patch.voiceMic;
  if (patch && VOICE_KEYS.includes(patch.voiceShortcut)) { next.voiceShortcut = patch.voiceShortcut; setImmediate(registerVoiceKey); }
  if (patch && Number.isFinite(patch.ideWidth)) next.ideWidth = Math.max(420, Math.min(3000, Math.round(patch.ideWidth)));
  fs.mkdirSync(globalDir(), { recursive: true }); fs.writeFileSync(uiFile(), JSON.stringify(next, null, 2));
  return next;
});
ipcMain.handle('skills:list',() => ({ skills: skillStore().list(), settings: skillStore().settings(), roots: skillStore().roots }));
ipcMain.handle('skills:settings', (_e, patch) => skillStore().saveSettings({ claudeAgents: !!patch?.claudeAgents }));
// One store per preview, so the downloaded files stay until install or discard.
let skillPreviewStore = null;
ipcMain.handle('skills:preview', async (_e, input) => { skillPreviewStore = skillStore(); return skillPreviewStore.preview(String(input || '')); });
ipcMain.handle('skills:choose-folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Folder with SKILL.md' }); if (r.canceled || !r.filePaths[0]) return null; skillPreviewStore = skillStore(); return skillPreviewStore.preview(r.filePaths[0]); });
ipcMain.handle('skills:install', (_e, id, names, scope) => { if (!skillPreviewStore) throw new Error('Look the link up first.'); return skillPreviewStore.install(String(id), (names || []).map(String), skillScope(scope)); });
ipcMain.handle('skills:discard', (_e, id) => { skillPreviewStore?.discard(String(id)); return true; });
ipcMain.handle('skills:update', (_e, name, scope) => skillStore().update(String(name), skillScope(scope)));
ipcMain.handle('skills:enabled', (_e, name, scope, on) => skillStore().setEnabled(String(name), skillScope(scope), !!on));
ipcMain.handle('skills:remove', (_e, name, scope) => skillStore().remove(String(name), skillScope(scope)));
ipcMain.handle('skills:reveal', (_e, name, scope) => { const s = skillStore().list().find(x => x.name === name && x.scope === scope); if (s) shell.showItemInFolder(s.file); else { const d = skillStore().roots[skillScope(scope)]; fs.mkdirSync(d, { recursive: true }); void shell.openPath(d); } return true; });
// Skills Claude Code loads by itself (~/.claude/skills, <workspace>/.claude/skills, plugins). Delete goes to the Recycle Bin.
const userHome = () => process.env.DISPATCH_TEST_HOME || os.homedir();
const agentSkills = () => skillsLib.claudeSkills({ claudeHome: path.join(userHome(), '.claude'), codexHome: process.env.DISPATCH_TEST_HOME ? path.join(userHome(), '.codex') : (process.env.CODEX_HOME || path.join(userHome(), '.codex')), agentsHome: path.join(userHome(), '.agents'), workspace });
const claudeSkill = id => { const s = agentSkills().find(x => x.id === id); if (!s) throw new Error('Skill not found'); return s; };
ipcMain.handle('skills:claude', () => agentSkills());
ipcMain.handle('skills:claude-read', (_e, id) => fs.readFileSync(claudeSkill(String(id)).file, 'utf8'));
ipcMain.handle('skills:claude-reveal', (_e, id) => { shell.showItemInFolder(claudeSkill(String(id)).file); return true; });
ipcMain.handle('skills:claude-remove', async (_e, id) => { const s = claudeSkill(String(id)); if (!s.removable) throw new Error('Plugin skills are managed with /plugin in Claude Code.'); await shell.trashItem(s.dir); return true; });
ipcMain.handle('skills:read', (_e, name, scope) => { const s = skillStore().list().find(x => x.name === name && x.scope === scope); return s ? fs.readFileSync(s.file, 'utf8') : ''; });

// ── Schedules (boss and team leads only) ────────────────────────
const schedulesLib = require('./schedules.cjs');
const SCHEDULE_HELP = 'Schedules: for recurring or later work, run dispatch schedule add --title "<short name>" --why "<one line for the user>" --task "<the message to send>" [--to <agent>] --every <30m|2h|1d|1w> [--at HH:MM], or --at "YYYY-MM-DD HH:MM" for a single run. Dispatch sends the task to that agent on time. Manage them with dispatch schedule list|pause|resume|remove <id> (the boss also approves team leads\' schedules with dispatch schedule approve <id>). Only create one when the user asks for repeated or timed work; keep the task self-contained, since the agent may start fresh.';
const scheduleStore = () => schedulesLib.create({ dir: path.join(workspace, '.dispatch') });
function replySchedule(id, text) { const dir = path.join(workspace, '.dispatch', 'replies'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${id}.txt`), text); }
function handleSchedule(msg) {
  let req = {}; try { req = JSON.parse(msg.text); } catch {}
  try {
    const store = scheduleStore();
    const acc = schedulesLib.access(msg.from, operation?.agents || []);
    if (!acc) throw new Error('Only the boss and team leads can use schedules.');
    const mine = s => acc.role !== 'lead' || acc.team.has(s.by) || acc.team.has(s.to);
    const own = id => { const s = store.find(String(id || '')); if (!mine(s)) throw new Error(`No schedule ${id}.`); return s; };
    let out;
    if (req.action === 'list') {
      const rows = store.list().filter(mine);
      out = rows.length ? rows.map(s => `${s.id}\t${s.status}\t${s.when}\tnext ${s.next ? new Date(s.next).toLocaleString() : '-'}\tto ${s.to}\t${s.title}: ${s.why}${s.lastNote ? `\tlast: ${s.lastNote}` : ''}`).join('\n') : 'No schedules.';
    } else if (req.action === 'add') {
      const to = String(req.to || msg.from);
      if (!/^[a-zA-Z0-9_-]+$/.test(to)) throw new Error('Invalid --to agent name.');
      if (acc.role === 'lead' && !acc.team.has(to)) throw new Error('A team lead can only schedule work for itself or its own team.');
      const s = store.add(req, { by: msg.from, approved: acc.role !== 'lead' });
      out = `Saved schedule ${s.id}: ${s.title}, ${s.when}, to ${s.to}. ${s.status === 'pending' ? 'It waits for the boss to approve it.' : `Next run ${new Date(s.next).toLocaleString()}.`}`;
      if (s.status === 'pending' && processes.has('boss')) void sendMessage('boss', `${msg.from} wants a schedule: "${s.title}" (${s.when}, to ${s.to}). Why: ${s.why}. Task: ${s.task}. Approve with dispatch schedule approve ${s.id}, or remove it with dispatch schedule remove ${s.id}.`, 'dispatch').catch(() => {});
    } else if (req.action === 'approve') {
      if (acc.role === 'lead') throw new Error('Only the boss can approve schedules.');
      const s = own(req.id); if (s.status !== 'pending') throw new Error(`Schedule ${s.id} is ${s.status}, not waiting for approval.`);
      out = `Approved ${s.id}. Next run ${new Date(store.setStatus(s.id, 'active').next).toLocaleString()}.`;
    } else if (req.action === 'pause' || req.action === 'resume') {
      const s = own(req.id);
      if (s.status === 'pending') throw new Error(`Schedule ${s.id} still waits for approval.`);
      store.setStatus(s.id, req.action === 'pause' ? 'paused' : 'active'); out = `${req.action === 'pause' ? 'Paused' : 'Resumed'} ${s.id}.`;
    } else if (req.action === 'remove') { const s = own(req.id); store.remove(s.id); out = `Removed ${s.id}.`; }
    else throw new Error('Unknown schedule command.');
    replySchedule(msg.id, out); notify('schedules', store.list());
  } catch (e) { replySchedule(msg.id, `ERROR: ${e.message}`); }
}
// Every 30 s: send due tasks. A stopped target is restarted; a target outside the current operation goes to the boss.
function runSchedules() {
  // No operation open (e.g. right after launch): keep due runs waiting instead of dropping them.
  if (!operation || !operation.agents.length) return;
  let due; try { due = scheduleStore().due(); } catch { return; }
  for (const s of due) {
    let to = s.to, note;
    const saved = operation?.agents.find(a => a.name === to);
    if (!saved && operation?.agents.some(a => a.name === 'boss')) { note = `${to} was not in the operation, sent to boss`; to = 'boss'; }
    const target = operation?.agents.find(a => a.name === to);
    if (!target) { scheduleStore().note(s.id, `Skipped ${new Date().toLocaleString()}: no operation was open`); continue; }
    try { if (!processes.has(to)) agentAction(to, 'restart'); } catch {}
    void sendMessage(to, `[Schedule ${s.id} · ${s.title}${note ? ` · ${note}` : ''}] ${s.task}`, 'scheduler').then(() => scheduleStore().note(s.id, `Sent to ${to} ${new Date().toLocaleString()}`)).catch(e => scheduleStore().note(s.id, `Failed: ${e.message}`));
  }
  if (due.length) notify('schedules', scheduleStore().list());
}
setInterval(runSchedules, 30000).unref?.();
ipcMain.handle('schedules:list', () => scheduleStore().list());
ipcMain.handle('schedules:status', (_e, id, status) => { if (!['active', 'paused'].includes(status)) throw new Error('Unknown status'); scheduleStore().setStatus(String(id), status); return scheduleStore().list(); });
ipcMain.handle('schedules:remove', (_e, id) => { scheduleStore().remove(String(id)); return scheduleStore().list(); });
ipcMain.handle('schedules:run-now', (_e, id) => {
  if (!operation || !operation.agents.length) throw new Error('Open a chat with your team first; schedules run inside the open operation.');
  scheduleStore().runNow(String(id)); runSchedules(); return scheduleStore().list();
});

// ── Telegram (talk to the boss from the phone) ──────────────────
const telegram = require('./telegram.cjs').create({
  dir: globalDir(),
  log: t => console.log(t),
  onMessage: async (text, files = []) => {
    const owner = tgOwner();
    if (!operation || !operation.agents.some(a => a.name === owner)) throw new Error(`No team is open in ${path.basename(workspace)}. Start a chat with the boss in Dispatch, or /use another project.`);
    if (!processes.has(owner)) agentAction(owner, 'restart');
    tgWaiting = Date.now();
    const saved = [];
    for (const f of files) { try { saved.push(await telegram.download(f, path.join(workspace, '.dispatch', 'telegram'))); } catch (e) { saved.push(`(not received: ${e.message})`); } }
    const body = [text, saved.length ? `Files from the user (open them with your tools): ${saved.join(', ')}` : ''].filter(Boolean).join('\n');
    await sendMessage(owner, `[via Telegram, keep the answer short and plain text] ${body}`, 'you');
  },
  // /projects and /use <n|name>: one Dispatch shows one project at a time; switch it from the phone.
  onCommand: async (cmd, arg) => {
    const list = recentWorkspaces().filter(w => !isMock(w) && fs.existsSync(w)).slice(0, 15);
    const current = path.resolve(workspace).toLowerCase();
    if (cmd === 'projects' || cmd === 'where') return list.length ? `Projects (the boss of the open one answers you):\n${list.map((w, i) => `${i + 1}. ${path.basename(w)}${path.resolve(w).toLowerCase() === current ? '  ← open' : ''}`).join('\n')}\n\nSwitch with /use <number>.` : 'No projects yet. Open a folder in Dispatch first.';
    if (cmd === 'use') {
      const n = Number(arg);
      const target = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find(w => path.basename(w).toLowerCase() === arg.toLowerCase());
      if (!target) return `No project "${arg}". Send /projects to see the list.`;
      if (path.resolve(target).toLowerCase() === current) return `${path.basename(target)} is already open.`;
      switchWorkspace(target);
      if (win && !win.isDestroyed()) win.webContents.reload();
      return `Switched to ${path.basename(target)}. Its last chat is opening and the boss is starting; write your message in a few seconds.`;
    }
    if (cmd === 'help') return 'Write anything and the boss of the open project answers.\n/projects: list projects\n/use <number>: switch project';
    return null;
  },
});
let tgWaiting = 0;
telegram.onChange(s => notify('telegram', s));
// Who answers Telegram in this operation: the boss unless the boss or the user handed it to another agent.
function tgOwner() { const o = operation?.telegramOwner; return o && operation.agents.some(a => a.name === o) ? o : 'boss'; }
function setTgOwner(name) {
  if (!operation || !operation.agents.some(a => a.name === name)) throw new Error(`No agent ${name} in this operation.`);
  const before = tgOwner(); operation.telegramOwner = name === 'boss' ? undefined : name; saveOperation(); notify('telegram-owner', tgOwner());
  if (before !== name) {
    if (processes.has(name)) void sendMessage(name, `You now answer the user's Telegram messages.${telegramHelp(name)}`, 'dispatch').catch(() => {});
    if (telegram.connected()) void telegram.send(`[${path.basename(workspace)}] Telegram is now answered by ${name}.`).catch(() => {});
  }
  return tgOwner();
}
// The owner's replies go back to Telegram while a Telegram conversation is going (30 min); notices that need the user always go.
function tgForward(msg) {
  if (!telegram.connected()) return;
  const owner = tgOwner();
  const fromPhone = msg.from === owner && Date.now() - tgWaiting < 30 * 60e3;
  const where = `[${path.basename(workspace)}${owner !== 'boss' ? ` · ${owner}` : ''}]`;
  if (fromPhone || msg.from === 'dispatch') void telegram.send(msg.from === owner ? `${where} ${msg.text}` : `${where} Dispatch: ${msg.text}`).catch(() => {});
}
function telegramHelp(name = 'boss') {
  if (!telegram.connected()) return '';
  const owner = tgOwner();
  return `\nTelegram: the user is connected on their phone; ${owner === name ? 'you answer it' : `${owner} answers it now`}. Messages starting with [via Telegram] come from there (files they send are saved and listed with their paths) and your answer goes back automatically. Send text or any file yourself (image, video, audio, document) with dispatch telegram send --text "<message>" [--file <path>]. Change the bot's own profile with dispatch telegram profile [--photo <jpg|png>] [--name "<name>"] [--description "<text>"] [--about "<short text>"].${name === 'boss' ? ' Hand Telegram to another agent (e.g. a cheap one that watches it) with dispatch telegram owner <agent>, and back with dispatch telegram owner boss.' : ''}`;
}
async function handleTelegram(msg) {
  let req = {}; try { req = JSON.parse(msg.text); } catch {}
  try {
    const boss = ['boss', 'user', 'you'].includes(msg.from), owner = msg.from === tgOwner();
    let out = 'Sent to Telegram.';
    if (req.action === 'owner') {
      if (!boss) throw new Error('Only the boss can hand Telegram to another agent.');
      out = `Telegram is now answered by ${setTgOwner(String(req.agent || 'boss'))}.`;
    } else if (req.action === 'profile') {
      if (!boss && !owner) throw new Error('Only the boss or the Telegram owner can change the bot.');
      const photo = req.photo ? path.resolve(workspace, String(req.photo)) : '';
      if (photo && !fs.existsSync(photo)) throw new Error(`No file ${photo}.`);
      out = await telegram.setProfile({ photo, name: req.name, description: req.description, about: req.about });
    } else {
      if (!boss && !owner) throw new Error('Only the boss or the Telegram owner can send to Telegram.');
      if (req.file) { const f = path.resolve(workspace, String(req.file)); if (!fs.existsSync(f)) throw new Error(`No file ${f}.`); await telegram.sendFile(f, req.text || ''); }
      else await telegram.send(req.text);
    }
    replySchedule(msg.id, out);
  } catch (e) { replySchedule(msg.id, `ERROR: ${e.message}`); }
}
ipcMain.handle('telegram:owner', () => tgOwner());
ipcMain.handle('telegram:set-owner', (_e, name) => setTgOwner(String(name)));
app.whenReady().then(() => telegram.start());
app.on('before-quit', () => telegram.stop());
const updater = require('./updater.cjs').create({ notify, onBeforeInstall: () => { quitting = true; } });
ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('telegram:status', () => telegram.status());
ipcMain.handle('telegram:set-token', (_e, token) => telegram.setToken(token));
ipcMain.handle('telegram:link', () => { const url = telegram.linkUrl(); void shell.openExternal(url); return url; });
ipcMain.handle('telegram:unlink', () => telegram.unlink());
ipcMain.handle('telegram:disconnect', () => telegram.disconnect());
ipcMain.handle('telegram:test', () => telegram.send('Test from Dispatch. Your boss can reach you here.'));
ipcMain.handle('telegram:botfather', () => shell.openExternal('https://t.me/BotFather?start'));
ipcMain.handle('telegram:clipboard-token', () => { const t = require('electron').clipboard.readText().trim(); return require('./telegram.cjs').looksLikeToken(t) ? t : null; });

// ── .dispatch packs (share a trained workspace or an agent) ─────
const packLib = require('./pack.cjs');
const packs = new Map();
let pendingPack = null;
const packArgs = { get workspace() { return workspace; }, get globalDir() { return globalDir(); }, get claudeHome() { return path.join(userHome(), '.claude'); } };
function openPackFile(file) {
  const stat = fs.statSync(file);
  if (stat.size > 300 * 1024 * 1024) throw new Error('This pack is larger than 300 MB.');
  const pack = packLib.open(fs.readFileSync(file));
  const id = crypto.randomUUID(); packs.set(id, { pack, file });
  return { id, file, ...packLib.describe(pack, packArgs) };
}
function packFromArgv(argv) { return argv.slice(1).find(a => a.toLowerCase().endsWith('.' + packLib.EXT) && fs.existsSync(a)) || null; }
function showPack(file) { if (!file) return; pendingPack = file; if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send('pack-open', file); } }
// Double-clicking a .dispatch file: Windows/Linux pass it in argv (to a second instance when one is running), macOS sends open-file.
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => { const f = packFromArgv(argv); if (f) showPack(f); else if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('open-file', (e, file) => { e.preventDefault(); if (file.toLowerCase().endsWith('.' + packLib.EXT)) showPack(file); });
pendingPack = packFromArgv(process.argv);
ipcMain.handle('packs:inventory', () => packLib.inventory(packArgs));
ipcMain.handle('packs:export', async (_e, selection, meta, target) => {
  const { buffer, manifest } = packLib.build({ ...packArgs, selection: selection || {}, meta: meta || {}, appVersion: app.getVersion() });
  let file = process.env.DISPATCH_TEST_HOME && target ? String(target) : null;
  if (!file) {
    const r = await dialog.showSaveDialog(win, { title: 'Export Dispatch pack', defaultPath: path.join(app.getPath('documents'), `${manifest.name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').trim() || 'workspace'}.${packLib.EXT}`), filters: [{ name: 'Dispatch pack', extensions: [packLib.EXT] }] });
    if (r.canceled || !r.filePath) return null; file = r.filePath;
  }
  fs.writeFileSync(file, buffer);
  return { file, size: buffer.length, manifest };
});
ipcMain.handle('packs:choose', async () => { const r = await dialog.showOpenDialog(win, { title: 'Open Dispatch pack', properties: ['openFile'], filters: [{ name: 'Dispatch pack', extensions: [packLib.EXT] }] }); if (r.canceled || !r.filePaths[0]) return null; return openPackFile(r.filePaths[0]); });
ipcMain.handle('packs:open', (_e, file) => openPackFile(String(file)));
ipcMain.handle('packs:pending', () => { const f = pendingPack; pendingPack = null; return f; });
ipcMain.handle('packs:discard', (_e, id) => { packs.delete(String(id)); return true; });
ipcMain.handle('packs:reveal', (_e, file) => { shell.showItemInFolder(String(file)); return true; });
ipcMain.handle('packs:import', async (_e, id, choice, newFolder) => {
  const entry = packs.get(String(id)); if (!entry) throw new Error('Open the pack again.');
  let target = workspace;
  if (newFolder) {
    target = process.env.DISPATCH_TEST_HOME && typeof newFolder === 'string' ? newFolder : null;
    if (!target) { const r = await dialog.showOpenDialog(win, { title: 'Folder for the imported workspace', properties: ['openDirectory', 'createDirectory'] }); if (r.canceled || !r.filePaths[0]) return null; target = r.filePaths[0]; }
    fs.mkdirSync(target, { recursive: true });
  }
  const result = await packLib.apply(entry.pack, { workspace: target, globalDir: globalDir(), choice: choice || {} });
  packs.delete(String(id));
  return { ...result, workspace: path.resolve(target) };
});

// ── Boss memory (project + global knowledge graphs) ─────────────
const memoryLib = require('./memory.cjs');
const memoryStore = () => memoryLib.create({ globalDir: globalDir(), projectDir: path.join(workspace, '.dispatch'), log: path.join(workspace, '.dispatch', 'memory-log.jsonl') });
let memoryWatcher = null;
function watchMemory() {
  memoryWatcher?.close();
  const m = memoryStore();
  memoryWatcher = chokidar.watch([...Object.values(m.files), ...Object.values(m.settingsFiles), path.join(workspace, '.dispatch', 'memory-log.jsonl')], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120 } });
  memoryWatcher.on('all', () => notify('memory-changed', null));
}
async function memorySnapshot() {
  const m = memoryStore(), scopes = {};
  for (const s of memoryLib.SCOPES) { const g = await m.graph(s); scopes[s] = { file: m.files[s], enabled: m.enabled(s), entities: g.entities, relations: g.relations, tokens: m.tokens(g.entities.map(e => [e.name, e.entityType, e.summary, ...e.observations].join(' ')).join('\n')) }; }
  const o = m.overview();
  return { settings: m.settings(), scopes, overview: { text: o.text, shown: o.shown, total: o.total, tokens: o.tokens }, activity: m.activity() };
}
const memScope = s => { if (!memoryLib.SCOPES.includes(s)) throw new Error('Unknown memory scope'); return s; };
ipcMain.handle('memory:get', () => memorySnapshot());
ipcMain.handle('memory:settings', (_e, patch) => memoryStore().saveSettings(patch || {}));
ipcMain.handle('memory:save', async (_e, scope, entity, isNew) => {
  const m = memoryStore(), g = m.graphs[memScope(scope)];
  const name = String(entity?.name || '').trim(); if (!name) throw new Error('Name is required');
  const clean = { entityType: String(entity.entityType || 'note').trim() || 'note', summary: String(entity.summary || '').replace(/[\r\n]+/g, ' ').trim(), observations: (entity.observations || []).map(o => String(o).trim()).filter(Boolean), pinned: !!entity.pinned };
  if (isNew) { const created = await g.createEntities([{ name, ...clean }]); if (!created.length) throw new Error(`"${name}" already exists`); }
  else await g.updateEntity(name, clean);
  m.record({ by: 'user', tool: isNew ? 'create_entities' : 'update_entity', scope, detail: name, ok: true });
  return true;
});
ipcMain.handle('memory:delete', async (_e, scope, name) => { const m = memoryStore(); await m.graphs[memScope(scope)].deleteEntities([String(name)]); m.record({ by: 'user', tool: 'delete_entities', scope, detail: String(name), ok: true }); return true; });
ipcMain.handle('memory:relation', async (_e, scope, relation, remove) => { const m = memoryStore(), g = m.graphs[memScope(scope)]; const r = { from: String(relation.from), to: String(relation.to), relationType: String(relation.relationType || '').trim() }; if (!r.relationType) throw new Error('Relation type is required'); if (remove) await g.deleteRelations([r]); else await g.createRelations([r]); m.record({ by: 'user', tool: remove ? 'delete_relations' : 'create_relations', scope, detail: `${r.from} ${r.relationType} ${r.to}`, ok: true }); return true; });
ipcMain.handle('memory:reveal', (_e, scope) => { const f = memoryStore().files[memScope(scope)]; fs.mkdirSync(path.dirname(f), { recursive: true }); if (fs.existsSync(f)) shell.showItemInFolder(f); else void shell.openPath(path.dirname(f)); return true; });
ipcMain.handle('memory:clear-activity', () => { try { fs.writeFileSync(path.join(workspace, '.dispatch', 'memory-log.jsonl'), ''); } catch {} return true; });
mcp.setBuiltinEnv((id, opts = {}) => id === 'blender' ? { DISPATCH_BLENDER_EXE: require('./blender.cjs').exe() } : id === 'servers' ? { DISPATCH_SERVERS_URL: serversBridge.url, DISPATCH_AGENT: opts.agent || 'agent' } : id === 'memory' ? { DISPATCH_MEMORY_GLOBAL_DIR: globalDir(), DISPATCH_MEMORY_PROJECT_DIR: path.join(workspace, '.dispatch'), DISPATCH_MEMORY_LOG: path.join(workspace, '.dispatch', 'memory-log.jsonl'), DISPATCH_AGENT: 'boss' } : id === 'comfyui' ? { COMFY_URL: tools.comfyConfig().url, COMFY_ROOT: tools.comfyConfig().layout?.root || '', DISPATCH_OUTPUTS: outputsFile() } : id === 'voicestudio' ? { VOICE_URL: tools.voiceUrl(), DISPATCH_OUTPUTS: outputsFile() } : {});
let outputsWatcher = null, galleryWatcher = null, outputsOffset = 0;
function readOutputs(onlyNew = false) { let lines = []; try { lines = fs.readFileSync(outputsFile(), 'utf8').split('\n').filter(Boolean); } catch {} const start = onlyNew ? Math.min(outputsOffset, lines.length) : 0; outputsOffset = lines.length; return lines.slice(start).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
function appendOutput(event) { try { fs.mkdirSync(path.dirname(outputsFile()), { recursive: true }); fs.appendFileSync(outputsFile(), JSON.stringify({ time: Date.now(), ...event }) + '\n'); } catch {} }
let toolDirWatchers = [];
function watchTools() {
  outputsWatcher?.close(); toolDirWatchers.forEach(w => w.close()); toolDirWatchers = [];
  outputsWatcher = chokidar.watch([outputsFile()], { ignoreInitial: true });
  outputsWatcher.on('all', () => { const items = readOutputs(true); if (items.length) notify('outputs', items); });
  readOutputs(true);
  // Shared gallery: files agents save under .dispatch/outputs/<agent>/ are logged like tool outputs
  // (tools log their own files, so those are skipped).
  galleryWatcher?.close();
  fs.mkdirSync(outputsDir(), { recursive: true });
  galleryWatcher = chokidar.watch(outputsDir(), { ignoreInitial: true, depth: 6, ignored: p => path.basename(p).startsWith('.'), awaitWriteFinish: { stabilityThreshold: 2500 } });
  galleryWatcher.on('add', file => {
    let logged = ''; try { logged = fs.readFileSync(outputsFile(), 'utf8'); } catch {}
    if (logged.includes(JSON.stringify(file).slice(1, -1))) return;
    let st; try { st = fs.statSync(file); } catch { return; }
    const first = path.relative(outputsDir(), file).split(path.sep);
    appendOutput({ tool: 'agent', kind: 'file', agent: first.length > 1 ? first[0] : undefined, file, size: st.size });
  });
  const layout = tools.comfyConfig().layout; if (!layout) return;
  // Native recursive watch: ComfyUI output folders can hold tens of thousands of files.
  const pending = new Map();
  const seen = (dir, kind) => (event, name) => {
    if (!name || /\.part$|_temp_|^\.|[\\/]\./.test(name)) return;
    const file = path.join(dir, name);
    clearTimeout(pending.get(file)); pending.set(file, setTimeout(() => {
      pending.delete(file);
      let st; try { st = fs.statSync(file); } catch { return; } if (!st.isFile() || Date.now() - st.birthtimeMs > 120000) return;
      if (kind === 'model' && !/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i.test(file)) return;
      appendOutput({ tool: 'comfyui', kind, file, size: st.size });
    }, 1500));
  };
  // ComfyUI's own output/ is not watched: Dispatch keeps agent results in <workspace>/.dispatch/outputs.
  for (const [dir, kind] of [[path.join(layout.app, 'models'), 'model']]) {
    try { toolDirWatchers.push(fs.watch(dir, { recursive: true }, seen(dir, kind))); } catch {}
  }
}ipcMain.handle('outputs:list', () => readOutputs().slice(-300));
const outputsDir = () => path.join(workspace, '.dispatch', 'outputs');
const inside = (root, file) => !!root && path.resolve(file).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
const outputAllowed = file => inside(outputsDir(), file) || inside(tools.comfyConfig().layout?.root, file);
// Thumbnail for an output image; only files in Dispatch outputs or the ComfyUI install are served.
ipcMain.handle('outputs:preview', (_e, file) => { const full = path.resolve(String(file)); if (!outputAllowed(full) || !/\.(png|jpe?g|webp|gif)$/i.test(full)) return null; try { const img = nativeImage.createFromPath(full); if (img.isEmpty()) return null; return img.resize({ width: 96 }).toDataURL(); } catch { return null; } });
ipcMain.handle('tools:status', () => tools.comfyStatus());
ipcMain.handle('tools:voice-status', () => tools.voiceStatus());
ipcMain.handle('tools:voice-start', () => tools.voiceStart());
ipcMain.handle('tools:voice-choose', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'VoiceStudio.exe', filters: [{ name: 'VoiceStudio', extensions: ['exe'] }] }); if (r.canceled || !r.filePaths[0]) return null; tools.setVoiceExe(r.filePaths[0]); return r.filePaths[0]; });
ipcMain.handle('tools:file', (_e, id) => { const f = tools.toolFile(id); return f ? path.basename(f) : null; });
ipcMain.handle('tools:reveal', (_e, id) => { const f = tools.toolFile(id); if (!f) return false; shell.showItemInFolder(f); return true; });
ipcMain.handle('tools:start', () => { tools.comfyStart(); return true; });
ipcMain.handle('tools:unreal-status', () => unreal.status());
ipcMain.handle('tools:blender-status', () => require('./blender.cjs').status());
ipcMain.handle('tools:blender-start', () => require('./blender.cjs').start());
ipcMain.handle('tools:blender-choose', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'blender.exe', filters: [{ name: 'Blender', extensions: ['exe'] }] }); if (r.canceled || !r.filePaths[0]) return null; require('./blender.cjs').setExe(r.filePaths[0]); return r.filePaths[0]; });
ipcMain.handle('tools:unreal-choose', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Unreal project', filters: [{ name: 'Unreal project', extensions: ['uproject'] }] }); if (r.canceled || !r.filePaths[0]) return null; unreal.setProject(r.filePaths[0]); return r.filePaths[0]; });
ipcMain.handle('tools:unreal-enable', () => unreal.enablePlugins());
ipcMain.handle('tools:unreal-open', () => unreal.openEditor());
ipcMain.handle('tools:stop', () => tools.comfyStop());
ipcMain.handle('tools:choose-path', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'ComfyUI folder' }); if (r.canceled || !r.filePaths[0]) return null; tools.setComfyPath(r.filePaths[0]); watchTools(); return r.filePaths[0]; });
// Opens the folder with the file selected (falls back to the outputs folder if the file is gone).
ipcMain.handle('outputs:reveal', (_e, file) => { const full = file ? path.resolve(String(file)) : ''; if (full && outputAllowed(full) && fs.existsSync(full)) { shell.showItemInFolder(full); return true; } fs.mkdirSync(outputsDir(), { recursive: true }); void shell.openPath(outputsDir()); return false; });
ipcMain.handle('tools:install', (_e, id = 'comfyui') => {
  const script = id === 'comfyui' ? tools.installScript() : tools.TOOL_INSTALL[id]?.();
  if (!script) throw new Error(`Unknown tool: ${id}`);
  const name = `tool-${id}-install`;
  processes.get(name)?.terminal.kill(); processes.delete(name);
  const terminal = pty.spawn('powershell.exe', ['-NoProfile', '-Command', script], { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: process.env });
  const entry = { terminal, queue: [], output: '' }; processes.set(name, entry);
  terminal.onData(data => { entry.output = (entry.output + data).slice(-200000); notify('terminal', { name, data }); });
  terminal.onExit(({ exitCode }) => { watchTools(); notify('tool:done', { id, exitCode, name }); });
  return name;
});
ipcMain.handle('templates:list', () => ({ items: templates.list(workspace), efforts: providersLib.EFFORTS, models: { ...templates.MODELS, ...providersLib.allModels(), local: localAI.list().length ? localAI.list().map(item => item.model) : ['default'], ...Object.fromEntries(localAI.list().map(item => ['local:' + encodeURIComponent(item.model), [item.model]])) }, localProviders: localAI.list().map(item => ({ id: 'local:' + encodeURIComponent(item.model), name: item.name, model: item.model, icon: item.icon })) }));
ipcMain.handle('local-ai:get', () => localAI.read());
ipcMain.handle('local-ai:list', () => localAI.list());
ipcMain.handle('local-ai:remove', (_e, model) => { const result = localAI.remove(model); notify('templates-changed', null); notify('local-ai-changed', result[0] || null); return result; });
ipcMain.handle('local-ai:save', (_e, config) => { const saved = localAI.save(config); notify('templates-changed', null); notify('local-ai-changed', saved); return saved; });
ipcMain.handle('local-ai:choose-icon', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Choose local AI icon', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'webp'] }] });
  if (result.canceled || !result.filePaths.length) return null;
  const selected = result.filePaths[0];
  if ((await fs.promises.stat(selected)).size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  const image = nativeImage.createFromPath(selected);
  if (image.isEmpty()) throw new Error('Could not open this image.');
  return image.resize({ width: 256, height: 256, quality: 'best' }).toDataURL();
});
ipcMain.handle('local-ai:check', (_e, config) => localAI.check(config));
ipcMain.handle('providers:list', () => providersLib.PROVIDERS.map(p => ({ id: p.id, name: p.name }))); 
ipcMain.handle('providers:check', async (_e, id) => { if (id !== 'local' && !id.startsWith('local:')) return providersLib.check(resolveCommand, id); const config = localAI.read(id.startsWith('local:') ? decodeURIComponent(id.slice(6)) : undefined); let installed = true; try { resolveCommand('opencode'); } catch { installed = false; } const status = config && installed ? await localAI.check(config) : null; return { id, name: 'Local AI', installed, auth: status?.ok && status.matches ? 'signed-in' : 'error', detail: !installed ? 'OpenCode is required.' : !config ? 'Configure a local server in Providers.' : !status.ok ? 'Local server is offline.' : !status.matches ? 'Configured model was not found on the server.' : config.baseURL, models: config ? [config.model] : [] }; });
ipcMain.handle('providers:update-info', (_e, id, version) => providersLib.updateInfo(id, version));
ipcMain.handle('providers:models', (_e, id) => providersLib.refreshModels(resolveCommand, id));
ipcMain.handle('providers:action', (_e, id, kind) => {
  const name = `provider-${id}-${kind}`;
  processes.get(name)?.terminal.kill(); processes.delete(name);
  const spec = providersLib.actionSpec(resolveCommand, id, kind);
  const terminal = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: process.env });
  const entry = { terminal, queue: [], output: '' }; processes.set(name, entry);
  terminal.onData(data => { entry.output = (entry.output + data).slice(-200000); notify('terminal', { name, data }); });
  terminal.onExit(({ exitCode }) => { notify('provider:done', { id, kind, exitCode, name }); });
  return name;
});
// User shells (Terminal tab in the side panel): PowerShell in the workspace. Kept apart from agents so stopping
// or restarting the team never touches them; they share the 'terminal' event and the input/resize/output channels.
const shells = new Map(); let shellSeq = 0;
ipcMain.handle('shell:list', () => [...shells.entries()].map(([name, s]) => ({ name, title: s.title, cwd: s.cwd, exited: s.exited, server: s.server || null })));
ipcMain.handle('shell:open', () => {
  const name = `shell-${++shellSeq}`, cwd = workspace || os.homedir();
  const file = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
  const terminal = pty.spawn(file, process.platform === 'win32' ? ['-NoLogo'] : [], { name: 'xterm-256color', cols: 100, rows: 24, cwd, env: process.env });
  const entry = { terminal, output: '', cwd, title: `Terminal ${shellSeq}`, exited: false };
  shells.set(name, entry);
  terminal.onData(data => { entry.output = (entry.output + data).slice(-400000); notify('terminal', { name, data }); });
  terminal.onExit(() => { entry.exited = true; notify('shells-changed', null); });
  notify('shells-changed', null);
  return name;
});
ipcMain.handle('shell:close', (_e, name) => { const s = shells.get(name); if (s) { try { s.terminal.kill(); } catch {} shells.delete(name); notify('shells-changed', null); } return true; });
ipcMain.handle('shell:rename', (_e, name, title) => { const s = shells.get(name); if (s && String(title).trim()) { s.title = String(title).trim().slice(0, 40); notify('shells-changed', null); } return true; });
app.on('before-quit', () => { for (const s of shells.values()) try { s.terminal.kill(); } catch {} });
// ── SSH servers (electron/servers.cjs): saved list, terminals, and the agents' servers MCP bridge ──
const serversLib = require('./servers.cjs');
const { safeStorage } = require('electron');
const serverVault = { seal: text => { if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot store passwords securely'); return safeStorage.encryptString(text).toString('base64'); }, open: s => safeStorage.decryptString(Buffer.from(s, 'base64')) };
const serverStore = () => serversLib.create(path.join(globalDir(), 'servers.json'), serverVault);
const serverPassword = id => { const st = serverStore(), s = st.get(id); return s ? st.password(s) : ''; };
ipcMain.handle('servers:list', () => serverStore().list());
ipcMain.handle('servers:save', (_e, s) => { const saved = serverStore().save(s); notify('servers-changed', null); return saved; });
ipcMain.handle('servers:remove', (_e, id) => { serverStore().remove(id); notify('servers-changed', null); return true; });
ipcMain.handle('servers:order', (_e, ids) => { serverStore().order(Array.isArray(ids) ? ids.map(String) : []); notify('servers-changed', null); return true; });
ipcMain.handle('servers:test', (_e, s) => serversLib.test(s, typeof s.password === 'string' && s.password ? s.password : s.id ? serverPassword(s.id) : ''));
ipcMain.handle('servers:choose-key', async () => { const r = await dialog.showOpenDialog(win, { title: 'SSH private key', defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'] }); return r.canceled ? null : r.filePaths[0] || null; });
ipcMain.handle('servers:choose-icon', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Server icon', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'svg'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  if (/\.svg$/i.test(file)) { const data = fs.readFileSync(file); if (data.length > 200000) throw new Error('That SVG is too large'); return 'data:image/svg+xml;base64,' + data.toString('base64'); }
  const img = nativeImage.createFromPath(file); if (img.isEmpty()) throw new Error('Could not read that image');
  return img.resize({ width: 96, height: 96, quality: 'best' }).toDataURL();
});
ipcMain.handle('servers:connect', (_e, id) => {
  const s = serverStore().get(id); if (!s) throw new Error('Server not found');
  const name = `shell-${++shellSeq}`;
  const terminal = pty.spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', serversLib.sshArgs(s), { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: process.env });
  const entry = { terminal, output: '', cwd: `${s.user ? s.user + '@' : ''}${s.host}`, title: s.name, exited: false, server: s.id };
  shells.set(name, entry);
  const answer = serversLib.answerer(serverPassword(s.id), text => terminal.write(text), () => {});
  terminal.onData(data => { entry.output = (entry.output + data).slice(-400000); notify('terminal', { name, data }); answer(data); });
  terminal.onExit(() => { entry.exited = true; notify('shells-changed', null); });
  notify('shells-changed', null);
  return name;
});
// Agents reach servers through mcp-servers.cjs, which posts here (loopback only, random token).
const serversBridge = { url: '', pending: new Map(), log: [] };
ipcMain.handle('servers:approve', (_e, id, ok) => { const done = serversBridge.pending.get(id); serversBridge.pending.delete(id); done?.(!!ok); return true; });
ipcMain.handle('servers:pending', () => [...serversBridge.pending.keys()].map(id => serversBridge.log.find(l => l.id === id)).filter(Boolean));
ipcMain.handle('servers:log', () => serversBridge.log.slice(-100));
{
  const token = crypto.randomBytes(16).toString('hex');
  const logCall = entry => { serversBridge.log.push(entry); if (serversBridge.log.length > 200) serversBridge.log.shift(); notify('servers-log', entry); };
  const bridge = require('http').createServer((req, res) => {
    const reply = v => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.method !== 'POST' || req.url !== '/' + token) { res.writeHead(404); return res.end(); }
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', async () => {
      try {
        const { tool, args = {}, agent = 'agent' } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const usable = serverStore().list().filter(s => s.access !== 'off');
        if (tool === 'servers_list') return reply({ text: usable.length ? usable.map(s => `- ${s.name} (${s.user ? s.user + '@' : ''}${s.host}${s.port !== 22 ? ':' + s.port : ''})${s.access === 'ask' ? ' [each command needs the user\'s approval]' : ''}${s.note ? ': ' + s.note : ''}`).join('\n') : 'No servers are shared with agents. The user can allow them under Servers in Dispatch.' });
        const s = usable.find(x => x.name.toLowerCase() === String(args.server || '').toLowerCase());
        if (!s) return reply({ error: `No server named "${args.server}" is shared with agents. Call servers_list.` });
        const action = tool === 'server_run' ? String(args.command || '') : tool === 'server_upload' ? `upload ${args.local_path} -> ${args.remote_path}` : tool === 'server_download' ? `download ${args.remote_path} -> ${args.local_path}` : '';
        if (!action.trim()) return reply({ error: 'Unknown tool or empty command' });
        const entry = { id: crypto.randomUUID(), time: Date.now(), agent: String(agent), server: s.name, serverId: s.id, tool, action, status: s.access === 'ask' ? 'waiting' : 'running' };
        logCall(entry);
        if (s.access === 'ask') {
          const ok = await new Promise(resolve => serversBridge.pending.set(entry.id, resolve));
          if (!ok) { entry.status = 'denied'; notify('servers-log', entry); return reply({ error: 'The user denied this. Do not retry it; ask the user what to do instead.' }); }
          entry.status = 'running'; notify('servers-log', entry);
        }
        const timeout = Math.min(1800, Math.max(5, Number(args.timeout_s) || 120)) * 1000;
        const pw = serverPassword(s.id);
        const r = tool === 'server_run' ? await serversLib.exec(s, action, timeout, pw) : tool === 'server_upload' ? await serversLib.upload(s, path.resolve(workspace, String(args.local_path)), String(args.remote_path), 600000, pw) : await serversLib.download(s, String(args.remote_path), path.resolve(workspace, String(args.local_path)), 600000, pw);
        entry.status = r.code === 0 ? 'done' : 'failed'; entry.code = r.code; notify('servers-log', entry);
        reply({ text: `exit code ${r.code}\n${r.output || '(no output)'}` });
      } catch (e) { reply({ error: String(e.message || e) }); }
    });
  });
  bridge.listen(0, '127.0.0.1', () => { serversBridge.url = `http://127.0.0.1:${bridge.address().port}/${token}`; if (process.env.DISPATCH_TEST_HOME) fs.writeFileSync(path.join(process.env.DISPATCH_TEST_HOME, 'servers-bridge-url'), serversBridge.url); });
}
ipcMain.handle('providers:close', (_e, name) => { try { processes.get(name)?.terminal.kill(); } catch {} processes.delete(name); return true; });
// Remaining usage limits (session / weekly). Polled every 3 min only while the window is visible.
const usageLib = require('./usage.cjs');
const usageIds = () => usageLib.SUPPORTED.filter(providerEnabled);
async function usageAll(force) { return demo ? usageLib.demo() : usageLib.getAll({ providers: usageIds(), resolveCommand, force }); }
ipcMain.handle('usage:get', () => usageAll(false));
ipcMain.handle('usage:refresh', async (_e, id) => { if (id && !demo) { const all = await usageLib.getAll({ providers: [id], resolveCommand, force: true }); notify('usage:update', all); return all; } const all = await usageAll(true); notify('usage:update', all); return all; });
setInterval(() => { if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) usageAll(true).then(all => notify('usage:update', all)).catch(() => {}); }, 180000).unref();
ipcMain.handle('templates:save', (_e, t) => templates.save(workspace, t));
ipcMain.handle('templates:delete', (_e, file) => templates.remove(file));
ipcMain.handle('templates:reveal', (_e, file) => { require('electron').shell.showItemInFolder(file); return true; });
ipcMain.handle('output', (_e, name) => processes.get(name)?.output || shells.get(name)?.output || '');
ipcMain.handle('start', (_e, template, teamFile) => {
  if (teamFile) {
    const team = teams.list(workspace).find(t => t.file === teamFile); if (!team) throw new Error('Team not found.');
    const { boss, members } = teams.resolve(team, templates.list(workspace));
    stopAgents(); newOperation(); rosterHint = members.map(m => m.name);
    try {
      startAgent('boss', boss);
      for (const m of members) { startAgent(m.name, m.template, 'boss'); notify('enlisted', { name: m.name, template: m.template, enlistedBy: 'boss' }); }
    } finally { rosterHint = []; }
    return ['boss', ...members.map(m => m.name)];
  }
  if (!template?.provider || template.extra?.role !== 'boss') throw new Error('Choose a boss template'); stopAgents(); newOperation(); const names = demo ? ['boss', 'scout', 'coder'] : ['boss']; for (const name of names) startAgent(name, name === 'boss' ? template : { provider: template.provider, model: '', body: '' }); return names;
});
const teams = require('./teams.cjs');
// Unload: back to the workspace that was open before, real agents again, and the mock leaves the recent list.
ipcMain.handle('dev:unmock', () => {
  finishOperation(); stopAgents();
  demo = process.argv.includes('--demo');
  const back = [mockPrevious, ...recentWorkspaces()].find(w => w && !isMock(w) && (() => { try { return fs.statSync(w).isDirectory(); } catch { return false; } })()) || os.homedir();
  workspace = back; mockPrevious = null;
  rememberWorkspace(); watch();
  cleanMocks(null);
  return workspace;
});
// Dev only (npm run dev): switch to a mock workspace full of data and a saved demo operation, then the renderer reloads and resumes it.
ipcMain.handle('dev:mock', () => {
  if (!process.env.VITE_DEV_SERVER_URL) throw new Error('Mock data is only available in npm run dev.');
  const mock = require('./mock.cjs');
  const target = mockDir();
  if (!isMock(workspace)) mockPrevious = workspace;
  finishOperation(); stopAgents();
  demo = true;
  mock.seed(target, { nativeImage });
  workspace = target; cleanMocks(target); rememberWorkspace(); watch();
  const team = teams.list(workspace).find(t => t.scope === 'project');
  const { boss, members } = teams.resolve(team, templates.list(workspace));
  newOperation(); operation.name = 'Daily short · Wi-Fi at night';
  for (const [from, to, text] of mock.MESSAGES) fs.appendFileSync(logPath(), JSON.stringify({ id: crypto.randomBytes(8).toString('hex'), from, to, text, kind: 'send', time: new Date().toISOString() }) + '\n');
  for (const [name, template, enlistedBy] of [['boss', boss, undefined], ...members.map(m => [m.name, m.template, m.name === 'studio-lead' ? 'boss' : 'studio-lead'])]) {
    const saved = { name, template, provider: template.provider, model: template.model || '', enlistedBy };
    operation.agents.push(saved); createChat(saved);
  }
  finishOperation();
  return target;
});
// New chat: the same agents, an empty conversation and no tasks, as if the team had just been started from a
// template. The old conversation stays under Recent operations.
ipcMain.handle('operation:reset', () => {
  if (!operation?.agents.length) throw new Error('No operation is open.');
  const roster = operation.agents.map(a => ({ name: a.name, template: a.template, enlistedBy: a.enlistedBy }));
  stopAgents();
  // Undelivered orders belong to the old conversation. Only the files go: the watcher holds the folders open.
  for (const a of roster) { const dir = path.join(workspace, '.dispatch', 'inbox', a.name); try { for (const f of fs.readdirSync(dir)) try { fs.unlinkSync(path.join(dir, f)); } catch {} } catch {} }
  newOperation(); rosterHint = roster.map(a => a.name);
  try { for (const a of roster) startAgent(a.name, a.template, a.enlistedBy); } finally { rosterHint = []; }
  return operation.agents.map(a => ({ name: a.name, template: a.template, enlistedBy: a.enlistedBy }));
});
// Save the agents of the open operation as a team template (the boss may have built the team itself).
// One running agent kept as a template: its current provider, model, effort and prompt (minus a team roster).
ipcMain.handle('templates:save-agent', (_e, agentName, name, scope) => {
  const saved = operation?.agents.find(a => a.name === agentName);
  if (!saved) throw new Error(`Agent ${agentName} is not on this team.`);
  const t = saved.template || {};
  const file = templates.save(workspace, { name, scope: scope === 'global' ? 'global' : 'project', description: t.description || '', provider: t.provider || 'claude', model: t.model || '', effort: t.effort || '', extra: {}, body: String(t.body || '').split('\n\n## Your team:')[0] });
  notify('templates-changed', null);
  return file;
});
ipcMain.handle('teams:save-current', (_e, name, scope) => {
  const boss = operation?.agents.find(a => a.name === 'boss');
  if (!boss) throw new Error('No operation with a boss is open.');
  const members = operation.agents.filter(a => a.name !== 'boss');
  if (!members.length) throw new Error('This operation has no agents besides the boss yet.');
  // A boss started from a team carries that team's roster at the end of its prompt; the saved team gets its own.
  const bossTemplate = { ...boss.template, body: String(boss.template.body || '').split('\n\n## Your team:')[0] };
  const file = teams.save(workspace, {
    name, scope: scope === 'project' ? 'project' : 'global',
    boss: { template: bossTemplate.name || 'boss', provider: bossTemplate.provider, model: bossTemplate.model || '', snapshot: teams.pick(bossTemplate) },
    members: members.map(a => ({ name: a.name.toLowerCase().replace(/_/g, '-'), template: a.template.name || a.name, snapshot: teams.pick({ ...a.template, name: a.template.name || a.name }) })),
  }, templates.list(workspace));
  notify('teams-changed', null);
  return file;
});
ipcMain.handle('teams:list', () => teams.list(workspace));
ipcMain.handle('teams:save', (_e, team) => { const file = teams.save(workspace, team, templates.list(workspace)); notify('teams-changed', null); return file; });
ipcMain.handle('teams:remove', (_e, file) => { teams.remove(workspace, file); notify('teams-changed', null); return true; });
ipcMain.handle('git:changes', () => workspace ? gitLib.changes(workspace) : []);
// IDE panel. The watcher only runs while the panel is open.
const filesLib = require('./files.cjs');
ipcMain.handle('files:list', (_e, rel) => filesLib.list(workspace, rel));
ipcMain.handle('files:read', (_e, rel) => filesLib.read(workspace, rel));
ipcMain.handle('files:write', (_e, rel, text) => filesLib.write(workspace, rel, text));
// Files dropped on the tree (like VS Code): copied into the folder under the drop, existing names get " copy".
ipcMain.handle('files:import', (_e, dir, items) => {
  if (!Array.isArray(items)) throw new Error('Nothing to copy');
  const root = filesLib.resolve(workspace, dir || '.');
  const tops = new Map(); const out = [];
  for (const { name, data } of items) {
    const parts = String(name).split('/').filter(p => p && p !== '.' && p !== '..');
    if (!parts.length) continue;
    if (!tops.has(parts[0])) { let top = parts[0], n = 1; const ext = path.extname(top), stem = top.slice(0, top.length - ext.length); while (fs.existsSync(path.join(root, top))) top = `${stem} copy${n++ > 1 ? ' ' + (n - 1) : ''}${ext}`; tops.set(parts[0], top); }
    const file = path.join(root, tops.get(parts[0]), ...parts.slice(1));
    if (!file.startsWith(root)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (data == null) fs.mkdirSync(file, { recursive: true }); else fs.writeFileSync(file, Buffer.from(data));
    out.push(file);
  }
  return out.length;
});
ipcMain.handle('files:head', (_e, rel) => filesLib.head(workspace, rel));
ipcMain.handle('files:all', () => filesLib.all(workspace));
ipcMain.handle('files:search', (_e, query, opts) => filesLib.search(workspace, query, opts));
ipcMain.handle('files:watch', (_e, on) => { if (on) filesLib.watch(workspace, batch => notify('files-changed', batch)); else filesLib.unwatch(); return true; });
ipcMain.handle('files:reveal', (_e, rel) => { shell.showItemInFolder(filesLib.resolve(workspace, rel)); return true; });
// Right-click menu of the Files tree. Native menu; returns 'open' or 'deleted' when the renderer has to react.
ipcMain.handle('files:context', (_e, rel, isDir) => new Promise(resolve => {
  const full = filesLib.resolve(workspace, rel);
  let result = null, pending = false;
  const items = [
    ...(isDir ? [] : [{ label: 'Open', click: () => { result = 'open'; } }, { type: 'separator' }]),
    { label: 'Reveal in File Explorer', click: () => shell.showItemInFolder(full) },
    { label: isDir ? 'Open folder' : 'Open with default app', click: () => void shell.openPath(full) },
    { label: 'Open terminal here', click: () => spawn('cmd.exe', ['/c', 'start', 'powershell.exe', '-NoExit'], { cwd: isDir ? full : path.dirname(full), detached: true, stdio: 'ignore' }).unref() },
    { type: 'separator' },
    { label: 'Copy path', click: () => clipboard.writeText(full) },
    { label: 'Copy relative path', click: () => clipboard.writeText(String(rel).replace(/\\/g, '/')) },
    { label: 'Copy name', click: () => clipboard.writeText(path.basename(full)) },
    { type: 'separator' },
    { label: 'Delete (Recycle Bin)', click: async () => { pending = true; const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, message: `Move ${path.basename(full)} to the Recycle Bin?` }); if (r.response === 0) { await shell.trashItem(full); result = 'deleted'; } resolve(result); } },
  ];
  Menu.buildFromTemplate(items).popup({ window: win, callback: () => setTimeout(() => { if (!pending) resolve(result); }, 0) });
}));
// Claude's screen has a footer under its prompt, so "at prompt" guessing fails there: trust its transcript instead.
ipcMain.handle('agent:working', (_e, name) => { const a = processes.get(name); if (!a) return false; if (a.submitting || a.inFlight) return true; const p = a.template?.provider; if (p === 'claude') return !!a.turn; if (p === 'codex') return !!a.codexStateKnown && !a.atPrompt;
  // Antigravity: its transcript says when a turn starts and ends; the prompt-character guess stays on after it finishes.
  // Stopped with Esc, nothing ends the turn in the transcript: back at the prompt and quiet for 20 s means done.
  if (p === 'antigravity' && a.turnKnown) return !!a.turn && !(a.atPrompt && Date.now() - Math.max(a.eventAt || 0, a.lastOutput) > 20000); return !!a.ready && !a.atPrompt; });
ipcMain.handle('boss:change', (_e, template, source) => {
  const saved = operation?.agents.find(a => a.name === 'boss');
  if (!saved) throw new Error('Boss not found');
  if (source) { const other = operation.agents.find(a => a.name === source); if (!other || source === 'boss') throw new Error('Agent not found'); template = other.template; agentAction(source, 'dismiss'); }
  if (!template?.provider) throw new Error('Choose a boss');
  const old = processes.get('boss'); if (old) { clearTimeout(old.timer); setAttention('boss', old, null); processes.delete('boss'); old.terminal.kill(); }
  saved.template = template; saved.provider = template.provider; saved.model = template.model || ''; saved.stopped = false;
  createChat(saved); startAgent('boss', template, undefined, saved, false); saveOperation(); return template;
});
ipcMain.handle('enlist', async (_e, name, template, task) => { const agent = startAgent(name, template); if (task) await sendMessage(name, task); return { name, template: agent.template }; });
ipcMain.handle('agent:action', (_e, name, action) => agentAction(name, action));
// Change an agent's model without losing the conversation. Claude: /model in the live pty (queued until at its prompt). Others: restart with resume (fresh chat where the provider cannot resume).
ipcMain.handle('agent:set-model', (_e, name, model) => {
  const saved = operation?.agents.find(a => a.name === name);
  if (!saved) throw new Error('Agent not found');
  model = String(model || '').trim(); if (!model || /[\r\n]/.test(model)) throw new Error('Invalid model');
  saved.template = { ...saved.template, model }; saved.model = model; saveOperation();
  return applyLive(name, saved, `/model ${model}`);
});
// Effort '' means the CLI's own default. Claude switches live with /effort; the others restart with the new flag.
ipcMain.handle('agent:set-effort', (_e, name, effort) => {
  const saved = operation?.agents.find(a => a.name === name);
  if (!saved) throw new Error('Agent not found');
  effort = String(effort || '');
  if (effort && !(providersLib.EFFORTS[saved.template.provider] || []).includes(effort)) throw new Error('This provider does not take that effort level');
  saved.template = { ...saved.template, effort }; saveOperation();
  return applyLive(name, saved, `/effort ${effort || 'auto'}`);
});
function applyLive(name, saved, slash) {
  const agent = processes.get(name); const provider = saved.template.provider;
  if (agent && provider === 'claude' && !saved.stopped) {
    const send = () => { agent.terminal.write(`${slash}\r`); agent.atPrompt = false; };
    const idle = () => !agent.submitting && !agent.inFlight && agent.ready && agent.atPrompt;
    if (idle()) { send(); return { mode: 'applied' }; }
    clearInterval(agent.modelTimer); let tries = 0;
    agent.modelTimer = setInterval(() => { if (processes.get(name) !== agent || ++tries > 1200) return clearInterval(agent.modelTimer); if (idle()) { clearInterval(agent.modelTimer); send(); } }, 500);
    return { mode: 'queued' };
  }
  if (!agent || saved.stopped) return { mode: 'saved' };
  const fresh = !(['claude', 'codex'].includes(provider) && saved.sessionId);
  agentAction(name, 'restart');
  return { mode: fresh ? 'fresh' : 'restarted' };
}
ipcMain.handle('debug:agent', (_e, name) => { const a = processes.get(name); return a && { command: a.command, args: a.args, prompt: a.prompt }; });
ipcMain.handle('attachments:preview', async (_e, target) => {
  if (!operation || typeof target !== 'string') return null;
  try {
    const dir = await fs.promises.realpath(path.join(operationsDir(), operation.id, 'attachments'));
    const actual = await fs.promises.realpath(target);
    if (path.dirname(actual) !== dir) return null;
    const filename = path.basename(actual);
    if (!/^[a-f0-9-]{36}-/i.test(filename)) return null;
    const name = filename.slice(37);
    if (!/\.(png|jpe?g|webp|gif|bmp|ico)$/i.test(name)) return { name };
    const info = await fs.promises.stat(actual);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) return { name };
    const image = nativeImage.createFromPath(actual);
    if (image.isEmpty()) return { name };
    const size = image.getSize();
    const scale = Math.min(1, 480 / Math.max(size.width, size.height));
    return { name, image: image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }).toDataURL() };
  } catch { return null; }
});
ipcMain.handle('attachments:save', async (_e, files) => {
  if (!operation) throw new Error('Start an operation before attaching files.');
  if (!Array.isArray(files) || files.length > 10) throw new Error('Attach up to 10 files at a time.');
  const dir = path.join(operationsDir(), operation.id, 'attachments');
  await fs.promises.mkdir(dir, { recursive: true });
  const saved = [];
  try {
    for (const file of files) {
      const bytes = Buffer.from(file.data);
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Each attachment must be 20 MB or smaller.');
      const name = path.basename(String(file.name).replace(/[\\/]/g, '_')).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 160) || 'attachment';
      const destination = path.join(dir, crypto.randomUUID() + '-' + name);
      await fs.promises.writeFile(destination, bytes, { flag: 'wx' });
      saved.push(destination);
    }
    return saved;
  } catch (error) { await Promise.all(saved.map(file => fs.promises.unlink(file).catch(() => {}))); throw error; }
});
ipcMain.handle('send', (_e, to, text) => sendMessage(to, text));
ipcMain.on('input', (_e, name, data) => { const shell = shells.get(name); if (shell) { if (!shell.exited) shell.terminal.write(data); return; } const agent = processes.get(name); if (!agent) return; if (agent.attention === 'Trust folder') agent.trustInteracted = true; if (agent.blocked && /[\r\n]/.test(data)) { agent.promptBuffer = ''; agent.awaitingAnswer = true; } agent.terminal.write(data); });
ipcMain.handle('attention:list', () => ({ ...Object.fromEntries([...exited].map(name => [name, 'Exited'])), ...Object.fromEntries([...processes].filter(([, a]) => a.attention).map(([name, a]) => [name, a.attention])) }));
ipcMain.handle('attention:trust', () => { fs.mkdirSync(path.dirname(trustFile()), { recursive: true }); fs.writeFileSync(trustFile(), JSON.stringify({ trusted: true }, null, 2)); const manual = []; for (const [name, agent] of processes) if (agent.attention === 'Trust folder' && !answerTrust(agent)) manual.push(name); return manual; });
ipcMain.on('resize', (_e, name, cols, rows) => { try { (processes.get(name) || shells.get(name))?.terminal.resize(cols, rows); } catch {} });
// On quit every agent goes down with everything it started. A child left behind without its terminal (a git
// fetch, a login helper) falls back to desktop prompts such as Git's credential helper window.
function killTrees() {
  if (process.platform !== 'win32') return;
  const { execFileSync } = require('node:child_process');
  for (const a of processes.values()) { const pid = a.terminal?.pid; if (pid) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 4000 }); } catch {} }
}
app.on('before-quit', () => { quitting = true; finishOperation(); watcher?.close(); codeIndexWorker?.postMessage('close'); killTrees(); stopAgents(); try { tray?.destroy(); } catch {} });
app.on('window-all-closed', () => app.quit());

