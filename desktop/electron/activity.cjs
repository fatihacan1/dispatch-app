// Live activity from a CLI's own session transcript: thinking, tool calls, and whether a turn is running.
// Claude Code: ~/.claude/projects/<cwd slug>/<session>.jsonl   Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*-<session>.jsonl
const fs = require('fs');
const path = require('path');
const os = require('os');

const clip = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function toolLabel(name, input) {
  let i = input;
  if (typeof i === 'string') { try { i = JSON.parse(i); } catch { return clip(`${name} ${i}`, 120); } }
  i = i || {};
  const arg = i.file_path || i.path || i.CommandLine || i.AbsolutePath || i.TargetFile || i.Path || i.command || i.cmd || i.pattern || i.url || i.query || i.description || i.prompt || '';
  return clip(arg ? `${name} · ${Array.isArray(arg) ? arg.join(' ') : arg}` : name, 120);
}

// Claude's AskUserQuestion: the questions and options it shows in its terminal, so the chat can show them too.
function askFrom(b) {
  let input = b.input;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = null; } }
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  const questions = qs.map(q => ({
    question: String(q?.question || '').trim(), header: String(q?.header || '').trim(), multiSelect: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : []).map(o => ({ label: String(o?.label ?? o ?? '').trim(), description: String(o?.description || '').trim() })).filter(o => o.label),
  })).filter(q => q.question && q.options.length);
  return questions.length ? { id: String(b.id || ''), questions } : null;
}

// One transcript line → { steps: [{ kind, text }], turn?: true|false, ask?, answered? }
function parseClaude(o) {
  const out = { steps: [] };
  const c = o.message?.content;
  // Sub-agent lines, skill bodies and slash commands (/model, /effort) are not turns of this agent.
  if (o.isSidechain || o.isMeta || o.isCompactSummary) return out;
  if (o.type === 'system' && o.subtype === 'compact_boundary') { out.turn = false; return out; }
  if (o.type === 'user') {
    // The tool result of a question: it was answered (here, in the terminal, or cancelled).
    if (Array.isArray(c)) { const ids = c.filter(x => x.type === 'tool_result' && x.tool_use_id).map(x => String(x.tool_use_id)); if (ids.length) out.answered = ids; }
    if (typeof c === 'string' || (Array.isArray(c) && c.some(x => x.type === 'text'))) {
      const text = typeof c === 'string' ? c : c.filter(x => x.type === 'text').map(x => x.text).join(' ');
      // A background task's notice is written as a user line, but often starts no turn (on resume: "didn't finish
      // before the previous session ended"). Counting it kept the agent "working" for good; a real reply to it shows
      // up as assistant lines, which start the turn in the engine.
      if (/^\s*<(local-command|command-name|command-message|task-notification)/.test(text)) return out;
      out.turn = !/^\[Request interrupted/.test(text);
    }
    return out;
  }
  if (o.type !== 'assistant' || !Array.isArray(c)) return out;
  const u = o.message.usage;
  if (u && o.message.model !== '<synthetic>' && Number.isFinite(u.input_tokens)) { const cached = u.cache_read_input_tokens || 0, fresh = u.input_tokens + (u.cache_creation_input_tokens || 0); if (cached + fresh) out.usage = { used: cached + fresh, cached, fresh, output: u.output_tokens || 0, model: o.message.model || '' }; }
  const done = o.message.stop_reason === 'end_turn' || o.message.stop_reason === 'stop_sequence';
  for (const b of c) {
    if (b.type === 'thinking') out.steps.push({ kind: 'thinking', text: clip(b.thinking) });
    else if (b.type === 'tool_use' && b.name === 'AskUserQuestion') { const ask = askFrom(b); if (ask) out.ask = ask; out.steps.push({ kind: 'tool', text: clip(`Asks you · ${ask?.questions.map(q => q.question).join(' · ') || 'a question'}`, 120) }); }
    else if (b.type === 'tool_use') out.steps.push({ kind: 'tool', text: toolLabel(b.name, b.input) });
    // What the agent says between tool calls; the closing text of a turn is the reply itself, not a step.
    else if (b.type === 'text' && !done && String(b.text || '').trim()) out.steps.push({ kind: 'text', text: String(b.text).trim().slice(0, 4000) });
  }
  if (done && !out.ask) { out.turn = false; out.final = c.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim(); }
  return out;
}
function parseCodex(o) {
  const out = { steps: [] }; const p = o.payload || {};
  if (o.type === 'event_msg' && p.type === 'task_started') out.turn = true;
  if (o.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) { out.turn = false; out.final = String(p.last_agent_message || '').trim(); }
  if (o.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
    const l = p.info.last_token_usage, t = p.info.total_token_usage || {}, cached = l.cached_input_tokens || 0;
    out.usage = { used: l.input_tokens || 0, cached, fresh: Math.max(0, (l.input_tokens || 0) - cached), output: l.output_tokens || 0, window: p.info.model_context_window || null, session: { input: t.input_tokens || 0, cached: t.cached_input_tokens || 0, output: t.output_tokens || 0 } };
  }
  if (o.type === 'event_msg' && p.type === 'agent_reasoning') out.steps.push({ kind: 'thinking', text: clip(p.text) });
  if (o.type === 'event_msg' && p.type === 'agent_message' && String(p.message || '').trim()) out.steps.push({ kind: 'text', text: String(p.message).trim().slice(0, 4000) });
  if (o.type === 'response_item' && p.type === 'reasoning' && !(p.summary || []).length) out.steps.push({ kind: 'thinking', text: '' });
  if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) out.steps.push({ kind: 'tool', text: toolLabel(p.name, p.arguments ?? p.input) });
  return out;
}

const codexHome = accountDir => accountDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const claudeFile = (cwd, session, accountDir) => path.join(accountDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`);
function codexFile(session, accountDir) {
  const root = path.join(codexHome(accountDir), 'sessions');
  // Newest day folders first; a session file is created in the folder of the day it started.
  const walk = (dir, depth) => { let names = []; try { names = fs.readdirSync(dir).sort().reverse(); } catch { return null; }
    for (const n of names) { const full = path.join(dir, n); if (depth < 3) { const hit = walk(full, depth + 1); if (hit) return hit; } else if (n.endsWith(`${session}.jsonl`)) return full; } return null; };
  return walk(root, 0);
}

// A new Codex session has no id until its rollout file appears: take the first unclaimed one for this cwd created after start.
const claimed = new Set();
function newCodexFile(cwd, since, accountDir) {
  // The day folder of the start and of today: a session started just before midnight lands in the next day's folder.
  const day = d => path.join(codexHome(accountDir), 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  const files = [...new Set([day(new Date(since)), day(new Date())])].flatMap(dir => { try { return fs.readdirSync(dir).filter(n => n.startsWith('rollout-') && n.endsWith('.jsonl')).map(n => path.join(dir, n)); } catch { return []; } });
  for (const full of files) {
    if (claimed.has(full)) continue;
    try {
      if (fs.statSync(full).birthtimeMs < since - 2000) continue;
      const fd = fs.openSync(full, 'r'); const buf = Buffer.alloc(8192); const len = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      const meta = JSON.parse(buf.toString('utf8', 0, len).split('\n')[0]);
      if (meta.type === 'session_meta' && path.resolve(meta.payload?.cwd || '') === path.resolve(cwd)) { claimed.add(full); return { file: full, id: meta.payload.id }; }
    } catch {}
  }
  return null;
}

// ── Antigravity (agy): one SQLite database per conversation, ~/.gemini/antigravity-cli/conversations/<id>.db.
// Each row of `steps` is a protobuf message. There is no published schema, so this reads it generically:
// type 14 = user message (field 19.2), type 15 = model step (20.1 text, 20.3 thinking, 20.7.2/20.7.3 tool call).
const agyDir = accountDir => path.join(accountDir || process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity-cli'), 'conversations');
const agyFile = (session, accountDir) => path.join(agyDir(accountDir), `${session}.db`);
function pbFields(buf, depth = 0) {
  // Returns { '20.1': ['...'], ... } for readable strings, keyed by field path. Throws on bytes that are not protobuf.
  const out = {}; let i = 0;
  const varint = () => { let r = 0, s = 0, b; do { if (i >= buf.length) throw 0; b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const key = varint(), f = Math.floor(key / 8), w = key % 8; if (!f) throw 0;
    if (w === 0) varint(); else if (w === 1) i += 8; else if (w === 5) i += 4;
    else if (w === 2) {
      const len = varint(), sub = buf.subarray(i, i + len); i += len; if (i > buf.length) throw 0;
      let nested = null; if (depth < 6 && len) { try { nested = pbFields(sub, depth + 1); } catch {} }
      if (nested) for (const [k, v] of Object.entries(nested)) (out[`${f}.${k}`] ||= []).push(...v);
      const s = sub.toString('utf8'); if (len && /^[^\u0000-\u0008\u000e-\u001f�]+$/.test(s)) (out[String(f)] ||= []).push(s);
    } else throw 0;
  }
  return out;
}
const AGY_ENDED = [6, 7, 9]; // a step that was cancelled (Esc) or failed
function parseAgyStep(type, payload, status = 3) {
  const out = { steps: [] }; let f; try { f = pbFields(Buffer.from(payload)); } catch { return out; }
  // 14 = a user message (field 19.2 is not always there); 101 = the agent waits on a background command and goes on
  // by itself afterwards. Both mean a turn is running, also after a text-only step that looked final.
  if (type === 14 || type === 101) out.turn = true;
  // 17 = the turn failed (quota reached, model error): nothing else is written, so without this the turn never ended
  // and the chat showed nothing. 24.3.1 is the message the CLI shows, 24.3.2 the raw one.
  if (type === 17) { const msg = (f['24.3.1'] || f['24.3.2'] || [])[0]; out.turn = false; out.error = true; out.final = `Antigravity error: ${String(msg || 'the turn failed').trim().slice(0, 1000)}`; return out; }
  if (type !== 15) return out;
  const thinking = f['20.3']?.[0], text = f['20.1']?.[0], tools = f['20.7.2'] || [];
  if (thinking) out.steps.push({ kind: 'thinking', text: clip(thinking) });
  // Stopped in the middle (Esc, the Stop button): what it had written so far, and the turn is over.
  if (AGY_ENDED.includes(status)) { if (text && text.trim()) out.steps.push({ kind: 'text', text: text.trim().slice(0, 4000) }); out.turn = false; out.interrupted = true; return out; }
  if (tools.length) {
    out.turn = true;
    if (text) out.steps.push({ kind: 'text', text: text.trim().slice(0, 4000) });
    tools.forEach((tool, i) => out.steps.push({ kind: 'tool', text: toolLabel(tool, f['20.7.3']?.[i]) }));
  } else if (text) { out.turn = false; out.final = text.trim(); }
  return out;
}
// Several Antigravity agents started together in one folder each make a new conversation there: the folder alone
// matched the first agent to the second one's conversation (one showed idle while the other worked). The first
// message carries "You are <name>.", so a conversation goes to the agent it names; one without any name to any.
function newAgyDb(cwd, since, name, accountDir, memo = {}) {
  // Looked at every second until the agent's first message: an untouched folder (no new file) costs one stat, not
  // one per conversation ever held.
  let dirAt = 0; try { dirAt = fs.statSync(agyDir(accountDir)).mtimeMs; } catch { return null; }
  if (memo.dirAt === dirAt && !memo.open) return null;
  memo.dirAt = dirAt; memo.open = false;
  let names = []; try { names = fs.readdirSync(agyDir(accountDir)).filter(n => /^[\w-]+\.db$/.test(n)); } catch { return null; }
  for (const n of names) {
    const full = path.join(agyDir(accountDir), n); if (claimed.has(full)) continue;
    try {
      if (fs.statSync(full).birthtimeMs < since - 2000) continue;
      memo.open = true; // young enough to become ours: look again next time
      const db = openAgy(full); const meta = db.prepare("select data from trajectory_metadata_blob where id = 'main'").get(); db.close();
      if (!meta || !agyMetaHasFolder(meta.data, cwd)) continue;
      if (name) {
        const db2 = openAgy(full); let first; try { first = db2.prepare('select step_payload from steps where step_type = 14 order by idx limit 1').get(); } finally { db2.close(); }
        if (!first?.step_payload) continue; // no message yet: decide on a later tick
        // Newer agy versions store the message with a NUL before each sentence ("You are x. \0You report to"):
        // without removing them no name ever matched, and any agent took any new conversation in the folder.
        if (!agyMatchesAgent(first.step_payload, name)) continue;
      }
      claimed.add(full); return { file: full, id: n.slice(0, -3) };
    } catch {}
  }
  return null;
}
// agy stores the folder as a percent-encoded URI ("file:///D:/Kodlar/Peach%20Cord", "Masa%C3%BCst%C3%BC"). Compared
// with the plain path, a folder with a space or a non-ASCII letter never matched: the chat stayed on "Thinking" for
// good while the agent answered in its terminal. Each file:/// URI in the metadata is decoded and compared as a path
// (one copy ends cleanly; others run into protobuf bytes, so only an exact match counts).
function agyMetaHasFolder(data, cwd) {
  const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const want = norm(path.resolve(cwd));
  const buf = Buffer.from(data);
  for (const text of [buf.toString('utf8'), buf.toString('latin1')]) {
    for (const m of text.matchAll(/file:\/\/\/([^\x00-\x20"'<>]+)/g)) {
      let p = m[1]; try { p = decodeURIComponent(p); } catch {}
      if (norm(p) === want) return true;
    }
  }
  return false;
}
function agyMatchesAgent(payload, name) {
  const text = Buffer.from(payload).toString('latin1').replace(/\0/g, '');
  return !/You are [\w-]+\. You report to/.test(text) || text.includes(`You are ${name}. You report to`);
}
// Is an Antigravity agent working? a: the engine's agent state. Its braille spinner and a screen without a prompt
// also show while agy loads and signs in, so they only count once a turn really started: the transcript said so, or
// a message went in after the last turn ended. Stopped with Esc nothing ends the turn in the transcript: back at the
// prompt and quiet for 20 s means done. Long thinking writes nothing to the transcript, so a fresh spinner still counts.
// screenState is what its screen says (screen.cjs): the footer names a running turn, so it wins over every guess.
function antigravityWorking(a, now) {
  const asked = (a.deliveredAt || 0) > (a.turnEndAt || 0);
  if (!a.turn && !asked) return false;
  if (a.screenState === 'loading') return false;
  if (a.screenState === 'busy') return true;
  if (a.screenState === 'idle' && now - (a.screenAt || 0) > 2500 && now - (a.deliveredAt || 0) > 5000) return false;
  if (now - (a.spinAt || 0) < 3000) return true;
  return !(a.atPrompt && now - Math.max(a.eventAt || 0, a.lastOutput || 0, a.deliveredAt || 0) > 20000);
}
// The number at a field path of a protobuf message (first match), or undefined.
function pbNumber(buf, path) {
  let i = 0; const varint = () => { let r = 0, s = 0, b; do { if (i >= buf.length) throw 0; b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  try {
    while (i < buf.length) {
      const key = varint(), f = Math.floor(key / 8), w = key % 8;
      if (w === 0) { const v = varint(); if (f === path[0] && path.length === 1) return v; }
      else if (w === 1) i += 8; else if (w === 5) i += 4;
      else if (w === 2) { const len = varint(), sub = buf.subarray(i, i + len); i += len; if (f === path[0] && path.length > 1) { const v = pbNumber(sub, path.slice(1)); if (v !== undefined) return v; } }
      else return undefined;
    }
  } catch {}
  return undefined;
}
// agy keeps what each model call used in gen_metadata: 1.4 = { 2 new input, 5 cached, 3 output }, 1.9.10 = { 1 in context, 4 window }.
function agyUsage(db) {
  let row; try { row = db.prepare('select data from gen_metadata order by idx desc limit 1').get(); } catch { return null; }
  if (!row?.data) return null;
  const b = Buffer.from(row.data), n = (...p) => pbNumber(b, p) || 0;
  const fresh = n(1, 4, 2), cached = n(1, 4, 5), used = n(1, 9, 10, 1) || fresh + cached;
  return used ? { used, cached: Math.min(cached, used), fresh, output: n(1, 4, 3), window: n(1, 9, 10, 4) || null } : null;
}
function openAgy(file) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file, { readOnly: true }); }
function watchAgy({ cwd, session, name, accountDir, onEvent, onSession, onUsage }) {
  const since = Date.now(); let file = session ? path.join(agyDir(accountDir), `${session}.db`) : null, last = null, stopped = false, endedAt = -1, sig = '', readAt = 0, lastUsage = '';
  const memo = {}; if (file) claimed.add(file);
  const tick = () => {
    if (stopped) return;
    if (!file) { const hit = newAgyDb(cwd, since, name, accountDir, memo); if (!hit) return; file = hit.file; last = -1; onSession?.(hit.id); }
    // Opening the database for every agent every second adds up on the main thread: only when it was written to
    // (or every 5 s, should a write not show in the file times).
    let now = ''; try { const f = fs.statSync(file); now = `${f.mtimeMs}:${f.size}`; } catch { return; }
    try { const w = fs.statSync(file + '-wal'); now += `:${w.mtimeMs}:${w.size}`; } catch {}
    if (now === sig && Date.now() - readAt < 5000) return;
    sig = now; readAt = Date.now();
    const db = openAgy(file);
    try {
      if (onUsage) { const u = agyUsage(db), s = u && JSON.stringify(u); if (s && s !== lastUsage) { lastUsage = s; onUsage(u); } }
      // Resumed conversation: only what happens from now on.
      if (last === null) { last = db.prepare('select coalesce(max(idx), -1) m from steps').get().m; return; }
      // Steps are written in order; stop at the first one still running so it is read once, when complete.
      // A step cancelled with Esc (status 6) never becomes 3: waiting for it stopped the reading for good, so the chat
      // showed "Working" for ever and none of the later turns.
      const rows = db.prepare('select idx, step_type, status, step_payload from steps where idx > ? order by idx').all(last);
      for (const [i, r] of rows.entries()) {
        if (r.step_type === 15 && r.status !== 3 && !AGY_ENDED.includes(r.status) && i === rows.length - 1) { sig = ''; break; }
        last = r.idx; if (!r.step_payload) continue;
        const e = parseAgyStep(r.step_type, r.step_payload, r.status); if (e.steps.length || e.turn !== undefined) onEvent(e);
      }
      // A turn that ends on a cancelled or failed command (Esc, a rejected command: status 6, 7, 9) writes no closing
      // text. The newest step being such a command, and nothing after it, means the agent stopped.
      const tail = db.prepare('select idx, step_type, status from steps order by idx desc limit 1').get();
      // Only those: status 1 is a command that was just proposed and is about to run (agy 1.5.10 writes it before every
      // tool call), and reading it as "stopped" flipped a working agent to idle many times a minute.
      if (tail && tail.step_type === 132 && [6, 7, 9].includes(tail.status) && tail.idx !== endedAt) { endedAt = tail.idx; onEvent({ steps: [], turn: false }); }
    } finally { db.close(); }
  };
  const timer = setInterval(() => { try { tick(); } catch {} }, 1000);
  try { tick(); } catch {}
  return () => { stopped = true; clearInterval(timer); if (file) claimed.delete(file); };
}

// ── OpenCode (also every custom / local AI): one SQLite database for all sessions, ~/.local/share/opencode/opencode.db.
const opencodeDb = () => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode', 'opencode.db');
const samePath = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function opencodeHas(session) { let db; try { db = openAgy(opencodeDb()); return !!db.prepare('select 1 from session where id = ?').get(session); } catch { return false; } finally { try { db?.close(); } catch {} } }
// One assistant message with its parts → steps not seen yet, and how the turn stands.
function parseOpencode(data, parts, seen) {
  const out = { steps: [] }, done = !!data.time?.completed, err = data.error;
  const texts = [];
  for (const { id, data: p } of parts) {
    const add = (key, step) => { if (!seen.has(key)) { seen.add(key); out.steps.push(step); } };
    if (p.type === 'reasoning' && String(p.text || '').trim() && (p.time?.end || done)) add(id, { kind: 'thinking', text: clip(p.text) });
    else if (p.type === 'tool' && p.state?.input && Object.keys(p.state.input).length) add(id, { kind: 'tool', text: toolLabel(p.tool, p.state.input) });
    else if (p.type === 'text' && !p.synthetic && String(p.text || '').trim()) { texts.push(String(p.text).trim()); if (done && data.finish === 'tool-calls') add(id, { kind: 'text', text: String(p.text).trim().slice(0, 4000) }); }
  }
  if (!done) out.turn = true;
  else if (err) {
    out.turn = false;
    if (/abort/i.test(err.name || '')) { out.interrupted = true; for (const t of texts) out.steps.push({ kind: 'text', text: t.slice(0, 4000) }); }
    else { out.error = true; out.final = `OpenCode error: ${String(err.data?.message || err.name || 'the turn failed').trim().slice(0, 1000)}`; }
  }
  else if (data.finish === 'tool-calls') out.turn = true;
  else { out.turn = false; out.final = texts.join('\n\n'); }
  const t = data.tokens;
  if (t && (t.total || t.input || t.cache?.read)) out.usage = { used: (t.input || 0) + (t.cache?.read || 0) + (t.cache?.write || 0), cached: t.cache?.read || 0, fresh: (t.input || 0) + (t.cache?.write || 0), output: t.output || 0, model: data.modelID || '', cost: data.cost || 0 };
  return out;
}
function watchOpencode({ cwd, session, name, onEvent, onSession, onUsage }) {
  const since = Date.now(), file = opencodeDb(), states = new Map(); let id = session || null, from = session ? null : 0, stopped = false, sig = '', readAt = 0;
  if (id) claimed.add('opencode:' + id);
  const tick = () => {
    if (stopped) return;
    let now = ''; try { const f = fs.statSync(file); now = `${f.mtimeMs}:${f.size}`; } catch { return; }
    try { const w = fs.statSync(file + '-wal'); now += `:${w.mtimeMs}:${w.size}`; } catch {}
    if (now === sig && Date.now() - readAt < 5000) return;
    sig = now; readAt = Date.now();
    const db = openAgy(file);
    try {
      if (!id) {
        for (const s of db.prepare('select id, directory from session where time_created >= ? and parent_id is null order by time_created').all(since - 2000)) {
          if (claimed.has('opencode:' + s.id) || samePath(s.directory) !== samePath(path.resolve(cwd))) continue;
          // Several agents in one folder: the first message names its agent ("You are x. You report to").
          const first = db.prepare("select p.data from part p join message m on m.id = p.message_id where p.session_id = ? and json_extract(m.data, '$.role') = 'user' order by p.time_created limit 1").get(s.id);
          if (!first) continue;
          if (name && !agyMatchesAgent(Buffer.from(first.data), name)) continue;
          id = s.id; claimed.add('opencode:' + id); onSession?.(id); break;
        }
        if (!id) return;
      }
      if (from === null) { const m = db.prepare('select max(time_created) t from message where session_id = ?').get(id); from = (m?.t || 0) + 1; }
      const last = db.prepare("select data from message where session_id = ? and json_extract(data, '$.role') = 'assistant' order by time_created desc limit 12").all(id);
      for (const r of last) { const u = parseOpencode(JSON.parse(r.data), [], new Set()).usage; if (u) { onUsage?.(u); break; } }
      for (const m of db.prepare('select id, time_updated, data from message where session_id = ? and time_created >= ? order by time_created').all(id, from)) {
        let d; try { d = JSON.parse(m.data); } catch { continue; }
        const st = states.get(m.id) || { seen: new Set(), end: false, user: false }; states.set(m.id, st);
        if (d.role === 'user') { if (!st.user) { st.user = true; onEvent({ steps: [], turn: true }); } continue; }
        if (st.end) continue;
        const parts = db.prepare('select id, data from part where message_id = ? order by time_created, id').all(m.id).map(p => { try { return { id: p.id, data: JSON.parse(p.data) }; } catch { return null; } }).filter(Boolean);
        const e = parseOpencode(d, parts, st.seen);
        if (d.time?.completed) st.end = true;
        if (e.steps.length || st.end) onEvent(e);
      }
    } finally { db.close(); }
  };
  const timer = setInterval(() => { try { tick(); } catch {} }, 900);
  try { tick(); } catch {}
  return () => { stopped = true; clearInterval(timer); if (id) claimed.delete('opencode:' + id); };
}

// What the newest lines of a transcript say about the context, for an agent that just resumed.
function lastUsage(provider, file) {
  try {
    const size = fs.statSync(file).size, len = Math.min(size, 400000), buf = Buffer.alloc(len), fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const l of lines) { if (!/"usage"|token_count/.test(l)) continue; try { const u = (provider === 'claude' ? parseClaude : parseCodex)(JSON.parse(l)).usage; if (u) return u; } catch {} }
  } catch {}
  return null;
}

/** Follow one agent's transcript. onEvent({ steps, turn }) fires for new lines only; onSession(id) when a new Codex session is found. Returns stop(). */
function watch({ provider, cwd, session, name, accountDir, onEvent, onSession, onUsage }) {
  if (provider === 'antigravity') return watchAgy({ cwd, session, name, accountDir, onEvent, onSession, onUsage });
  if (provider === 'opencode' || provider === 'local' || provider.startsWith('local:')) return watchOpencode({ cwd, session, name, onEvent, onSession, onUsage });
  if (!['claude', 'codex'].includes(provider) || (provider === 'claude' && !session)) return () => {};
  const parse = provider === 'claude' ? parseClaude : parseCodex;
  const since = Date.now();
  let file = null, pos = null, rest = '', stopped = false, searchedAt = 0;
  const tick = () => {
    if (stopped) return;
    if (!file && provider === 'claude') file = claudeFile(cwd, session, accountDir);
    if (!file && session && Date.now() - searchedAt > 4000) { searchedAt = Date.now(); file = codexFile(session, accountDir); }
    if (!file && !session) { const hit = newCodexFile(cwd, since, accountDir); if (hit) { file = hit.file; pos = 0; session = hit.id; onSession?.(hit.id); } }
    if (!file) return;
    // A new session has no transcript until its first message: when the file shows up later, read it from the top,
    // or the first turn (and its reply) would be skipped.
    let size; try { size = fs.statSync(file).size; } catch { if (pos === null && provider === 'claude') pos = 0; if (provider === 'codex') file = null; return; }
    if (pos === null) { pos = size; const u = onUsage && lastUsage(provider, file); if (u) onUsage(u); return; } // resumed session: start at the end, only new activity
    if (size < pos) pos = 0;
    if (size === pos) return;
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(size - pos); fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd); pos = size;
    const lines = (rest + buf.toString('utf8')).split('\n'); rest = lines.pop();
    for (const line of lines) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } const e = parse(o); if (e.usage) onUsage?.(e.usage); if (e.steps.length || e.turn !== undefined || e.answered) onEvent(e); }
    // Claude's tool_use turns end with stop_reason tool_use; only a plain user prompt or end_turn moves the turn state.
  };
  const timer = setInterval(() => { try { tick(); } catch {} }, 700);
  tick();
  return () => { stopped = true; clearInterval(timer); if (file) claimed.delete(file); };
}

// Keys that answer Claude's AskUserQuestion menu, one group per question (checked against Claude Code 2.1):
// a single choice is its number (picks and moves on); several choices are their numbers (each toggles) and then
// Down past the options and "Type something" onto Submit. Own text goes in the "Type something" row.
// answers: [{ picks: number[] (0-based), other?: string }] in question order.
function questionKeys(questions, answers) {
  const DOWN = '\x1b[B';
  return questions.map((q, i) => {
    const a = answers[i] || {}, n = q.options.length;
    const picks = [...new Set((a.picks || []).map(Number).filter(p => Number.isInteger(p) && p >= 0 && p < n))];
    const other = String(a.other || '').replace(/[\r\n\t\x1b]+/g, ' ').trim();
    if (!q.multiSelect) {
      if (other) return [...Array(n).fill(DOWN), other, '\r'];
      if (!picks.length) throw new Error(`Pick an answer for "${q.header || q.question}".`);
      return [String(picks[0] + 1)];
    }
    if (!picks.length && !other) throw new Error(`Pick at least one answer for "${q.header || q.question}".`);
    return [...picks.map(p => String(p + 1)), ...(other ? [...Array(n).fill(DOWN), other, DOWN] : Array(n + 1).fill(DOWN)), '\r'];
  });
}

module.exports = { watch, parseOpencode, opencodeHas, opencodeDb, pbNumber, parseClaude, parseCodex, parseAgyStep, agyMatchesAgent, agyMetaHasFolder, agyFile, antigravityWorking, claudeFile, questionKeys };
