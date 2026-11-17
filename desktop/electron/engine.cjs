// One open project (a tab in the window): its workspace, operation, agents and IPC handlers. main.cjs creates one
// engine per tab, so every project's agents keep running while another tab is in front.
const { app, dialog, nativeImage, shell, Menu, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const chokidar = require('chokidar');
const pty = require('node-pty');
const activity = require('./activity.cjs');
const { restartRoster } = require('./roster.cjs');
const gitLib = require('./git.cjs');
const { parseMessage } = require('./bus.cjs');
const { createDemoTerminal } = require('./demo-terminal.cjs');
const { attentionFrom, shouldClearAttention, trustAnswer, nudgeAnswer, BLOCKING, normalize, progressKey, approvalSummary } = require('./attention.cjs');
const localAI = require('./local-ai.cjs');
const mcp = require('./mcp.cjs');
const storage = require('./storage.cjs');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const os = require('node:os');
const providersLib = require('./providers.cjs');
const accountsLib = require('./accounts.cjs');
const templates = require('./templates.cjs');
const workflowsLib = require('./workflows.cjs');
const tools = require('./tools.cjs');
const teams = require('./teams.cjs');
const { createTaskBoard } = require('./tasks.cjs');
module.exports = function createEngine(host) {
const ipcMain = host.ipc, win = host.window;
let workspace = process.cwd(), watcher, operation = null, needsFolder = false;
const intervals = [];
let codeIndexWorker, codeIndexInfo, codeIndexTimer = null, codeIndexWorkspace = null;
function startCodeIndex(target) {
  if (codeIndexWorker) codeIndexWorker.postMessage('close');
  codeIndexWorkspace = target;
  const dir = path.join(os.tmpdir(), 'dispatch-code-index', crypto.createHash('sha256').update(path.resolve(target)).digest('hex'));
  codeIndexInfo = path.join(dir, `connection-${crypto.randomUUID()}.json`);
  const worker = new Worker(path.join(__dirname, 'code-index-worker.cjs'), { workerData: { root: target, dir, info: codeIndexInfo, token: crypto.randomBytes(24).toString('hex') } });
  codeIndexWorker = worker;
  worker.on('message', m => { if (m.type === 'error') console.error('Code index:', m.message); });
  worker.on('error', e => console.error('Code index worker:', e.message));
}

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
function switchChat(name, id) { const saved = operation?.agents.find(a => a.name === name); if (!saved) throw new Error('Agent not found'); if (name !== 'boss' && id) throw new Error('Only Boss chats can be resumed'); const target = id ? readChat(name, id) : null; if (id && !target) throw new Error('Chat not found'); if (target && !demo && (!target.sessionId || !['claude','codex'].includes(saved.provider))) throw new Error(`Cannot resume this ${saved.provider} chat: provider session ID or resume support is unavailable.`); const old = processes.get(name); const queued = old ? [...(old.inFlight ? [old.inFlight] : []), ...old.queue] : []; if (old) { clearTimeout(old.timer); setAttention(name, old, null); processes.delete(name); old.terminal.kill(); } const chat = target || createChat(saved); if (name !== 'boss') { for (const previous of chats(name)) if (previous.id !== chat.id) fs.unlinkSync(chatPath(name, previous.id)); } saved.chatId = chat.id; saved.sessionId = chat.sessionId; saved.stopped = false; saveOperation(); const agent = startAgent(name, saved.template, saved.enlistedBy, saved, !!target); for (const item of queued) if (!agent.queue.some(x => x.file === item.file)) agent.queue.push(item); agent.queue = agent.queue.map(item => ({ ...item, previous: true })); return chat; }
const processes = new Map();
const pendingAsks = new Set();
const trustFile = () => path.join(workspace, '.dispatch', 'trust.json');
function trusted() { try { return JSON.parse(fs.readFileSync(trustFile(), 'utf8')).trusted === true; } catch { return false; } }
function setAttention(name, agent, reason) {
  if (agent.attention === reason) return; if (reason !== 'Trust folder') agent.trustInteracted = false; agent.attention = reason; agent.blocked = BLOCKING.includes(reason);
  if (agent.blocked) hold(agent);
  notify('attention', { name, reason });
  if (reason === 'Approve command') tgApprovalSoon(name, agent); else if (agent.tgApproval) tgApprovalGone(name, agent);
}
// ── Command approvals on the phone: a menu still open after 20 s (nobody at the desk) goes to Telegram with
// Approve / Deny buttons. Every menu of the three CLIs starts on "1. Yes": Enter approves, Esc declines. ──
function tgApprovalSoon(name, agent) {
  if (agent.tgApproval || !telegram.connected()) return;
  const a = agent.tgApproval = { nonce: crypto.randomBytes(5).toString('hex'), summary: '', messageId: null };
  a.timer = setTimeout(async () => {
    if (agent.tgApproval !== a) return;
    if (processes.get(name) !== agent || agent.attention !== 'Approve command') { agent.tgApproval = null; return; }
    a.summary = approvalSummary(agent.promptBuffer) || 'A command waits for approval.';
    a.head = `[${path.basename(workspace)} · ${name}] needs your approval:`;
    try { a.messageId = await telegram.send(`${a.head}\n${a.summary}`, { buttons: [[{ text: 'Approve', data: `ap:${a.nonce}:y` }, { text: 'Deny', data: `ap:${a.nonce}:n` }]] }); } catch { agent.tgApproval = null; }
  }, 20e3);
}
// The menu went away (answered in Dispatch, or the screen redrew). Checked again after a moment: the detection
// flickers while the TUI redraws, and a flicker must not mark the phone's message answered.
function tgApprovalGone(name, agent) {
  const a = agent.tgApproval; if (!a || a.answered) return;
  setTimeout(() => {
    if (agent.tgApproval !== a || (processes.get(name) === agent && agent.attention === 'Approve command')) return;
    clearTimeout(a.timer); agent.tgApproval = null;
    if (a.messageId) void telegram.edit(a.messageId, `${a.head}\n${a.summary}\n\nAnswered in Dispatch.`);
  }, 3000);
}
function telegramButton(data) {
  const m = /^ap:([0-9a-f]+):([yn])$/.exec(data); if (!m) return null;
  const entry = [...processes.entries()].find(([, ag]) => ag.tgApproval?.nonce === m[1]); if (!entry) return null;
  const [name, agent] = entry, a = agent.tgApproval, yes = m[2] === 'y';
  if (agent.attention !== 'Approve command' || a.answered) { agent.tgApproval = null; return { toast: 'Already answered.', text: `${a.head}\n${a.summary}\n\nAlready answered.` }; }
  a.answered = true; clearTimeout(a.timer);
  agent.promptBuffer = ''; agent.awaitingAnswer = true; typeKeys(agent, yes ? '\r' : '\x1b', 0);
  setTimeout(() => { if (agent.tgApproval === a) agent.tgApproval = null; }, 5000);
  emitMessage({ from: 'you', to: name, text: `[via Telegram] ${yes ? 'Approved' : 'Denied'}: ${a.summary.split('\n')[0]}` });
  // Declined, the CLI stops its turn and waits: the lead must know, or it waits for a report that never comes.
  if (!yes && name !== 'boss') { const lead = agent.enlistedBy && processes.has(agent.enlistedBy) ? agent.enlistedBy : processes.has('boss') ? 'boss' : null; if (lead) void sendMessage(lead, `${name}: the user denied its command from Telegram (${a.summary.split('\n')[0]}). It has stopped; give it new instructions.`, 'dispatch').catch(() => {}); }
  return { toast: yes ? 'Approved' : 'Denied', text: `${a.head}\n${a.summary}\n\n${yes ? 'Approved' : 'Denied'} from Telegram.` };
}
// One line per agent for /status on Telegram.
function teamStatus() {
  return (operation?.agents || []).map(a => { const p = processes.get(a.name); let s = 'stopped'; if (p) { let w = false; try { w = isWorking(a.name); } catch {} s = p.attention ? p.attention.toLowerCase() : w ? 'working' : 'idle'; } return { name: a.name, state: s }; });
}
function clearAttention(name, agent) {
  if (!agent.attention && !agent.blocked && !agent.awaitingAnswer && !agent.held) return;
  agent.awaitingAnswer = false; agent.held = false; clearTimeout(agent.trustTimer); agent.trustTimer = null;
  agent.promptBuffer = '';
  if (agent.attention) setAttention(name, agent, null); else agent.blocked = false;
  if (!agent.ready) setTimeout(agent.initialize, 1000); else if (agent.queue.length) deliver(agent);
}
// Nothing may be pasted while a prompt waits for a key. A message being pasted when the prompt came up must not get
// its Enter (in Claude's trust menu that picks "No, exit" and the agent quits): it goes back to the front of the queue.
function hold(agent) {
  agent.blocked = true; clearTimeout(agent.timer);
  if (agent.submitting) { const item = agent.inFlight; agent.submitting = false; agent.inFlight = null; if (item && !agent.queue.some(x => x.file === item.file)) agent.queue.unshift(item); }
}
function answerTrust(agent) {
  if (agent.attention !== 'Trust folder' || !trusted() || agent.trustInteracted) return;
  const answer = trustAnswer(agent.template.provider, agent.promptBuffer || '');
  if (!answer) return false;
  agent.promptBuffer = ''; agent.awaitingAnswer = true; typeKeys(agent, answer);
  return true;
}
// Menu keys one at a time, after the menu has settled. Down and Enter in one write reached Claude's trust menu as
// one input: Enter took the row that was selected before (No, exit) and the agent quit.
function typeKeys(agent, keys, first = 400) {
  const parts = String(keys).match(/\x1b\[[A-D]|\r|[^\x1b\r]+/g) || [];
  agent.answering = true; // no message is pasted between the keys
  parts.forEach((k, i) => setTimeout(() => { try { agent.terminal.write(k); } catch {} }, first + i * 250));
  setTimeout(() => { agent.answering = false; if (agent.ready && !agent.blocked && agent.queue.length) deliver(agent); }, first + parts.length * 250 + 300);
}

// ── Questions an agent asks with Claude's AskUserQuestion: shown in the chat (and on Telegram), answered from there ──
function showQuestion(name, agent, ask) {
  agent.question = { ...ask, at: new Date().toISOString() };
  notify('question', { name, question: agent.question });
  // A conversation from the phone is going on with this agent: ask there too, the reply answers it.
  if (telegram.connected() && tgOwner() === name && Date.now() - tgWaiting < 30 * 60e3) {
    const text = ask.questions.map(q => `${q.question}${q.multiSelect ? ' (several allowed: 1,3)' : ''}\n${q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` (${o.description})` : ''}`).join('\n')}`).join('\n\n');
    void telegram.send(`[${path.basename(workspace)}${name !== 'boss' ? ` · ${name}` : ''}] ${name} asks:\n${text}\n\nReply with a number, or write your own answer.`).catch(() => {});
  }
}
function clearQuestion(name, agent) { if (!agent?.question) return; agent.question = null; notify('question', { name, question: null }); }
// A typed reply to a one-question menu: "2" or "1, 3" picks options, anything else is the user's own answer.
function replyAsAnswer(q, text) {
  const t = String(text).trim();
  if (/^\d+(\s*[,\s]\s*\d+)*$/.test(t)) { const picks = t.split(/[,\s]+/).map(n => Number(n) - 1).filter(p => p >= 0 && p < q.options.length); if (picks.length) return { picks: q.multiSelect ? picks : picks.slice(0, 1) }; }
  return { picks: [], other: t };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function answerQuestion(name, answers, via = '') {
  const agent = processes.get(name), q = agent?.question;
  if (!q) throw new Error(`${name} has no open question. It may have been answered in its terminal.`);
  if (agent.answering) throw new Error(`${name} is already taking an answer.`);
  const groups = activity.questionKeys(q.questions, Array.isArray(answers) ? answers : []);
  agent.answering = true; clearTimeout(agent.timer);
  try {
    agent.promptBuffer = '';
    for (const keys of groups) { for (const k of keys) { agent.terminal.write(k); await sleep(k.length > 4 ? 300 : 140); } await sleep(500); }
    // Several questions, or several choices, end on a "Review your answers" step; its first row submits.
    for (let i = 0; i < 16; i++) { if (/ready to submit your answers\?/.test(normalize(String(agent.promptBuffer || '').slice(-3000)))) { agent.terminal.write('\r'); break; } await sleep(150); }
  } finally { agent.answering = false; }
  agent.promptBuffer = ''; agent.awaitingAnswer = true;
  const said = q.questions.map((x, i) => { const a = answers[i] || {}; const picked = (a.picks || []).map(p => x.options[p]?.label).filter(Boolean); if (a.other) picked.push(String(a.other).trim()); return `${q.questions.length > 1 ? `${x.header || x.question}: ` : ''}${picked.join(', ')}`; }).join('\n');
  emitMessage({ from: 'you', to: name, text: via ? `[via ${via}] ${said}` : said });
  clearQuestion(name, agent);
  setTimeout(() => { if (processes.get(name) === agent && !agent.blocked && agent.queue.length) deliver(agent); }, 1500);
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
function notify(channel, value) { host.send(channel, value); taskEvent(channel, value); }
// Task board (tasks.cjs): work a lead hands an agent, as cards. Fed by the same events the window gets.
const leadOf = name => {
  const saved = name !== 'boss' && operation?.agents.find(a => a.name === name); if (!saved) return null;
  const by = saved.enlistedBy || processes.get(name)?.enlistedBy;
  return by && !['you', 'user'].includes(by) && operation.agents.some(a => a.name === by) ? by : 'boss';
};
const taskBoard = createTaskBoard({ file: () => operation ? path.join(operationsDir(), operation.id, 'tasks.json') : null, leadOf, onChange: list => host.send('tasks', list), mirror: () => path.join(workspace, '.dispatch', 'tasks.json') });
function taskEvent(channel, value) {
  try {
    if (channel === 'message') taskBoard.message(value);
    else if (channel === 'attention' && value?.name) taskBoard.attention(value.name, value.reason);
    else if (channel === 'exit') taskBoard.stopped(value, 'Exited');
    else if (channel === 'agent-action' && ['stop', 'dismiss', 'restart'].includes(value?.action)) taskBoard.stopped(value.name, value.action === 'restart' ? 'Restarted' : 'Stopped');
  } catch (error) { console.error('Task board:', error.message); }
}
// Terminal text goes to the window in batches (every 30 ms), not one IPC message per chunk: many busy agents sent
// hundreds a second and the window stuttered.
const termBatch = new Map(); let termTimer = null;
function terminalOut(name, data) {
  termBatch.set(name, (termBatch.get(name) || '') + data);
  if (!termTimer) termTimer = setTimeout(() => { termTimer = null; const items = [...termBatch]; termBatch.clear(); for (const [n, d] of items) notify('terminal', { name: n, data: d }); }, 30);
}
const bossProviderFile = () => path.join(workspace, '.dispatch', 'boss-providers.json');
function bossProviders() { try { const data = JSON.parse(fs.readFileSync(bossProviderFile(), 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } }
const providerEnabled = (id) => bossProviders()[id]?.enabled !== false;
const visibilityFile = () => path.join(workspace, '.dispatch', 'boss-visible-templates.json');
// The boss is only offered templates whose CLI is on this computer; a built-in Codex coder on a machine without Codex
// only ended in "codex" was not found" errors. Cached for a minute so an install is picked up.
const installedCache = new Map();
function providerInstalled(provider) {
  if (demo) return true;
  const command = provider === 'antigravity' ? 'agy' : provider === 'qoder' ? 'qodercli' : provider === 'local' || String(provider).startsWith('local:') ? 'opencode' : provider;
  const hit = installedCache.get(command); if (hit && Date.now() - hit.at < 60000) return hit.ok;
  let ok = true; try { resolveCommand(command); } catch { ok = false; }
  installedCache.set(command, { ok, at: Date.now() }); return ok;
}
function bossVisibleTemplates() {
  let selected = null;
  try { const value = JSON.parse(fs.readFileSync(visibilityFile(), 'utf8')); if (Array.isArray(value)) selected = new Set(value); } catch {}
  return templates.list(workspace).filter(t => t.extra?.role !== 'boss' && providerEnabled(t.provider) && providerInstalled(t.provider) && (selected === null || selected.has(t.file)));
}
function watch() {
  watcher?.close();
  clearTimeout(codeIndexTimer);
  codeIndexWorkspace = null;
  storage.migrate(workspace);
  // Defer full-repo tree-sitter + chokidar indexing until after first paint so boot I/O stays fast.
  const indexTarget = workspace;
  codeIndexTimer = setTimeout(() => { codeIndexTimer = null; if (workspace === indexTarget) startCodeIndex(indexTarget); }, 1500);
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
// Notes delivered with an agent's next message instead of as a message of their own, so they never wake it up.
const quietNotes = new Map();
function deliver(agent) {
  if (agent.submitting || agent.blocked || agent.answering || !agent.ready) return;
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
    // A note for this agent that must not start a turn of its own (e.g. it now answers Telegram) rides along with the next real message.
    const who = item.msg.to; const note = item.msg.from !== 'dispatch' && quietNotes.get(who); if (note) quietNotes.delete(who);
    const setup = agent.setup ? `${agent.setup}\n\n` : ''; agent.setup = null;
    const text = `${setup}[Dispatch] message from ${item.msg.from} (id ${item.msg.id})${item.previous ? ' (from previous chat)' : ''}: ${item.msg.text}${note ? `

(Dispatch note: ${note})` : ''}`;
    agent.submitting = true; agent.lastFrom = item.msg.from;
    // It now owes whoever wrote a reply; the watchdog below speaks up if it goes quiet without one.
    if (item.msg.from !== 'dispatch') agent.owes = { to: item.msg.from, at: Date.now() };
    const wasIdle = !agent.turn, pastedAt = Date.now();
    try { agent.terminal.write(`\x1b[200~${text}\x1b[201~`); } catch {}
    // Press Enter only after the CLI has taken the whole paste in (its echo went quiet). A fixed 200 ms was too
    // early for long messages: the Enter landed inside the paste and the text sat in the prompt, never sent.
    const submit = () => {
      if (agent.blocked) return; // setAttention already put the message back in the queue
      const age = Date.now() - pastedAt;
      if (age < (midTurn && !wasIdle ? 800 : 3000) && (age < 350 || Date.now() - agent.lastOutput < 300)) { agent.timer = setTimeout(submit, 100); return; }
      try { agent.terminal.write('\r'); } catch {}
      agent.submitting = false; agent.inFlight = null; agent.deliveredAt = Date.now();
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
  // Already gone from the roster (removed elsewhere) but still on the user's screen: stopping or dismissing it just
  // clears what is left (a stray process, a "needs you" entry) and takes it off the screen, instead of an error.
  if (!saved && name !== 'boss' && (action === 'dismiss' || action === 'stop')) {
    const stray = processes.get(name);
    if (stray) { clearTimeout(stray.timer); setAttention(name, stray, null); processes.delete(name); try { stray.terminal.kill(); } catch {} }
    exited.delete(name); notify('attention', { name, reason: null });
    notify('agent-action', { name, action: 'dismiss' });
    return true;
  }
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
  const mcpConfig = mcp.configure(localProvider ? 'local' : provider, template, demo ? cmd => ({ file: cmd, args: [] }) : resolveCommand, localConfig ? localAI.envConfig(localConfig) : null, { memory: !!mem && mem.active().length > 0, servers: serverStore().list().some(s => s.access !== 'off'), connectors: connectorHub.forAgents(), agent: name, builtinEnv });
  const memoryOn = mcpConfig.ids.includes('memory');
  const memoryText = memoryOn ? (mem.settings().autoInject ? mem.overview().text : '') + `\nDispatch memory is on (${mem.active().join(' + ')}${mem.settings().bossCanWrite ? '' : ', read-only'}). Use the memory_* tools from the dispatch_memory server for all long-term memory, never your own built-in memory or memory files.` : '';
  const providerSettings = bossProviders();
  const providerInfo = [...providersLib.PROVIDERS.map(p => ({ id: p.id, name: p.name })), { id: 'local', name: 'Local AI' }].filter(p => providerEnabled(p.id)).map(p => { const settings = providerSettings[p.id] || {}; return `${p.name} (${p.id})${settings.plan && settings.plan !== 'unknown' ? ' · ' + settings.plan : ''}${settings.note ? ' · ' + settings.note : ''}`; }).join('\n');
  // Claude and Codex keep a transcript Dispatch can read, so their own replies go to the chat as written.
  const direct = !demo && ['claude', 'codex', 'antigravity'].includes(provider);
  const catalogue = bossVisibleTemplates().map(t => `${t.name}: ${t.description} (${t.provider}, ${t.model || 'default'}; Dispatch tools: ${mcp.selected(t).join(', ') || 'none'})`).join('\n');
  const allWorkflows = workflowsLib.list(workspace);
  const prompt = `${template.body || ''}${workflowsLib.promptFor(template, allWorkflows)}\nCode index (saves tokens): this workspace has a symbol index. Reading whole files and running broad searches costs many tokens, so look things up in the index first: to find a function, class, type or component, run dispatch index search <name>; it returns file paths and line numbers. Then read only those lines (offset/limit), not the whole file. If the command fails, finds nothing, or you need text that is not a symbol name, fall back to your usual way (grep, glob, reading files). The index may lag edits made in the last seconds, so check the lines you open.\nYou are ${name}. You report to ${name === 'boss' ? 'you (the user)' : enlistedBy && enlistedBy !== 'user' ? enlistedBy : 'boss'}. Squad: ${[...new Set([...operation.agents.map(a => a.name), ...rosterHint, name])].map(n => `${n} (${operation.agents.find(a => a.name === n)?.stopped ? 'stopped' : processes.has(n) || n === name ? 'running' : 'starting'})`).join(', ')}. ${direct
    ? `The user reads your replies in the Dispatch chat exactly as you write them here, rendered as Markdown. ${name === 'boss' ? 'To talk to the user' : 'When a message is from you (the user)'}, simply write your answer as your normal final reply: use short paragraphs, headings, lists, tables and code blocks where they help. Never run dispatch send --to you; that would show the user a second, unformatted copy. Use dispatch send only for other agents: when another agent gave you the task or you need its input, report with dispatch send --to <agent> "<report>".`
    : `When you finish a task or need input, report to the requester using dispatch send --to <requester> "<short report>". For a message from you, run dispatch send --to you "<short report>"; for a message from another agent, use that agent's name.`} A message with line breaks, quotes or backticks gets cut by the shell: write it to a file and send it with dispatch send --to <agent> --file <path> (dispatch spawn takes --task-file <path> the same way). Keep reports to other agents short. Use dispatch list to see the squad.${name === 'boss' ? ' Use dispatch tasks to see what each agent is doing instead of reading logs.' : ''}${name === 'boss' ? `\nAvailable providers (plan and notes are supplied by the user):\n${providerInfo}\nTemplate catalogue:\n${catalogue}\nUse dispatch spawn --template <name> --name <id> --task <task> and dispatch template create --name <name> --provider <provider> --description <description> --role <prompt>.${workflowsLib.catalogueFor(allWorkflows)}\n${SCHEDULE_HELP}${telegramHelp()}` : (tgOwner() === name ? telegramHelp(name) : '')}\nShared outputs: save every finished deliverable (images, video, audio, documents, exports) in ${path.join(workspace, '.dispatch', 'outputs', name)} so the user and the other agents can find it. Run dispatch outputs [agent] to see what the squad has produced and reuse those files by path. To show an image in the chat, save it in that folder and write ![short description](<full path>) in your reply; the user sees the image itself.${host.customTools?.prompt() || ''}${mcpConfig.connected.length ? `\nConnected apps (MCP, signed in by the user in Dispatch): ${mcpConfig.connected.join(', ')}. Their tools come from the mcp_* servers; use them when a task involves these apps.` : ''}${memoryText}`;
  if (!saved) { saved = { name, template, provider, model: template.model || '', enlistedBy }; operation.agents.push(saved); createChat(saved); resumeSession = false; } else if (!saved.chatId) { const previousSession = saved.sessionId; const chat = createChat(saved); if (previousSession) { chat.sessionId = previousSession; saved.sessionId = previousSession; writeChat(name, chat); saveOperation(); } }
  const account = accountsLib.PROVIDERS.includes(provider) ? accountFor(provider, saved.accountId) : null;
  if (account) saved.accountId = account.id;
  const session = saved.sessionId;
  // Claude can only resume a session it has written down. An agent that never got a message has none yet
  // (a team member without a task, a fresh chat): resuming it fails with "No conversation found" and the agent dies.
  if (provider === 'claude' && resumeSession && !demo && !fs.existsSync(activity.claudeFile(workspace, session, account?.dir))) resumeSession = false;
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
  // Permission / approval mode. '' means the CLI's own setting. Codex takes a sandbox mode or an approval policy.
  const permission = !localProvider && template.permission && (providersLib.PERMISSIONS[provider] || []).includes(template.permission) ? template.permission : '';
  if (permission) {
    if (provider === 'codex') {
      if (permission === 'never') args.push('-a', 'never');
      else if (permission === 'bypass') args.push('--dangerously-bypass-approvals-and-sandbox');
      else args.push('-s', permission);
    } else if (provider === 'claude') args.push('--permission-mode', permission);
    else if (provider === 'antigravity') { if (permission === 'bypass') args.push('--dangerously-skip-permissions'); else args.push('--mode', permission); }
  }
  // Dispatch skills are Claude Code plugins: the boss always gets them, other Claude agents only if the user chose so.
  if (provider === 'claude' && !demo) { const sk = skillStore(); if (name === 'boss' || sk.settings().claudeAgents) for (const dir of sk.pluginDirs()) args.push('--plugin-dir', dir); }
  if (provider === 'claude') args.push('--append-system-prompt', prompt, resumeSession ? '--resume' : '--session-id', session);
  const resolved = demo ? null : resolveCommand(command);
  const accountEnv = account ? accountsLib.envFor(provider, account) : {};
  const terminal = demo ? createDemoTerminal(name, workspace, bin()) : pty.spawn(resolved.file, [...resolved.args, ...args], { name: 'xterm-256color', cols: 100, rows: 30, cwd: workspace, env: { ...process.env, ...accountEnv, ...mcpConfig.env, ...(memoryOn && provider === 'claude' && mem.settings().disableProviderMemory ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } : {}), DISPATCH_INDEX_INFO: codeIndexInfo || '', DISPATCH_AGENT: name, MYARMY_AGENT: name, DISPATCH_HOME: path.join(workspace, '.dispatch'), MYARMY_HOME: path.join(workspace, '.dispatch'), PATH: `${path.dirname(bin())}${path.delimiter}${process.env.PATH}` } });
  const agent = { terminal, queue: [], output: '', lastOutput: Date.now(), atPrompt: false, template, session, enlistedBy, command, args, prompt, tracksTurns: direct, accountId: account?.id || null, accountDir: account?.dir || null }; processes.set(name, agent);
  // Transcript: live thinking, tool steps and interim text for the chat, the real turn state, and the reply itself.
  // agy is started without --conversation, so it always opens a new conversation: following the saved one watched
  // a file nothing writes to any more, and the chat stayed empty after every restart. Find the new one instead.
  const watchSession = provider === 'antigravity' ? null : session;
  if (!demo) agent.stopActivity = activity.watch({ provider, cwd: workspace, session: watchSession, name, accountDir: account?.dir, onSession: id => { if (saved && (!saved.sessionId || provider === 'antigravity')) { saved.sessionId = id; agent.session = id; saveOperation(); } }, onEvent: e => {
    if (processes.get(name) !== agent) return;
    agent.eventAt = Date.now();
    // A turn the transcript never announced with a user line (a reply to a background task's notice): its first
    // assistant line starts it, or the agent looked idle while it worked.
    if (e.turn === undefined && e.steps.length && agent.turnKnown && !agent.turn) e = { ...e, turn: true };
    // Open tool calls, so the stall watchdog never interrupts a long build; a new assistant step ends a stall.
    const tools = e.steps.filter(s => s.kind === 'tool').length;
    if (e.turn !== undefined) agent.toolsOpen = 0;
    agent.toolsOpen = Math.max(0, (agent.toolsOpen || 0) + tools - (e.answered ? e.answered.length : 0));
    if (e.steps.length) agent.stallNudged = false;
    if (e.turn === true) { agent.turn = true; agent.turnKnown = true; agent.hadTurn = true; agent.toldYou = false; agent.turnAt = Date.now(); agent.lastText = ''; }
    const said = e.steps.filter(s => s.kind === 'text').at(-1); if (said) agent.lastText = said.text;
    if (e.steps.length) agent.hadTurn = true;
    if (e.ask) showQuestion(name, agent, e.ask);
    if (e.answered && agent.question && e.answered.includes(agent.question.id)) clearQuestion(name, agent);
    let dropLastText = false;
    if (e.turn === false) {
      agent.turn = false; agent.turnKnown = true; agent.hadTurn = true; agent.turnEndAt = Date.now(); clearQuestion(name, agent);
      // The reply the agent wrote in its terminal is the chat message, formatting intact. The boss always talks to
      // the user; another agent does when the user was the one who wrote to it.
      const forYou = name === 'boss' || ['you', 'user'].includes(agent.lastFrom);
      if (direct && e.final && forYou && !agent.toldYou) { dropLastText = agent.lastText === e.final; emitMessage({ from: name, to: 'you', text: e.final }); }
      // An agent working for another agent must report with dispatch send, and often ends the
      // turn without doing it (or the send fails). Codex does this a lot. The final reply is in the transcript: pass it
      // on to whoever is waiting, if nothing came. Codex marks every turn end (task_complete), even one with no text.
      const shown = direct && e.final && forYou;
      if (!shown && agent.owes && (e.final || provider === 'codex')) {
        const owes = agent.owes, final = e.final || `${name} ended its turn without a reply or a report.`;
        setTimeout(() => {
          // Went on working (it was only waiting on a command): that text was not the end; the real one comes later.
          if (agent.owes !== owes || processes.get(name) !== agent || agent.turn) return;
          agent.owes = null;
          const text = `${final}\n\n(Dispatch: ${name} ended its turn without sending this; forwarded from its transcript.)`;
          if (['you', 'user'].includes(owes.to) || !processes.has(owes.to)) emitMessage({ from: name, to: 'you', text }); else void sendMessage(owes.to, text, name).catch(() => {});
        }, 2500);
      }
    }
    if (shouldClearAttention(agent.attention, { turn: e.turn, hasSteps: e.steps.length > 0 })) clearAttention(name, agent);
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
  // Busy TUIs (spinners) send dozens of chunks a second per agent. Trimming the 200 KB buffer on every chunk copied
  // it each time and froze the main process (window could not even be moved) with many agents: trim only past 300 KB.
  terminal.onData(data => { agent.sawOutput = true; noteProgress(agent, data, name); if (provider === 'antigravity' && /[⠁-⣿]/.test(data)) agent.spinAt = Date.now(); agent.output += data; if (agent.output.length > 300000) agent.output = agent.output.slice(-200000);
    agent.promptBuffer = ((agent.promptBuffer || '') + data).slice(-5000);
    // A choice the CLI wants that has one safe answer (Codex: keep the model when the limit is near).
    const nudge = nudgeAnswer(provider, agent.promptBuffer);
    if (nudge && Date.now() - (agent.nudgedAt || 0) > 5000) { agent.nudgedAt = Date.now(); setTimeout(() => { if (processes.get(name) !== agent) return; agent.promptBuffer = ''; try { terminal.write(nudge); } catch {} }, 700); }
    if (!agent.hadTurn && (agent.turnKnown || isWorking(name))) agent.hadTurn = true;
    const detected = attentionFrom(agent.promptBuffer, { provider, hadTurn: agent.hadTurn });
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
    // The detection flickers while the screen redraws, so awaitingAnswer alone let the same prompt be told dozens of times.
    if (detected === 'Approve command' && !agent.awaitingAnswer && name !== 'boss' && Date.now() - (agent.approveToldAt || 0) > 10 * 60 * 1000) {
      agent.approveToldAt = Date.now();
      const lead = agent.enlistedBy && processes.has(agent.enlistedBy) ? agent.enlistedBy : processes.has('boss') ? 'boss' : null;
      if (lead && lead !== name) void sendMessage(lead, `${name} (${provider}) is paused, waiting for the user to approve a command in its terminal. If this keeps happening, recreate it with auto-approve: dispatch spawn ... --auto-approve, or dispatch template create ... --auto-approve.`, 'dispatch').catch(() => {});
    }
    if (detected === 'Sign in' && !agent.signinTold) { agent.signinTold = true; tellSignIn(name, agent, provider, false); }
    // The prompt is gone from the screen (answered here, in the terminal, or by the CLI itself): the agent is free
    // again. Without this one "needs you" stuck for good and every later message waited in the queue.
    if (!detected && (agent.awaitingAnswer || agent.attention || agent.held)) { agent.awaitingAnswer = false; agent.held = false; clearTimeout(agent.trustTimer); agent.trustTimer = null; if (agent.attention) setAttention(name, agent, null); else agent.blocked = false; if (!agent.ready) setTimeout(agent.initialize, 1000); else if (agent.queue.length) deliver(agent); }
    if (detected && !agent.awaitingAnswer) {
      // A project already trusted in Dispatch (this tab's folder, .dispatch/trust.json): the CLI's trust menu is
      // answered quietly. Showing the dialog first only made it flash up and vanish. It shows if no answer fits.
      if (detected === 'Trust folder' && !agent.attention && !agent.trustInteracted && trusted()) {
        hold(agent); agent.held = true;
        const answer = trustAnswer(provider, agent.promptBuffer || '');
        if (answer) { clearTimeout(agent.trustTimer); agent.trustTimer = null; agent.promptBuffer = ''; agent.awaitingAnswer = true; typeKeys(agent, answer, 700); }
        else if (!agent.trustTimer) agent.trustTimer = setTimeout(() => { agent.trustTimer = null; if (processes.get(name) === agent && agent.held && !agent.awaitingAnswer) setAttention(name, agent, 'Trust folder'); }, 3000);
      } else { setAttention(name, agent, detected); if (detected === 'Trust folder' && trusted()) answerTrust(agent); }
    }
    agent.lastOutput = Date.now(); const codexState = [...data.matchAll(/\x1b\]7501;state=(idle|working|done):app=codex/g)].at(-1); if (codexState) { agent.codexStateKnown = true; agent.atPrompt = codexState[1] !== 'working'; if (codexState[1] === 'working') agent.turnAt = Date.now(); if (shouldClearAttention(agent.attention, { codexState: codexState[1] })) clearAttention(name, agent); } else if (provider !== 'codex') agent.atPrompt = /(?:^|[\r\n])\s*[>\u276f$]\s*$/.test(agent.output.slice(-4000).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')); if (agent.queue.length && (provider !== 'codex' || agent.atPrompt)) deliver(agent); terminalOut(name, data); });
  terminal.onExit(() => { agent.stopActivity?.(); clearQuestion(name, agent); if (processes.get(name) === agent) {
    processes.delete(name); clearTimeout(agent.timer); setAttention(name, agent, null); notify('exit', name);
    // Died on its own: mark it stopped (card shows it) and tell whoever enlisted it.
    const entry = operation?.agents.find(a => a.name === name);
    if (entry) { entry.stopped = true; saveOperation(); notify('agent-action', { name, action: 'stop' }); }
    const lead = name === 'boss' ? null : agent.enlistedBy && !['you', 'user'].includes(agent.enlistedBy) && processes.has(agent.enlistedBy) ? agent.enlistedBy : 'boss';
    // Quit because it is not signed in (Antigravity does this): say exactly that, not just "exited".
    if (!agent.signinTold && (attentionFrom(String(agent.output || '').slice(-8000), { provider, hadTurn: agent.hadTurn }) === 'Sign in' || (provider === 'antigravity' && /not logged into antigravity/i.test(String(agent.output || ''))))) { agent.signinTold = true; tellSignIn(name, agent, provider, true); return; }
    // Nobody can be told (the boss itself died, or the boss is down too): show it to the user in the attention bar and chat.
    if (!lead || !processes.has(lead)) { exited.add(name); notify('attention', { name, reason: 'Exited' }); notify('message', recordMessage({ id: crypto.randomUUID(), from: 'dispatch', to: 'you', text: `${name} exited unexpectedly. Restart it from the bar at the top.`, kind: 'send', time: new Date().toISOString() })); }
    else if (lead !== name) void sendMessage(lead, `${name} exited unexpectedly. dispatch restart ${name} brings it back.`, 'dispatch').catch(() => {});
  } });
  const startedAt = Date.now();
  const initialize = () => {
    if (agent.blocked || processes.get(name) !== agent) return;
    // Claude in a project it has not seen yet draws its trust question a moment after start. Wait until its screen
    // has settled (or 10 s), so the first message is never pasted while that question is coming up.
    if (!demo && provider === 'claude' && Date.now() - startedAt < 10000 && (!agent.lastOutput || Date.now() - agent.lastOutput < 800 || !agent.sawOutput)) { agent.timer = setTimeout(initialize, 300); return; }
    if (!demo && provider !== 'claude') {
      // The role text rides along with the first real message. Sent alone it was a turn of its own: the agent
      // answered it and started working by itself on every start and resume, with nobody asking.
      agent.setup = prompt.replace(/\n/g, ' '); agent.ready = true; if (agent.queue.length) deliver(agent);
    } else { agent.ready = true; if (agent.queue.length) deliver(agent); }
  };
  agent.initialize = initialize;
  setTimeout(initialize, 2000);
  return agent;
}
// Watchdog: an agent that got a task, then went quiet (idle at its prompt, or no terminal output for minutes)
// without sending a single message back. Its requester would wait forever, so tell the requester (or the user).
// Real progress on screen (spinner redraws and elapsed timers do not count), for the stall watchdog below.
function noteProgress(agent, data, name) {
  const key = progressKey(data); if (!key) return;
  const seen = agent.seenKeys || (agent.seenKeys = new Set()); if (seen.has(key)) return;
  seen.add(key); if (seen.size > 300) seen.delete(seen.values().next().value);
  agent.progressAt = Date.now(); if (name) taskBoard.progress(name);
}
// Stall watchdog: the CLI still shows "working" (its spinner and timer keep redrawing, so lastOutput never goes quiet)
// but neither its transcript nor its screen has moved for minutes: the API stream died. Seen: the boss "thinking" for
// 22 min, nothing in the chat, until the user typed "continue" in its terminal. Say so in the chat and, once per
// stall, press Esc and send "continue" for it. Never while a tool runs (Esc would kill a long build): only told.
const STALL_THINKING = 6 * 60000, STALL_TOOL = 20 * 60000;
function nudgeStalled(agent) {
  agent.answering = true; clearTimeout(agent.timer); agent.stallNudged = true;
  const write = k => { try { agent.terminal.write(k); } catch {} };
  write('\x1b');
  setTimeout(() => write('\x1b[200~continue\x1b[201~'), 1500);
  setTimeout(() => { write('\r'); agent.answering = false; if (agent.ready && !agent.blocked && agent.queue.length) deliver(agent); }, 2300);
}
intervals.push(setInterval(() => {
  for (const [name, agent] of processes) {
    let working = false; try { working = isWorking(name); } catch {}
    if (!working || agent.attention || agent.blocked || agent.question || agent.submitting || agent.answering) continue;
    const since = Math.max(agent.progressAt || 0, agent.eventAt || 0, agent.turnAt || 0);
    const quiet = Date.now() - since, tool = agent.toolsOpen > 0;
    if (quiet < (tool ? STALL_TOOL : STALL_THINKING) || (agent.stallToldAt || 0) > since) continue;
    agent.stallToldAt = Date.now(); taskBoard.stalled(name);
    const provider = agent.template?.provider, nudge = !tool && !agent.stallNudged && ['claude', 'codex'].includes(provider);
    const note = `${name} looks stuck: it shows as working, but nothing has changed in its terminal or transcript for ${Math.round(quiet / 60000)} min${tool ? ' (a command is still running)' : ''}.${nudge ? ' Dispatch pressed Esc and sent "continue" to it.' : ` Check its terminal; Esc then "continue" usually gets it going.`}`;
    if (nudge) nudgeStalled(agent);
    const lead = name === 'boss' ? null : agent.enlistedBy && processes.has(agent.enlistedBy) ? agent.enlistedBy : processes.has('boss') ? 'boss' : null;
    if (lead && lead !== name) void sendMessage(lead, note, 'dispatch').catch(() => {}); else emitMessage({ from: 'dispatch', to: 'you', text: note });
  }
}, 20000));
// A card waiting 3 min (approval, question, sign in) is told to its lead once; stalls are told by the watchdog above.
intervals.push(setInterval(() => { for (const n of taskBoard.dueNotices()) if (processes.has(n.lead)) void sendMessage(n.lead, n.text, 'dispatch').catch(() => {}); }, 20000));
const QUIET_IDLE = 60000, QUIET_ANY = 4 * 60000;
intervals.push(setInterval(() => {
  for (const [name, agent] of processes) {
    const owes = agent.owes; if (!owes || agent.attention || name === 'boss' && owes.to === 'you' && ['claude', 'codex'].includes(agent.command)) continue;
    const silent = Date.now() - (agent.lastOutput || owes.at);
    if (Date.now() - owes.at < QUIET_IDLE || !(agent.atPrompt ? silent > QUIET_IDLE : silent > QUIET_ANY)) continue;
    agent.owes = null; taskBoard.stalled(name);
    const tail = String(agent.output || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-6).join(' | ').slice(-500);
    const note = `${name} stopped working without reporting back (${agent.atPrompt ? 'idle at its prompt' : `no output for ${Math.round(silent / 60000)} min`}). Last lines in its terminal: ${tail || '(none)'}`;
    const to = owes.to === 'you' || owes.to === 'user' || !processes.has(owes.to) ? null : owes.to;
    if (to) void sendMessage(to, `${note}\nAsk it for a status with dispatch send --to ${name}, or restart it with dispatch restart ${name}.`, 'dispatch').catch(() => {});
    else emitMessage({ from: 'dispatch', to: 'you', text: note });
  }
}, 20000));
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
// Opens this tab's project: a given folder, or (first tab at launch) the last one used that no other tab has.
function init(target) {
  if (target) workspace = path.resolve(target);
  else {
    const last = recentWorkspaces().find(w => { try { return fs.statSync(w).isDirectory() && host.free(w); } catch { return false; } });
    // First start of an installed app: no folder yet. The window asks for one instead of quietly using the install folder.
    if (last) workspace = last; else if (app.isPackaged && !process.env.DISPATCH_TEST_HOME) needsFolder = true;
  }
  if (!needsFolder) { rememberWorkspace(); watch(); }
}
ipcMain.handle('workspace', async (_e, target) => { if (!target) { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (r.canceled) return workspace; target = r.filePaths[0]; } if (!fs.statSync(target).isDirectory()) throw new Error('Workspace is not a directory'); if (!host.free(target)) { host.focusFolder(target); return workspace; } switchWorkspace(target); host.changed(); return workspace; });
function switchWorkspace(target) { if (needsFolder || path.resolve(target) !== path.resolve(workspace)) { needsFolder = false; finishOperation(); stopAgents(); if (isMock(workspace) && !isMock(target)) { demo = process.argv.includes('--demo'); mockPrevious = null; } workspace = path.resolve(target); rememberWorkspace(); watch(); } }
// Measure main-process event-loop lag so the renderer loader stays up until the main thread is responsive.
let lastLagTick = performance.now(), lastMainLagAt = lastLagTick;
intervals.push(setInterval(() => {
  const now = performance.now();
  const drift = now - lastLagTick - 100;
  lastLagTick = now;
  if (drift >= 50) lastMainLagAt = now;
}, 100));
ipcMain.handle('app:ready', () => {
  const now = performance.now();
  if (now - lastLagTick - 100 >= 50) lastMainLagAt = now;
  return {
    ok: true,
    workspace,
    needsFolder,
    indexStarted: needsFolder || codeIndexWorkspace === workspace,
    mainQuietMs: Math.round(now - lastMainLagAt),
  };
});
ipcMain.handle('info', () => ({ workspace, needsFolder, demo, mock: isMock(workspace), operations: listOperations(), workspaces: recentWorkspaces() }));
ipcMain.handle('operations:list', () => listOperations());
ipcMain.handle('operations:delete', (_e, id) => { if (!/^[\w-]+$/.test(id)) throw new Error('Invalid operation'); if (operation?.id === id) { stopAgents(); operation = null; } fs.rmSync(path.join(operationsDir(), id + '.json'), { force: true }); void fs.promises.rm(path.join(operationsDir(), id), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {}); return listOperations(); });
ipcMain.handle('operations:resume', async (_e, id) => {
  const op = listOperations().find(o => o.id === id); if (!op) throw new Error('Operation not found');
  finishOperation(); stopAgents();
  let log = null; try { log = await fs.promises.readFile(logPath()); } catch {}
  const messages = log ? (op.segments || []).flatMap(s => log.subarray(s.start, s.end ?? log.length).toString('utf8').split('\n').map(parseMessage).filter(Boolean)) : [];
  const byId = new Map(messages.map(m => [m.id, m]));
  for (const a of op.agents) {
    if (a.name !== 'boss' && a.chatId) for (const m of messages) if (m.from === a.name || m.to === a.name) (m.chats ||= {})[a.name] = 'previous';
    const dir = path.join(operationsDir(), op.id, 'chats', a.name);
    try {
      const files = await fs.promises.readdir(dir);
      for (const file of files) {
        if (a.name !== 'boss' && file !== a.chatId + '.json') continue;
        const chat = JSON.parse(await fs.promises.readFile(path.join(dir, file), 'utf8'));
        for (const item of chat.messages) { const m = byId.get(item.id); if (m) (m.chats ||= {})[a.name] = chat.id; }
      }
    } catch {}
  }
  if (op.segments?.length && op.segments.at(-1).end == null) op.segments.at(-1).end = logSize();
  op.segments ||= []; op.segments.push({ start: logSize(), end: null });
  operation = op; saveOperation();
  const failed = [];
  for (const a of op.agents) if (!a.stopped || a.name === 'boss') {
    a.stopped = false;
    try { startAgent(a.name, a.template, a.enlistedBy, a); } catch (e) { a.stopped = true; failed.push({ name: a.name, text: `${a.name} could not start: ${e.message}` }); }
    await new Promise(r => setImmediate(r));
  }
  saveOperation();
  return { operation: op, messages, notes: [...failed, ...op.agents.filter(a => !a.stopped && a.provider !== 'claude' && !(a.provider === 'codex' && a.sessionId)).map(a => ({ name: a.name, text: `${a.name}: started a fresh ${a.provider} session; prior conversation is shown in chat.` }))] };
});
ipcMain.handle('chats:list', (_e, name) => chats(name).filter(c => name === 'boss' || c.id === operation?.agents.find(a => a.name === name)?.chatId).map(c => ({ ...c, active: c.id === operation?.agents.find(a => a.name === name)?.chatId })));
ipcMain.handle('chats:switch', (_e, name, id) => switchChat(name, id));
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
ipcMain.handle('ui:get', () => ({ ...readUi(), material: host.material ? host.material() : false }));
// ── Voice typing: local whisper.cpp, an in-chat mic and a global shortcut with a small overlay (FoneCue style) ──
const whisper = require('./whisper.cjs');
const VOICE_KEYS = ['Control+Alt+Space', 'Control+Shift+Space', 'Control+Alt+D', 'F9'];
const voiceLang = () => readUi().voiceLang || 'tr';
const voiceKey = () => VOICE_KEYS.includes(readUi().voiceShortcut) ? readUi().voiceShortcut : VOICE_KEYS[0];
ipcMain.handle('voice:status', () => ({ ...whisper.status(), lang: voiceLang(), mic: readUi().voiceMic || '', shortcut: voiceKey(), shortcuts: VOICE_KEYS, shortcutOk: host.voiceKeyOk() }));
ipcMain.handle('voice:warm', () => whisper.ensure(voiceLang()).then(() => true));
ipcMain.handle('voice:transcribe', (_e, wav) => whisper.transcribe(Buffer.from(wav), voiceLang()));
ipcMain.handle('ui:set', (_e, patch) => {
  const next = { ...readUi() };
  if (patch && ['studio', 'pixel', 'office', 'music'].includes(patch.scene)) next.scene = patch.scene;
  if (patch && typeof patch.hintSeen === 'boolean') next.hintSeen = patch.hintSeen;
  if (patch && typeof patch.ideOpen === 'boolean') next.ideOpen = patch.ideOpen;
  // Home > live usage switch. Off by default: nothing reads limits (or the Claude sign-in) until the user turns it on.
  if (patch && typeof patch.usageTracking === 'boolean') next.usageTracking = patch.usageTracking;
  if (patch && ['tr', 'en', 'auto'].includes(patch.voiceLang)) { if (next.voiceLang !== patch.voiceLang) whisper.stop(); next.voiceLang = patch.voiceLang; }
  if (patch && typeof patch.voiceMic === 'string' && patch.voiceMic.length <= 300) next.voiceMic = patch.voiceMic;
  if (patch && VOICE_KEYS.includes(patch.voiceShortcut)) { next.voiceShortcut = patch.voiceShortcut; setImmediate(host.registerVoiceKey); }
  // Terminal (Settings > Terminal): which shell the side panel opens, and where.
  if (patch && typeof patch.terminalShell === 'string' && /^[\w-]{1,20}$/.test(patch.terminalShell)) next.terminalShell = patch.terminalShell;
  for (const k of ['terminalPath', 'terminalArgs', 'terminalCwd']) if (patch && typeof patch[k] === 'string' && patch[k].length <= 1000) next[k] = patch[k].trim();
  // Settings > Appearance: menu icon set and how the Files panel behaves.
  if (patch && ['mono', 'color'].includes(patch.navIcons)) next.navIcons = patch.navIcons;
  // Settings > Appearance > Theme: id plus the user's color overrides (hex only). The window material follows the theme.
  if (patch && ['dark', 'light', 'frosted'].includes(patch.theme)) { next.theme = patch.theme; setImmediate(() => host.setTheme && host.setTheme(patch.theme)); }
  if (patch && patch.themeColors && typeof patch.themeColors === 'object') {
    const clean = {};
    for (const [t, own] of Object.entries(patch.themeColors)) if (['dark', 'light', 'frosted'].includes(t) && own && typeof own === 'object') {
      clean[t] = {}; for (const k of ['accent', 'background', 'surface', 'text']) if (typeof own[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(own[k])) clean[t][k] = own[k];
    }
    next.themeColors = clean;
  }
  for (const k of ['ideEditorOnFile', 'ideTreeToggle']) if (patch && typeof patch[k] === 'boolean') next[k] = patch[k];
  if (patch && Number.isFinite(patch.ideWidth)) next.ideWidth = Math.max(420, Math.min(3000, Math.round(patch.ideWidth)));
  fs.mkdirSync(globalDir(), { recursive: true }); fs.writeFileSync(uiFile(), JSON.stringify(next, null, 2));
  return next;
});
ipcMain.handle('skills:list',() => ({ skills: skillStore().list(), settings: skillStore().settings(), roots: skillStore().roots }));
ipcMain.handle('skills:settings', (_e, patch) => skillStore().saveSettings({ claudeAgents: !!patch?.claudeAgents }));
// Skill board: the user's groups and which skill sits in which, kept with the other skill settings.
ipcMain.handle('skills:board', () => skillStore().settings().board || null);
ipcMain.handle('skills:board-save', (_e, board) => { const groups = Array.isArray(board?.groups) ? board.groups.slice(0, 60).map(g => ({ id: String(g.id), name: String(g.name).slice(0, 60), x: Number(g.x) || 0, y: Number(g.y) || 0 })) : []; const assign = Object.fromEntries(Object.entries(board?.assign || {}).slice(0, 5000).map(([k, v]) => [String(k), String(v)])); skillStore().saveSettings({ board: { groups, assign } }); return true; });
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
const accountStore = () => accountsLib.create(globalDir(), { userHome: userHome() });
const accountFor = (provider, accountId) => {
  if (!accountsLib.PROVIDERS.includes(provider)) return null;
  const st = accountStore();
  return (accountId && st.get(provider, accountId)) || st.active(provider);
};
const agentSkills = () => skillsLib.claudeSkills({ claudeHome: accountFor('claude')?.dir || path.join(userHome(), '.claude'), codexHome: accountFor('codex')?.dir || (process.env.DISPATCH_TEST_HOME ? path.join(userHome(), '.codex') : (process.env.CODEX_HOME || path.join(userHome(), '.codex'))), agentsHome: path.join(userHome(), '.agents'), workspace });
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
intervals.push(setInterval(runSchedules, 30000));
ipcMain.handle('schedules:list', () => scheduleStore().list());
ipcMain.handle('schedules:status', (_e, id, status) => { if (!['active', 'paused'].includes(status)) throw new Error('Unknown status'); scheduleStore().setStatus(String(id), status); return scheduleStore().list(); });
ipcMain.handle('schedules:remove', (_e, id) => { scheduleStore().remove(String(id)); return scheduleStore().list(); });
ipcMain.handle('schedules:run-now', (_e, id) => {
  if (!operation || !operation.agents.length) throw new Error('Open a chat with your team first; schedules run inside the open operation.');
  scheduleStore().runNow(String(id)); runSchedules(); return scheduleStore().list();
});

// ── Telegram (talk to the boss from the phone) ──────────────────
const telegram = host.telegram;
// A message from the phone for this project (main.cjs picked this tab by @name, a reply, or the default).
async function telegramIn(text, files = []) {
  const owner = tgOwner();
  if (!operation || !operation.agents.some(a => a.name === owner)) throw new Error(`No team is open in ${path.basename(workspace)}. Start a chat with the boss in Dispatch first.`);
  if (!processes.has(owner)) agentAction(owner, 'restart');
  tgWaiting = Date.now();
  // The owner is waiting on its own question: the message from the phone is the answer (a number picks an option).
  const asking = processes.get(owner)?.question;
  if (asking && !files.length && String(text).trim()) {
    if (asking.questions.length > 1) { await telegram.send(`[${path.basename(workspace)}] ${owner} asked several questions at once; answer them in Dispatch.`).catch(() => {}); return; }
    await answerQuestion(owner, [replyAsAnswer(asking.questions[0], text)], 'Telegram'); return;
  }
  const saved = [];
  for (const f of files) { try { saved.push(await telegram.download(f, path.join(workspace, '.dispatch', 'telegram'))); } catch (e) { saved.push(`(not received: ${e.message})`); } }
  const body = [text, saved.length ? `Files from the user (open them with your tools): ${saved.join(', ')}` : ''].filter(Boolean).join('\n');
  await sendMessage(owner, `[via Telegram, keep the answer short and plain text] ${body}`, 'you');
}
let tgWaiting = 0;
// The boss learns the Telegram commands (dispatch telegram owner ...) in its start prompt, but only if Telegram was
// already connected then. Connected later, it never knew it could hand Telegram over itself: tell it now, once.
let tgToldBoss = false;
// A message of its own would start a turn the user never asked for, so it rides along with the boss's next message.
function onTelegramChange() { const on = telegram.connected(); if (on && !tgToldBoss && processes.has('boss')) { tgToldBoss = true; quietNotes.set('boss', `Telegram is connected now.${telegramHelp('boss')}`); } if (!on) { tgToldBoss = false; quietNotes.delete('boss'); } }
// Who answers Telegram in this operation: the boss unless the boss or the user handed it to another agent.
function tgOwner() { const o = operation?.telegramOwner; return o && operation.agents.some(a => a.name === o) ? o : 'boss'; }
function setTgOwner(name) {
  if (!operation || !operation.agents.some(a => a.name === name)) throw new Error(`No agent ${name} in this operation.`);
  const before = tgOwner(); operation.telegramOwner = name === 'boss' ? undefined : name; saveOperation(); notify('telegram-owner', tgOwner());
  if (before !== name) {
    // Told with its next message (the first Telegram message, usually), not now: a message now made it start working by itself.
    quietNotes.delete(before);
    quietNotes.set(name, `You now answer the user's Telegram messages.${telegramHelp(name)}`);
    if (telegram.connected()) void telegram.send(`[${path.basename(workspace)}] Telegram is now answered by ${name}.`).catch(() => {});
  }
  return tgOwner();
}
// The owner's replies and Dispatch's own notices (limit, sign-in, an agent gone quiet) go back to Telegram only while
// a Telegram conversation with this project is going (30 min). Before, every newly opened project tab sent its
// start-up notices to the phone although the user never talked to it from there; they still show in Dispatch.
function tgForward(msg) {
  if (!telegram.connected()) return;
  const owner = tgOwner();
  if (Date.now() - tgWaiting >= 30 * 60e3 || (msg.from !== owner && msg.from !== 'dispatch')) return;
  const where = `[${path.basename(workspace)}${owner !== 'boss' ? ` · ${owner}` : ''}]`;
  void telegram.send(msg.from === owner ? `${where} ${msg.text}` : `${where} Dispatch: ${msg.text}`).catch(() => {});
}
function telegramHelp(name = 'boss') {
  if (!telegram.connected()) return '';
  const owner = tgOwner();
  return `\nTelegram: the user is on their phone; ${owner === name ? 'you answer it' : `${owner} answers it now`}. Messages starting with [via Telegram] come from there (files they send are listed with their paths); your reply goes back automatically. Answer those like a chat message on a phone: a few short lines of plain text, no headings, tables or long lists. Send a file with dispatch telegram send --text "<message>" --file <path>; bot profile: dispatch telegram profile [--photo <jpg|png>] [--name "<name>"] [--description "<text>"] [--about "<short text>"].${name === 'boss' ? ' Hand Telegram to another agent with dispatch telegram owner <agent>, back with dispatch telegram owner boss.' : ''}`;
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

// ── .dispatch packs (share a trained workspace or an agent) ─────
const packLib = require('./pack.cjs');
const packs = new Map();
const packArgs = { get workspace() { return workspace; }, get globalDir() { return globalDir(); }, get claudeHome() { return accountFor('claude')?.dir || path.join(userHome(), '.claude'); } };
function openPackFile(file) {
  const stat = fs.statSync(file);
  if (stat.size > 300 * 1024 * 1024) throw new Error('This pack is larger than 300 MB.');
  const pack = packLib.open(fs.readFileSync(file));
  const id = crypto.randomUUID(); packs.set(id, { pack, file });
  return { id, file, ...packLib.describe(pack, packArgs) };
}
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
ipcMain.handle('packs:pending', () => host.takePendingPack());
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
const builtinEnv = (id, opts = {}) => id === 'blender' ? { DISPATCH_BLENDER_EXE: require('./blender.cjs').exe() } : id === 'servers' ? { DISPATCH_SERVERS_URL: serversBridge.url, DISPATCH_AGENT: opts.agent || 'agent' } : id === 'memory' ? { DISPATCH_MEMORY_GLOBAL_DIR: globalDir(), DISPATCH_MEMORY_PROJECT_DIR: path.join(workspace, '.dispatch'), DISPATCH_MEMORY_LOG: path.join(workspace, '.dispatch', 'memory-log.jsonl'), DISPATCH_AGENT: 'boss' } : id === 'comfyui' ? { COMFY_URL: tools.comfyConfig().url, COMFY_ROOT: tools.comfyConfig().layout?.root || '', DISPATCH_OUTPUTS: outputsFile() } : id === 'voicestudio' ? { VOICE_URL: tools.voiceUrl(), DISPATCH_OUTPUTS: outputsFile() } : {};
let outputsWatcher = null, galleryWatcher = null, outputsOffset = 0;
function readOutputs(onlyNew = false) { let lines = []; try { lines = fs.readFileSync(outputsFile(), 'utf8').split('\n').filter(Boolean); } catch {} const start = onlyNew ? Math.min(outputsOffset, lines.length) : 0; outputsOffset = lines.length; return lines.slice(start).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
function appendOutput(event) { try { fs.mkdirSync(path.dirname(outputsFile()), { recursive: true }); fs.appendFileSync(outputsFile(), JSON.stringify({ time: Date.now(), ...event }) + '\n'); } catch {} }
let toolDirWatchers = [];
// A ComfyUI job that is still running: listen to ComfyUI as the client that queued it, for progress and preview frames.
const comfyLive = require('./comfy-live.cjs');
const comfyJobs = new Map(); // client id -> { ids, stop }
function comfyDone(id) { for (const [client, c] of comfyJobs) if (c.ids.delete(id) && !c.ids.size) { c.stop(); comfyJobs.delete(client); } }
function trackComfy(items) {
  for (const e of items || []) {
    if (e.kind !== 'job' || e.tool !== 'comfyui' || !e.id) continue;
    if (e.status !== 'queued') { comfyDone(e.id); continue; }
    if (!e.client || Date.now() - (e.time || 0) > 2 * 3600e3) continue;
    let c = comfyJobs.get(e.client);
    if (!c) {
      const url = tools.comfyConfig().url; if (!url) continue;
      c = { ids: new Set() }; comfyJobs.set(e.client, c);
      c.stop = comfyLive.listen(url, e.client, ev => { notify('comfy:live', ev); if (ev.done) comfyDone(ev.id); });
    }
    c.ids.add(e.id);
  }
}
function watchTools() {
  outputsWatcher?.close(); toolDirWatchers.forEach(w => w.close()); toolDirWatchers = [];
  outputsWatcher = chokidar.watch([outputsFile()], { ignoreInitial: true });
  outputsWatcher.on('all', () => { const items = readOutputs(true); if (items.length) { notify('outputs', items); trackComfy(items); } });
  trackComfy(readOutputs(true));
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
// Images an agent shows in the chat with ![alt](path): only files under this project's .dispatch folder (outputs, attachments) or ComfyUI's.
const chatImage = require('./chat-image.cjs');
const chatImageRoots = () => [path.join(workspace, '.dispatch'), tools.comfyConfig().layout?.root].filter(Boolean);
ipcMain.handle('chat:image', (_e, file) => chatImage.imageData(file, chatImageRoots()));
ipcMain.handle('chat:open-image', (_e, file) => { const full = chatImage.allowedImage(file, chatImageRoots()); if (!full) return false; void shell.openPath(full); return true; });
// Music scene: what Windows is playing (Spotify app, YouTube / YouTube Music in a browser...), read only while the scene is open.
const mediaLib = require('./media.cjs');
let mediaStop = null;
ipcMain.handle('media:watch', (_e, on) => {
  mediaStop?.(); mediaStop = null;
  if (on) mediaStop = mediaLib.watch(u => notify('media:update', u));
  return true;
});
ipcMain.handle('media:control', (_e, cmd) => mediaLib.send(String(cmd)));
ipcMain.handle('outputs:reveal', (_e, file) => { const full = file ? path.resolve(String(file)) : ''; if (full && outputAllowed(full) && fs.existsSync(full)) { shell.showItemInFolder(full); return true; } fs.mkdirSync(outputsDir(), { recursive: true }); void shell.openPath(outputsDir()); return false; });
ipcMain.handle('tools:can-uninstall', () => Object.fromEntries(['comfyui', 'voicestudio', 'rustxng', 'ddgs', 'whisper', 'blender'].map(id => [id, tools.canUninstall(id)])));
ipcMain.handle('tools:unreal-disable', () => unreal.disablePlugins());
ipcMain.handle('tools:install', (_e, id = 'comfyui', mode = 'install') => {
  const uninstall = mode === 'uninstall';
  const script = uninstall ? tools.TOOL_UNINSTALL[id]?.() : id === 'comfyui' ? tools.installScript() : tools.TOOL_INSTALL[id]?.();
  if (!script) throw new Error(`Unknown tool: ${id}`);
  const name = `tool-${id}-${uninstall ? 'uninstall' : 'install'}`;
  processes.get(name)?.terminal.kill(); processes.delete(name);
  const terminal = pty.spawn('powershell.exe', ['-NoProfile', '-Command', script], { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: process.env });
  const entry = { terminal, queue: [], output: '' }; processes.set(name, entry);
  terminal.onData(data => { entry.output += data; if (entry.output.length > 300000) entry.output = entry.output.slice(-200000); terminalOut(name, data); });
  terminal.onExit(({ exitCode }) => { watchTools(); notify('tool:done', { id, exitCode, name }); });
  return name;
});
ipcMain.handle('templates:list', () => ({ items: templates.list(workspace), efforts: providersLib.EFFORTS, permissions: providersLib.PERMISSIONS, models: { ...templates.MODELS, ...providersLib.allModels(), local: localAI.list().length ? localAI.list().map(item => item.model) : ['default'], ...Object.fromEntries(localAI.list().map(item => ['local:' + encodeURIComponent(item.model), [item.model]])) }, localProviders: localAI.list().map(item => ({ id: 'local:' + encodeURIComponent(item.model), name: item.name, model: item.model, icon: item.icon })) }));
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
// Checking a provider starts its CLI; opening the Providers page again within a minute reuses the answer. A sign-in or
// install run (provider:done) clears it, so the page shows the new state right away.
const providerChecks = new Map();
const providerAccountOpts = id => {
  const acc = accountFor(id);
  return acc ? { env: accountsLib.envFor(id, acc), accountDir: acc.dir, account: acc, accountId: acc.id } : {};
};
// Usage limits belong to the account the boss is actually running on (if boss uses this provider), even if
// another unsigned-in account was newly added and auto-activated in Providers.
const usageAccountOpts = id => {
  const boss = operation?.agents?.find(a => a.name === 'boss');
  const acc = boss?.provider === id && boss.accountId ? accountFor(id, boss.accountId) : accountFor(id);
  return acc ? { env: accountsLib.envFor(id, acc), accountDir: acc.dir, account: acc, accountId: acc.id } : {};
};
function checkProvider(id) { const hit = providerChecks.get(id); if (hit && Date.now() - hit.at < 60000) return hit.value; const value = Promise.resolve(providersLib.check(resolveCommand, id, providerAccountOpts(id))); providerChecks.set(id, { at: Date.now(), value }); value.catch(() => providerChecks.delete(id)); return value; }
ipcMain.handle('providers:check', async (_e, id) => { if (id !== 'local' && !id.startsWith('local:')) return checkProvider(id); const config = localAI.read(id.startsWith('local:') ? decodeURIComponent(id.slice(6)) : undefined); let installed = true; try { resolveCommand('opencode'); } catch { installed = false; } const status = config && installed ? await localAI.check(config) : null; return { id, name: config?.name || 'Custom AI', installed, auth: status?.ok && status.matches ? 'signed-in' : 'error', detail: !installed ? 'OpenCode is required.' : !config ? 'Configure a custom AI provider in Providers.' : !status.ok ? status.error || 'Server is offline.' : !status.matches ? 'Configured model was not found on the server.' : config.baseURL, models: config ? [config.model] : [] }; });
ipcMain.handle('providers:update-info', (_e, id, version) => providersLib.updateInfo(id, version));
ipcMain.handle('providers:models', (_e, id) => providersLib.refreshModels(resolveCommand, id, undefined, providerAccountOpts(id)));
ipcMain.handle('providers:action', (_e, id, kind) => {
  const name = `provider-${id}-${kind}`;
  processes.get(name)?.terminal.kill(); processes.delete(name);
  const opts = providerAccountOpts(id);
  const spec = providersLib.actionSpec(resolveCommand, id, kind, opts);
  const terminal = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: { ...process.env, ...(opts.env || {}) } });
  const entry = { terminal, queue: [], output: '' }; processes.set(name, entry);
  terminal.onData(data => { entry.output += data; if (entry.output.length > 300000) entry.output = entry.output.slice(-200000); terminalOut(name, data); });
  terminal.onExit(({ exitCode }) => { providerChecks.delete(id); notify('provider:done', { id, kind, exitCode, name }); notify('accounts-changed', id); });
  return name;
});
ipcMain.handle('accounts:list', (_e, provider) => accountStore().list(provider));
ipcMain.handle('accounts:add', (_e, provider, label) => {
  const account = accountStore().add(provider, label);
  providerChecks.delete(provider);
  notify('accounts-changed', provider);
  const name = `provider-${provider}-login-${account.id}`;
  processes.get(name)?.terminal.kill(); processes.delete(name);
  const env = accountsLib.envFor(provider, account);
  const spec = providersLib.actionSpec(resolveCommand, provider, 'login', { account });
  const terminal = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: { ...process.env, ...env } });
  const entry = { terminal, queue: [], output: '' }; processes.set(name, entry);
  terminal.onData(data => { entry.output += data; if (entry.output.length > 300000) entry.output = entry.output.slice(-200000); terminalOut(name, data); });
  terminal.onExit(({ exitCode }) => {
    providerChecks.delete(provider);
    const meta = accountsLib.readAccountMeta(provider, account.dir);
    if (meta.email || meta.plan) accountStore().updateMeta(provider, account.id, meta);
    // Signed in: switch to it now (that is what "Add account" is for). Not signed in: it stays inactive.
    if (accountsLib.hasLogin(provider, account.dir) !== false) { try { accountStore().activate(provider, account.id); } catch {} }
    notify('provider:done', { id: provider, kind: 'login', exitCode, name });
    notify('accounts-changed', provider);
    if (usageTracking()) usageAll(true).then(shareUsage).catch(() => {});
  });
  return { account, terminal: name, list: accountStore().list(provider) };
});
ipcMain.handle('accounts:activate', (_e, provider, id) => {
  accountStore().activate(provider, id);
  providerChecks.delete(provider);
  notify('accounts-changed', provider);
  if (usageTracking()) usageAll(true).then(shareUsage).catch(() => {});
  return accountStore().list(provider);
});
ipcMain.handle('accounts:rename', (_e, provider, id, label) => {
  const list = accountStore().rename(provider, id, label);
  notify('accounts-changed', provider);
  return list;
});
ipcMain.handle('accounts:remove', (_e, provider, id) => {
  const list = accountStore().remove(provider, id);
  providerChecks.delete(provider);
  notify('accounts-changed', provider);
  if (usageTracking()) usageAll(true).then(shareUsage).catch(() => {});
  return list;
});
// User shells (Terminal tab in the side panel): PowerShell in the workspace. Kept apart from agents so stopping
// or restarting the team never touches them; they share the 'terminal' event and the input/resize/output channels.
const shells = new Map(); let shellSeq = 0;
// Shells found on this computer for Settings > Terminal. Git Bash is looked up next to git.exe on PATH and in the usual folders.
function findOnPath(exe) { for (const dir of String(process.env.PATH || '').split(path.delimiter)) { try { const f = path.join(dir, exe); if (dir && fs.statSync(f).isFile()) return f; } catch {} } return null; }
function gitBash() {
  const git = findOnPath('git.exe'), roots = [];
  if (git) roots.push(path.resolve(path.dirname(git), '..'), path.resolve(path.dirname(git), '..', '..'));
  roots.push(path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git'), path.join(process.env['ProgramFiles(x86)'] || '', 'Git'));
  for (const r of roots) { const f = path.join(r, 'bin', 'bash.exe'); try { if (fs.statSync(f).isFile()) return f; } catch {} }
  return null;
}
function shellChoices() {
  if (process.platform !== 'win32') return [{ id: 'default', label: `Default (${path.basename(process.env.SHELL || 'bash')})`, path: process.env.SHELL || 'bash' }, { id: 'custom', label: 'Custom…', path: '' }];
  const list = [{ id: 'powershell', label: 'Windows PowerShell', path: 'powershell.exe' }];
  const pwsh = findOnPath('pwsh.exe'); if (pwsh) list.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh });
  list.push({ id: 'cmd', label: 'Command Prompt', path: 'cmd.exe' });
  const bash = gitBash(); if (bash) list.push({ id: 'gitbash', label: 'Git Bash', path: bash });
  const wsl = findOnPath('wsl.exe'); if (wsl) list.push({ id: 'wsl', label: 'WSL', path: wsl });
  list.push({ id: 'custom', label: 'Custom…', path: '' });
  return list;
}
function shellSpec(ui) {
  const id = ui.terminalShell || (process.platform === 'win32' ? 'powershell' : 'default');
  if (id === 'custom' && ui.terminalPath) return { file: ui.terminalPath, args: (ui.terminalArgs || '').match(/"[^"]*"|\S+/g)?.map(a => a.replace(/^"|"$/g, '')) || [], env: {} };
  if (process.platform !== 'win32') return { file: process.env.SHELL || 'bash', args: [], env: {} };
  const hit = shellChoices().find(c => c.id === id);
  // CHERE_INVOKING keeps Git Bash in the folder it was started in instead of jumping to the home folder.
  if (id === 'gitbash' && hit) return { file: hit.path, args: ['--login', '-i'], env: { CHERE_INVOKING: '1', MSYSTEM: 'MINGW64' } };
  if (id === 'cmd') return { file: 'cmd.exe', args: [], env: {} };
  if (id === 'pwsh' && hit) return { file: hit.path, args: ['-NoLogo'], env: {} };
  if (id === 'wsl' && hit) return { file: hit.path, args: [], env: {} };
  return { file: 'powershell.exe', args: ['-NoLogo'], env: {} };
}
ipcMain.handle('shell:list', () => [...shells.entries()].map(([name, s]) => ({ name, title: s.title, cwd: s.cwd, exited: s.exited, server: s.server || null })));
ipcMain.handle('terminal:shells', () => shellChoices());
const isDir = p => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } };
ipcMain.handle('shell:open', (_e, requestedCwd) => {
  const name = `shell-${++shellSeq}`, ui = readUi();
  const explicit = typeof requestedCwd === 'string' && requestedCwd.trim()
    ? (path.isAbsolute(requestedCwd) ? path.resolve(requestedCwd) : (workspace ? path.resolve(workspace, requestedCwd) : null))
    : null;
  const wanted = ui.terminalCwd && isDir(ui.terminalCwd) ? ui.terminalCwd : null;
  const cwd = (explicit && isDir(explicit) ? explicit : null) || wanted || workspace || os.homedir();
  const spec = shellSpec(ui);
  let terminal;
  try { terminal = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: 100, rows: 24, cwd, env: { ...process.env, ...spec.env } }); }
  catch (e) { throw new Error(`Could not start ${spec.file}: ${e.message}. Pick another shell in Settings > Terminal.`); }
  const entry = { terminal, output: '', cwd, title: `Terminal ${shellSeq}`, exited: false };
  shells.set(name, entry);
  terminal.onData(data => { entry.output += data; if (entry.output.length > 600000) entry.output = entry.output.slice(-400000); terminalOut(name, data); });
  terminal.onExit(() => { entry.exited = true; notify('shells-changed', null); });
  notify('shells-changed', null);
  return name;
});
ipcMain.handle('shell:close', (_e, name) => { const s = shells.get(name); if (s) { try { s.terminal.kill(); } catch {} shells.delete(name); notify('shells-changed', null); } return true; });
ipcMain.handle('shell:rename', (_e, name, title) => { const s = shells.get(name); if (s && String(title).trim()) { s.title = String(title).trim().slice(0, 40); notify('shells-changed', null); } return true; });
// ── SSH servers (electron/servers.cjs): saved list, terminals, and the agents' servers MCP bridge ──
const serversLib = require('./servers.cjs');
const vpnsLib = require('./vpns.cjs');
const { safeStorage } = require('electron');
const serverVault = { seal: text => { if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot store passwords securely'); return safeStorage.encryptString(text).toString('base64'); }, open: s => safeStorage.decryptString(Buffer.from(s, 'base64')) };
localAI.setVault(serverVault);
const serverStore = () => serversLib.create(path.join(globalDir(), 'servers.json'), serverVault);
const vpnStore = () => vpnsLib.create(path.join(globalDir(), 'vpns.json'), serverVault, { dataDir: globalDir() });
const serverPassword = id => { const st = serverStore(), s = st.get(id); return s ? st.password(s) : ''; };
// ── MCP connectors (electron/connectors.cjs): browser sign-in, tokens sealed, served to agents on a loopback proxy ──
const connectorHub = require('./connectors.cjs').create({ file: path.join(globalDir(), 'connectors.json'), vault: serverVault, open: url => shell.openExternal(url), notify: () => notify('connectors-changed', null) });
const connectorError = e => { throw new Error(String(e?.message || e)); };
ipcMain.handle('connectors:catalog', () => connectorHub.catalog());
ipcMain.handle('connectors:list', () => ({ connections: connectorHub.list(), pending: connectorHub.pending() }));
ipcMain.handle('connectors:connect', (_e, input) => connectorHub.connect(input).catch(connectorError));
ipcMain.handle('connectors:cancel', (_e, id) => { connectorHub.cancel(String(id)); return true; });
ipcMain.handle('connectors:remove', (_e, id) => connectorHub.remove(String(id)));
ipcMain.handle('connectors:check', (_e, id) => connectorHub.check(String(id)));
const prepareVpn = async s => s?.vpnId ? vpnStore().prepareForServer(s, serverStore().list()) : { vpn: null, tunnel: null, env: null, proxyScript: '' };
ipcMain.handle('servers:list', () => serverStore().list());
ipcMain.handle('servers:save', (_e, s) => { if (s?.vpnId && !vpnStore().get(s.vpnId)) throw new Error('Selected VPN was not found'); const saved = serverStore().save(s); notify('servers-changed', null); return saved; });
ipcMain.handle('servers:remove', (_e, id) => { serverStore().remove(id); notify('servers-changed', null); return true; });
ipcMain.handle('servers:order', (_e, ids) => { serverStore().order(Array.isArray(ids) ? ids.map(String) : []); notify('servers-changed', null); return true; });
ipcMain.handle('servers:test', async (_e, s) => { const vpnOpts = await prepareVpn(s); return serversLib.test(s, typeof s.password === 'string' && s.password ? s.password : s.id ? serverPassword(s.id) : '', vpnOpts); });
ipcMain.handle('vpns:list', () => vpnStore().list());
ipcMain.handle('vpns:save', (_e, v) => { const saved = vpnStore().save(v); notify('vpns-changed', null); return saved; });
ipcMain.handle('vpns:remove', (_e, id) => { vpnStore().remove(id); serverStore().clearVpn(id); notify('vpns-changed', null); notify('servers-changed', null); return true; });
ipcMain.handle('vpns:test', (_e, v, targetHost, targetPort) => vpnStore().test(v, targetHost, targetPort, serverStore().list()));
ipcMain.handle('vpns:choose-conf', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import WireGuard config', properties: ['openFile'], filters: [{ name: 'WireGuard config', extensions: ['conf'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  return { name: path.basename(file, path.extname(file)), text: fs.readFileSync(file, 'utf8') };
});
ipcMain.handle('servers:choose-key', async () => { const r = await dialog.showOpenDialog(win, { title: 'SSH private key', defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'] }); return r.canceled ? null : r.filePaths[0] || null; });
ipcMain.handle('servers:choose-icon', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Server icon', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'svg'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  if (/\.svg$/i.test(file)) { const data = fs.readFileSync(file); if (data.length > 200000) throw new Error('That SVG is too large'); return 'data:image/svg+xml;base64,' + data.toString('base64'); }
  const img = nativeImage.createFromPath(file); if (img.isEmpty()) throw new Error('Could not read that image');
  return img.resize({ width: 96, height: 96, quality: 'best' }).toDataURL();
});
ipcMain.handle('servers:connect', async (_e, id) => {
  const s = serverStore().get(id); if (!s) throw new Error('Server not found');
  const vpnOpts = await prepareVpn(s);
  const name = `shell-${++shellSeq}`;
  const terminal = pty.spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', serversLib.sshArgs(s, vpnOpts), { name: 'xterm-256color', cols: 100, rows: 24, cwd: os.homedir(), env: vpnOpts.env ? { ...process.env, ...vpnOpts.env } : process.env });
  const entry = { terminal, output: '', cwd: `${s.user ? s.user + '@' : ''}${s.host}`, title: s.name, exited: false, server: s.id };
  shells.set(name, entry);
  const answer = serversLib.answerer(serverPassword(s.id), text => terminal.write(text), () => {});
  terminal.onData(data => { entry.output += data; if (entry.output.length > 600000) entry.output = entry.output.slice(-400000); terminalOut(name, data); answer(data); });
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
        let vpnOpts;
        try { vpnOpts = await prepareVpn(s); } catch (e) { entry.status = 'failed'; notify('servers-log', entry); return reply({ error: String(e.message || e) }); }
        const r = tool === 'server_run' ? await serversLib.exec(s, action, timeout, pw, vpnOpts) : tool === 'server_upload' ? await serversLib.upload(s, path.resolve(workspace, String(args.local_path)), String(args.remote_path), 600000, pw, vpnOpts) : await serversLib.download(s, String(args.remote_path), path.resolve(workspace, String(args.local_path)), 600000, pw, vpnOpts);
        entry.status = r.code === 0 ? 'done' : 'failed'; entry.code = r.code; notify('servers-log', entry);
        reply({ text: `exit code ${r.code}\n${r.output || '(no output)'}` });
      } catch (e) { reply({ error: String(e.message || e) }); }
    });
  });
  serversBridge.server = bridge;
  bridge.listen(0, '127.0.0.1', () => { serversBridge.url = `http://127.0.0.1:${bridge.address().port}/${token}`; if (process.env.DISPATCH_TEST_HOME) fs.writeFileSync(path.join(process.env.DISPATCH_TEST_HOME, 'servers-bridge-url'), serversBridge.url); });
}
ipcMain.handle('providers:close', (_e, name) => { try { processes.get(name)?.terminal.kill(); } catch {} processes.delete(name); return true; });
// Remaining usage limits (session / weekly). Polled every 3 min only while the window is visible.
const usageLib = require('./usage.cjs');
const usageIds = () => usageLib.SUPPORTED.filter(providerEnabled);
if (!demo) usageLib.setCacheFile(path.join(globalDir(), 'usage.json'));
// A failed reading (rate limit, timeout, token being refreshed) is retried soon instead of waiting for the next 3-minute poll.
let usageRetry = null;
function retryUsageSoon(all) {
  const failed = Object.values(all || {}).filter(u => u.error && !['unsupported', 'not-installed', 'off', 'manual'].includes(u.errorCode));
  if (!failed.length || usageRetry) return;
  const wait = Math.min(300, Math.max(30, ...failed.map(u => u.retryAfter || 30)));
  usageRetry = setTimeout(() => { usageRetry = null; if (!host.isActive()) return; usageLib.getAll({ providers: failed.map(u => u.provider), resolveCommand, force: true, forProvider: usageAccountOpts }).then(shareUsage).catch(() => {}); }, wait * 1000);
}
// Limits belong to the account, not the project: a new reading goes to every tab (each keeps only the providers it
// has enabled), so two tabs never show different numbers for the same limit.
const shareUsage = all => (host.usage ? host.usage(all) : onUsage(all));
function onUsage(all) { if (demo) return; const ids = usageIds(); const mine = Object.fromEntries(Object.entries(all || {}).filter(([id]) => ids.includes(id))); if (Object.keys(mine).length) notify('usage:update', mine); }
// Off until the user turns it on from Home: then no CLI is asked and the Claude sign-in token is never read.
const usageTracking = () => readUi().usageTracking === true;
const usageOff = () => Object.fromEntries(usageIds().map(id => [id, { provider: id, windows: [], updatedAt: new Date().toISOString(), source: 'none', error: 'Live usage is off. Turn it on from Home.', errorCode: 'off' }]));
async function usageAll(force) {
  if (demo) return usageLib.demo();
  if (!usageTracking()) return usageOff();
  // Antigravity is manual only (its /usage spends a model turn): automatic polls fetch the free providers and just
  // carry its last saved reading, so the section can show the last number and when it was read.
  const auto = usageIds().filter(id => usageLib.AUTO.includes(id));
  const all = await usageLib.getAll({ providers: auto, resolveCommand, force, forProvider: usageAccountOpts });
  if (usageIds().includes('antigravity')) all.antigravity = await usageLib.getUsage('antigravity', { resolveCommand, force: false, ...usageAccountOpts('antigravity') });
  retryUsageSoon(all); return all;
}
ipcMain.handle('usage:get', () => usageAll(false));
ipcMain.handle('usage:refresh', async (_e, id) => { if (demo) { const all = usageLib.demo(); notify('usage:update', all); return all; } if (!usageTracking()) { const all = usageOff(); shareUsage(all); return all; } const all = id ? await usageLib.getAll({ providers: [id], resolveCommand, force: true, forProvider: usageAccountOpts }) : await usageAll(true); shareUsage(all); return all; });
intervals.push(setInterval(() => { if (usageTracking() && host.isActive() && win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) usageAll(true).then(shareUsage).catch(() => {}); }, 180000));
ipcMain.handle('templates:save', (_e, t) => templates.save(workspace, t));
ipcMain.handle('templates:delete', (_e, file) => templates.remove(file));
ipcMain.handle('workflows:list', () => workflowsLib.list(workspace));
ipcMain.handle('workflows:save', (_e, w) => { const file = workflowsLib.save(workspace, w); notify('workflows-changed', null); return file; });
ipcMain.handle('workflows:remove', (_e, file) => { workflowsLib.remove(file); notify('workflows-changed', null); return true; });
ipcMain.handle('templates:reveal', (_e, file) => { require('electron').shell.showItemInFolder(file); return true; });
ipcMain.handle('output', (_e, name) => processes.get(name)?.output || shells.get(name)?.output || host.customTools?.output(name) || '');
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
  const roster = operation.agents.map(a => ({ name: a.name, template: a.template, enlistedBy: a.enlistedBy, stopped: !!a.stopped }));
  stopAgents();
  // Undelivered orders belong to the old conversation. Only the files go: the watcher holds the folders open.
  for (const a of roster) { const dir = path.join(workspace, '.dispatch', 'inbox', a.name); try { for (const f of fs.readdirSync(dir)) try { fs.unlinkSync(path.join(dir, f)); } catch {} } catch {} }
  newOperation(); rosterHint = roster.filter(a => !a.stopped).map(a => a.name);
  // Stopped agents stay stopped, and one that cannot start (its CLI is gone) is kept as stopped instead of failing
  // the whole reset halfway: the window then never switched to the new chat.
  const park = a => { let saved = operation.agents.find(x => x.name === a.name); if (!saved) { saved = { name: a.name, template: a.template, provider: a.template.provider, model: a.template.model || '', enlistedBy: a.enlistedBy }; operation.agents.push(saved); createChat(saved); } saved.stopped = true; saveOperation(); };
  let failed; try { failed = restartRoster(roster, { start: a => startAgent(a.name, a.template, a.enlistedBy), park }); } finally { rosterHint = []; }
  return operation.agents.map(a => ({ name: a.name, template: a.template, enlistedBy: a.enlistedBy, stopped: !!a.stopped, error: failed.find(f => f.name === a.name)?.text }));
});
// Save the agents of the open operation as a team template (the boss may have built the team itself).
// One running agent kept as a template: its current provider, model, effort and prompt (minus a team roster).
ipcMain.handle('templates:save-agent', (_e, agentName, name, scope) => {
  const saved = operation?.agents.find(a => a.name === agentName);
  if (!saved) throw new Error(`Agent ${agentName} is not on this team.`);
  const t = saved.template || {};
  const file = templates.save(workspace, { name, scope: scope === 'global' ? 'global' : 'project', description: t.description || '', provider: t.provider || 'claude', model: t.model || '', effort: t.effort || '', permission: t.permission || '', extra: {}, body: String(t.body || '').split('\n\n## Your team:')[0] });
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
ipcMain.handle('tasks:list', () => {
  // Cards left open for agents that were stopped or removed meanwhile (e.g. while the app was closed).
  if (operation) taskBoard.reconcile(name => !processes.has(name) && (operation.agents.find(a => a.name === name)?.stopped ?? true));
  return taskBoard.list();
});
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
let lspHub = null; const lsp = () => lspHub ||= require('./lsp.cjs').create(d => notify('lsp-diagnostics', d));
process.on('exit', () => lspHub?.stopAll());
ipcMain.handle('lsp:open', (_e, lang, rel, text) => lsp().open(String(lang), workspace, String(rel), String(text ?? '')));
ipcMain.handle('lsp:change', (_e, lang, rel, version, text) => lsp().change(String(lang), workspace, String(rel), Number(version) || 1, String(text ?? '')));
ipcMain.handle('lsp:close', (_e, lang, rel) => lsp().close(String(lang), workspace, String(rel)));
ipcMain.handle('lsp:request', (_e, lang, method, rel, position) => { if (!/^textDocument\/(completion|hover|signatureHelp)$/.test(method)) throw new Error('Not allowed'); return lsp().request(String(lang), workspace, method, String(rel), position); });
ipcMain.handle('files:lint', (_e, rel, text) => require('./lint.cjs').lint(workspace, String(rel), String(text ?? '')).catch(() => []));
ipcMain.handle('files:all', () => filesLib.all(workspace));
ipcMain.handle('files:search', (_e, query, opts) => filesLib.search(workspace, query, opts));
ipcMain.handle('files:watch', (_e, on) => { if (on) filesLib.watch(workspace, batch => notify('files-changed', batch), host.id); else filesLib.unwatch(host.id); return true; });
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
// Tree actions on one or many selected items (renderer draws the menu). Delete goes to the OS trash.
ipcMain.handle('files:act', async (_e, action, rels) => {
  const list = (Array.isArray(rels) ? rels : []).map(String); const fulls = list.map(r => filesLib.resolve(workspace, r)); if (!fulls.length) return [];
  if (action === 'reveal') shell.showItemInFolder(fulls[0]);
  else if (action === 'open') for (const f of fulls) await shell.openPath(f);
  else if (action === 'copy-path') clipboard.writeText(fulls.join('\n'));
  else if (action === 'copy-rel') clipboard.writeText(list.map(r => r.replace(/\\/g, '/')).join('\n'));
  else if (action === 'copy-name') clipboard.writeText(fulls.map(f => path.basename(f)).join('\n'));
  else if (action === 'trash') { const failed = []; for (let i = 0; i < fulls.length; i++) { try { await shell.trashItem(fulls[i]); } catch { failed.push(list[i]); } } return failed; }
  return [];
});
// Claude's screen has a footer under its prompt, so "at prompt" guessing fails there: trust its transcript instead.
ipcMain.handle('agent:working', (_e, name) => isWorking(name));
function isWorking(name) { const a = processes.get(name); if (!a) return false; if (a.submitting || a.inFlight) return true; const p = a.template?.provider; if (p === 'claude') return !!a.turn; if (p === 'codex') return !!a.codexStateKnown && !a.atPrompt;
  // Antigravity: its transcript says when a turn starts and ends; the prompt-character guess stays on after it finishes.
  // Stopped with Esc, nothing ends the turn in the transcript: back at the prompt and quiet for 20 s means done.
  // Its spinner (braille dots: "Running command", "Thought for 8m") on screen in the last 3 s also means working: long
  // thinking writes nothing to the transcript, and its prompt box is always drawn, so the prompt guess said idle.
  // Only after a real turn started (transcript) or a message went in since the last turn ended: the same spinner
  // and a screen without a prompt also show while agy loads and signs in, which read as working on every start.
  if (p === 'antigravity') return activity.antigravityWorking(a, Date.now());
  return !!a.ready && !a.atPrompt; }
ipcMain.handle('boss:change', (_e, template, source) => {
  const saved = operation?.agents.find(a => a.name === 'boss');
  if (!saved) throw new Error('Boss not found');
  if (source) { const other = operation.agents.find(a => a.name === source); if (!other || source === 'boss') throw new Error('Agent not found'); template = other.template; agentAction(source, 'dismiss'); }
  if (!template?.provider) throw new Error('Choose a boss');
  const old = processes.get('boss'); if (old) { clearTimeout(old.timer); setAttention('boss', old, null); processes.delete('boss'); old.terminal.kill(); }
  saved.template = template; saved.provider = template.provider; saved.model = template.model || ''; saved.accountId = accountFor(template.provider)?.id; saved.stopped = false;
  createChat(saved); startAgent('boss', template, undefined, saved, false); saveOperation(); return template;
});
ipcMain.handle('boss:switch', (_e, { provider, accountId } = {}) => {
  const saved = operation?.agents.find(a => a.name === 'boss');
  if (!saved) throw new Error('Boss not found');
  const nextProvider = provider || saved.provider;
  const sameProvider = nextProvider === saved.provider;
  const old = processes.get('boss');
  if (old) { clearTimeout(old.timer); setAttention('boss', old, null); processes.delete('boss'); old.terminal.kill(); }
  if (sameProvider) {
    if (accountId && accountsLib.PROVIDERS.includes(nextProvider)) {
      accountStore().activate(nextProvider, accountId);
      providerChecks.delete(nextProvider);
      notify('accounts-changed', nextProvider);
      if (usageTracking()) usageAll(true).then(shareUsage).catch(() => {});
      saved.accountId = accountId;
    }
    saved.stopped = false;
    startAgent('boss', saved.template, undefined, saved, true);
    saveOperation();
    notify('agent-action', { name: 'boss', action: 'restart' });
    return { provider: saved.provider, accountId: saved.accountId, template: saved.template };
  }
  const bossTmpl = templates.list(workspace).find(t => t.extra?.role === 'boss' && t.provider === nextProvider);
  const nextTemplate = bossTmpl ? { ...bossTmpl, body: saved.template?.body || bossTmpl.body } : { ...(saved.template || {}), provider: nextProvider, model: '' };
  saved.template = nextTemplate;
  saved.provider = nextProvider;
  saved.model = nextTemplate.model || '';
  saved.accountId = accountFor(nextProvider)?.id;
  saved.sessionId = undefined;
  saved.stopped = false;
  createChat(saved);
  startAgent('boss', nextTemplate, undefined, saved, false);
  saveOperation();
  notify('agent-action', { name: 'boss', action: 'restart' });
  return { provider: saved.provider, accountId: saved.accountId, template: nextTemplate };
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
// Permission mode is a launch flag for every provider; changing it restarts the agent (Claude and Codex resume).
ipcMain.handle('agent:set-permission', (_e, name, permission) => {
  const saved = operation?.agents.find(a => a.name === name);
  if (!saved) throw new Error('Agent not found');
  permission = String(permission || '');
  if (permission && !(providersLib.PERMISSIONS[saved.template.provider] || []).includes(permission)) throw new Error('This provider does not take that permission mode');
  saved.template = { ...saved.template, permission }; saveOperation();
  const agent = processes.get(name);
  if (!agent || saved.stopped) return { mode: 'saved' };
  const fresh = !(['claude', 'codex'].includes(saved.template.provider) && saved.sessionId);
  agentAction(name, 'restart');
  return { mode: fresh ? 'fresh' : 'restarted' };
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
// A message typed in the chat while the agent waits on a one-question menu is the answer to it (a number picks).
ipcMain.handle('send', (_e, to, text) => { const q = processes.get(to)?.question; if (q && q.questions.length === 1 && String(text || '').trim() && !/\n/.test(String(text).trim())) return answerQuestion(to, [replyAsAnswer(q.questions[0], text)]); return sendMessage(to, text); });
ipcMain.handle('questions:list', () => Object.fromEntries([...processes].filter(([, a]) => a.question).map(([name, a]) => [name, a.question])));
ipcMain.handle('question:answer', (_e, name, answers) => answerQuestion(String(name), answers));
ipcMain.on('input', (_e, name, data) => { if (host.customTools?.input(name, data)) return; const shell = shells.get(name); if (shell) { if (!shell.exited) shell.terminal.write(data); return; } const agent = processes.get(name); if (!agent) return; if (agent.attention === 'Trust folder') agent.trustInteracted = true; if (agent.blocked && /[\r\n]/.test(data)) { agent.promptBuffer = ''; agent.awaitingAnswer = true; } agent.terminal.write(data); });
ipcMain.handle('attention:list', () => ({ ...Object.fromEntries([...exited].map(name => [name, 'Exited'])), ...Object.fromEntries([...processes].filter(([, a]) => a.attention).map(([name, a]) => [name, a.attention])) }));
ipcMain.handle('attention:trust', () => { fs.mkdirSync(path.dirname(trustFile()), { recursive: true }); fs.writeFileSync(trustFile(), JSON.stringify({ trusted: true }, null, 2)); const manual = []; for (const [name, agent] of processes) if (agent.attention === 'Trust folder' && !answerTrust(agent)) manual.push(name); return manual; });
ipcMain.on('resize', (_e, name, cols, rows) => { if (host.customTools?.resize(name, cols, rows)) return; try { (processes.get(name) || shells.get(name))?.terminal.resize(cols, rows); } catch {} });
// On quit every agent goes down with everything it started. A child left behind without its terminal (a git
// fetch, a login helper) falls back to desktop prompts such as Git's credential helper window.
function killTrees() {
  if (process.platform !== 'win32') return;
  const { execFileSync } = require('node:child_process');
  for (const a of processes.values()) { const pid = a.terminal?.pid; if (pid) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 4000 }); } catch {} }
}
// Tab closed or app quitting: every agent goes down with everything it started, and nothing keeps watching.
function dispose() {
  mediaStop?.(); mediaStop = null;
  for (const c of comfyJobs.values()) c.stop(); comfyJobs.clear();
  finishOperation(); watcher?.close(); memoryWatcher?.close(); outputsWatcher?.close(); galleryWatcher?.close(); toolDirWatchers.forEach(w => w.close());
  clearTimeout(codeIndexTimer); filesLib.unwatch(host.id); codeIndexWorker?.postMessage('close'); killTrees(); stopAgents();
  for (const s of shells.values()) try { s.terminal.kill(); } catch {}
  for (const i of intervals) clearInterval(i);
  try { serversBridge.server?.close(); } catch {}
}
// What the tab strip shows: agents running, someone needs the user, someone is working.
function status() {
  const names = (operation?.agents || []).map(a => a.name).filter(n => processes.has(n));
  return { running: names.length, needs: exited.size + names.filter(n => processes.get(n).attention).length, working: names.filter(n => { try { return isWorking(n); } catch { return false; } }).length };
}
return { init, dispose, status, telegramIn, telegramButton, teamStatus, onTelegramChange, onUsage, workspace: () => workspace, needsFolder: () => needsFolder, owner: () => tgOwner() };
};


