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

// One transcript line → { steps: [{ kind, text }], turn?: true|false }
function parseClaude(o) {
  const out = { steps: [] };
  const c = o.message?.content;
  // Sub-agent lines, skill bodies and slash commands (/model, /effort) are not turns of this agent.
  if (o.isSidechain || o.isMeta) return out;
  if (o.type === 'user') {
    if (typeof c === 'string' || (Array.isArray(c) && c.some(x => x.type === 'text'))) {
      const text = typeof c === 'string' ? c : c.filter(x => x.type === 'text').map(x => x.text).join(' ');
      if (/^\s*<(local-command|command-name|command-message)/.test(text)) return out;
      out.turn = !/^\[Request interrupted/.test(text);
    }
    return out;
  }
  if (o.type !== 'assistant' || !Array.isArray(c)) return out;
  const done = o.message.stop_reason === 'end_turn' || o.message.stop_reason === 'stop_sequence';
  for (const b of c) {
    if (b.type === 'thinking') out.steps.push({ kind: 'thinking', text: clip(b.thinking) });
    else if (b.type === 'tool_use') out.steps.push({ kind: 'tool', text: toolLabel(b.name, b.input) });
    // What the agent says between tool calls; the closing text of a turn is the reply itself, not a step.
    else if (b.type === 'text' && !done && String(b.text || '').trim()) out.steps.push({ kind: 'text', text: String(b.text).trim().slice(0, 4000) });
  }
  if (done) { out.turn = false; out.final = c.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim(); }
  return out;
}
function parseCodex(o) {
  const out = { steps: [] }; const p = o.payload || {};
  if (o.type === 'event_msg' && p.type === 'task_started') out.turn = true;
  if (o.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) { out.turn = false; out.final = String(p.last_agent_message || '').trim(); }
  if (o.type === 'event_msg' && p.type === 'agent_reasoning') out.steps.push({ kind: 'thinking', text: clip(p.text) });
  if (o.type === 'event_msg' && p.type === 'agent_message' && String(p.message || '').trim()) out.steps.push({ kind: 'text', text: String(p.message).trim().slice(0, 4000) });
  if (o.type === 'response_item' && p.type === 'reasoning' && !(p.summary || []).length) out.steps.push({ kind: 'thinking', text: '' });
  if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) out.steps.push({ kind: 'tool', text: toolLabel(p.name, p.arguments ?? p.input) });
  return out;
}

const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const claudeFile = (cwd, session) => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`);
function codexFile(session) {
  const root = path.join(codexHome(), 'sessions');
  // Newest day folders first; a session file is created in the folder of the day it started.
  const walk = (dir, depth) => { let names = []; try { names = fs.readdirSync(dir).sort().reverse(); } catch { return null; }
    for (const n of names) { const full = path.join(dir, n); if (depth < 3) { const hit = walk(full, depth + 1); if (hit) return hit; } else if (n.endsWith(`${session}.jsonl`)) return full; } return null; };
  return walk(root, 0);
}

// A new Codex session has no id until its rollout file appears: take the first unclaimed one for this cwd created after start.
const claimed = new Set();
function newCodexFile(cwd, since) {
  const d = new Date(), dir = path.join(codexHome(), 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  let names = []; try { names = fs.readdirSync(dir).filter(n => n.startsWith('rollout-') && n.endsWith('.jsonl')); } catch { return null; }
  for (const n of names) {
    const full = path.join(dir, n); if (claimed.has(full)) continue;
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
const agyDir = () => path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations');
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
function parseAgyStep(type, payload) {
  const out = { steps: [] }; let f; try { f = pbFields(Buffer.from(payload)); } catch { return out; }
  // 14 = a user message (field 19.2 is not always there); 101 = the agent waits on a background command and goes on
  // by itself afterwards. Both mean a turn is running, also after a text-only step that looked final.
  if (type === 14 || type === 101) out.turn = true;
  if (type !== 15) return out;
  const thinking = f['20.3']?.[0], text = f['20.1']?.[0], tool = f['20.7.2']?.[0];
  if (thinking) out.steps.push({ kind: 'thinking', text: clip(thinking) });
  if (tool) { out.turn = true; out.steps.push({ kind: 'tool', text: toolLabel(tool, f['20.7.3']?.[0]) }); if (text) out.steps.unshift({ kind: 'text', text: text.trim().slice(0, 4000) }); }
  else if (text) { out.turn = false; out.final = text.trim(); }
  return out;
}
function newAgyDb(cwd, since) {
  const uri = 'file:///' + path.resolve(cwd).replace(/\\/g, '/');
  let names = []; try { names = fs.readdirSync(agyDir()).filter(n => /^[\w-]+\.db$/.test(n)); } catch { return null; }
  for (const n of names) {
    const full = path.join(agyDir(), n); if (claimed.has(full)) continue;
    try {
      if (fs.statSync(full).birthtimeMs < since - 2000) continue;
      const db = openAgy(full); const meta = db.prepare("select data from trajectory_metadata_blob where id = 'main'").get(); db.close();
      if (meta && Buffer.from(meta.data).toString('latin1').toLowerCase().includes(uri.toLowerCase())) { claimed.add(full); return { file: full, id: n.slice(0, -3) }; }
    } catch {}
  }
  return null;
}
function openAgy(file) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file, { readOnly: true }); }
function watchAgy({ cwd, session, onEvent, onSession }) {
  const since = Date.now(); let file = session ? path.join(agyDir(), `${session}.db`) : null, last = null, stopped = false, endedAt = -1;
  const tick = () => {
    if (stopped) return;
    if (!file) { const hit = newAgyDb(cwd, since); if (!hit) return; file = hit.file; last = -1; onSession?.(hit.id); }
    if (!fs.existsSync(file)) return;
    const db = openAgy(file);
    try {
      // Resumed conversation: only what happens from now on.
      if (last === null) { last = db.prepare('select coalesce(max(idx), -1) m from steps').get().m; return; }
      // Steps are written in order; stop at the first one still running so it is read once, when complete.
      for (const r of db.prepare('select idx, step_type, status, step_payload from steps where idx > ? order by idx').all(last)) {
        if (r.status !== 3 && r.step_type === 15) break;
        last = r.idx; if (!r.step_payload) continue;
        const e = parseAgyStep(r.step_type, r.step_payload); if (e.steps.length || e.turn !== undefined) onEvent(e);
      }
      // A turn that ends on a cancelled or failed command (Esc, a rejected command: status 6, 7, 9) writes no closing
      // text. The newest step being such a command, and nothing after it, means the agent stopped.
      const tail = db.prepare('select idx, step_type, status from steps order by idx desc limit 1').get();
      if (tail && tail.step_type === 132 && ![2, 3].includes(tail.status) && tail.idx !== endedAt) { endedAt = tail.idx; onEvent({ steps: [], turn: false }); }
    } finally { db.close(); }
  };
  const timer = setInterval(() => { try { tick(); } catch {} }, 1000);
  try { tick(); } catch {}
  return () => { stopped = true; clearInterval(timer); if (file) claimed.delete(file); };
}

/** Follow one agent's transcript. onEvent({ steps, turn }) fires for new lines only; onSession(id) when a new Codex session is found. Returns stop(). */
function watch({ provider, cwd, session, onEvent, onSession }) {
  if (provider === 'antigravity') return watchAgy({ cwd, session, onEvent, onSession });
  if (!['claude', 'codex'].includes(provider) || (provider === 'claude' && !session)) return () => {};
  const parse = provider === 'claude' ? parseClaude : parseCodex;
  const since = Date.now();
  let file = null, pos = null, rest = '', stopped = false;
  const tick = () => {
    if (stopped) return;
    if (!file && provider === 'claude') file = claudeFile(cwd, session);
    if (!file && session) file = codexFile(session);
    if (!file && !session) { const hit = newCodexFile(cwd, since); if (hit) { file = hit.file; pos = 0; session = hit.id; onSession?.(hit.id); } }
    if (!file) return;
    // A new session has no transcript until its first message: when the file shows up later, read it from the top,
    // or the first turn (and its reply) would be skipped.
    let size; try { size = fs.statSync(file).size; } catch { if (pos === null && provider === 'claude') pos = 0; if (provider === 'codex') file = null; return; }
    if (pos === null) { pos = size; return; } // resumed session: start at the end, only new activity
    if (size < pos) pos = 0;
    if (size === pos) return;
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(size - pos); fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd); pos = size;
    const lines = (rest + buf.toString('utf8')).split('\n'); rest = lines.pop();
    for (const line of lines) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } const e = parse(o); if (e.steps.length || e.turn !== undefined) onEvent(e); }
    // Claude's tool_use turns end with stop_reason tool_use; only a plain user prompt or end_turn moves the turn state.
  };
  const timer = setInterval(() => { try { tick(); } catch {} }, 700);
  tick();
  return () => { stopped = true; clearInterval(timer); if (file) claimed.delete(file); };
}

module.exports = { watch, parseClaude, parseCodex, parseAgyStep, claudeFile };
