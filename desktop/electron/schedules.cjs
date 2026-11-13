// Schedules: tasks Dispatch sends to an agent on a timer (e.g. "make today's video at 09:00").
// Stored in <workspace>/.dispatch/schedules.json. Only the boss and team leads (agents that enlisted others)
// may manage them; a team lead's schedule waits for the boss (or the user) to approve it. Plain agents cannot see them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UNIT = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };
const MIN = 5 * 60e3;

function parseEvery(text) {
  if (!text) return 0;
  const m = String(text).trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|minutes?|h|hours?|d|days?|w|weeks?)$/);
  if (!m) throw new Error(`"${text}" is not an interval. Use 30m, 2h, 1d or 1w.`);
  const ms = Number(m[1]) * UNIT[m[2][0]];
  if (ms < MIN) throw new Error('The shortest interval is 5 minutes.');
  return ms;
}
function parseAt(text) {
  if (!text) return null;
  const t = String(text).trim();
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m && +m[1] < 24 && +m[2] < 60) return { time: `${m[1].padStart(2, '0')}:${m[2]}` };
  m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (m) { const d = new Date(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:00`); if (!isNaN(d)) return { once: d.getTime() }; }
  throw new Error(`"${text}" is not a time. Use HH:MM, or YYYY-MM-DD HH:MM for a single run.`);
}

/** Next run after `from` (ms). */
function nextRun(s, from = Date.now()) {
  if (s.once) return s.once > from ? s.once : null;
  if (s.time) {
    const [h, mi] = s.time.split(':').map(Number);
    const d = new Date(from); d.setHours(h, mi, 0, 0);
    let t = d.getTime();
    const step = s.every || UNIT.d;
    while (t <= from) t += step;
    return t;
  }
  return from + s.every;
}

function describe(s) {
  const every = s.every ? (() => { for (const [u, label] of [['w', 'week'], ['d', 'day'], ['h', 'hour'], ['m', 'minute']]) { const n = s.every / UNIT[u]; if (Number.isInteger(n)) return n === 1 ? `every ${label}` : `every ${n} ${label}s`; } return ''; })() : '';
  if (s.once) return `once on ${new Date(s.once).toLocaleString()}`;
  return [every || 'every day', s.time ? `at ${s.time}` : ''].filter(Boolean).join(' ');
}

function create({ dir }) {
  const file = path.join(dir, 'schedules.json');
  const read = () => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = list => { fs.mkdirSync(dir, { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(list, null, 2)); fs.renameSync(tmp, file); };
  const view = s => ({ ...s, when: describe(s) });
  const list = () => read().map(view);
  const find = (list, id) => { const s = list.find(x => x.id === id || x.id.startsWith(String(id))); if (!s) throw new Error(`No schedule ${id}.`); return s; };

  function add({ title, why, task, to, every, at }, { by, approved }) {
    if (!String(task || '').trim()) throw new Error('--task is required: the message the agent gets each run.');
    if (!String(why || '').trim()) throw new Error('--why is required: one line the user sees, saying why this schedule exists.');
    const ms = parseEvery(every), when = parseAt(at);
    if (!ms && !when) throw new Error('Give --every (30m, 2h, 1d, 1w) and/or --at (HH:MM or YYYY-MM-DD HH:MM).');
    if (when?.once && ms) throw new Error('Use either a single date-time or --every, not both.');
    const s = { id: crypto.randomBytes(4).toString('hex'), title: String(title || task).trim().slice(0, 80), why: String(why).trim().slice(0, 300), task: String(task).trim(), to: to || by, by, every: ms || (when?.time ? UNIT.d : 0), time: when?.time || '', once: when?.once || 0, status: approved ? 'active' : 'pending', created: Date.now(), runs: 0, last: 0, lastNote: '' };
    s.next = nextRun(s);
    if (!s.next) throw new Error('That time is already in the past.');
    write([...read(), s]);
    return view(s);
  }
  function update(id, fn) { const all = read(); const s = find(all, id); fn(s); write(all); return view(s); }
  const remove = id => { const all = read(); const s = find(all, id); write(all.filter(x => x !== s)); return true; };
  const setStatus = (id, status) => update(id, s => { s.status = status; if (status === 'active') s.next = nextRun(s) || s.next; });

  /** Schedules due now. Missed runs (app closed) run once, then move to the next future time. */
  function due(now = Date.now()) {
    const all = read(), out = [];
    for (const s of all) {
      if (s.status !== 'active' || !s.next || s.next > now) continue;
      out.push({ ...s });
      s.runs++; s.last = now; s.next = s.once ? 0 : nextRun(s, now);
      if (s.once) s.status = 'done';
    }
    if (out.length) write(all);
    return out;
  }
  const note = (id, text) => { try { update(id, s => { s.lastNote = text; }); } catch {} };
  const runNow = id => update(id, s => { if (s.status === 'pending') throw new Error('Approve it first.'); if (s.status === 'done') throw new Error('It already ran.'); s.status = 'active'; s.next = Date.now(); });
  return { file, list, add, remove, setStatus, due, note, runNow, find: id => view(find(read(), id)) };
}

/**
 * Who may manage schedules. boss: everything. team lead (has enlisted agents): its own and its team's,
 * and new ones wait for approval. Anyone else: nothing.
 */
function access(from, agents) {
  if (from === 'boss' || from === 'you' || from === 'user') return { role: from === 'boss' ? 'boss' : 'user', team: null };
  const kids = name => agents.filter(a => a.enlistedBy === name).map(a => a.name);
  const direct = kids(from);
  if (!direct.length) return null;
  const team = new Set([from]), queue = [...direct];
  while (queue.length) { const n = queue.shift(); if (team.has(n)) continue; team.add(n); queue.push(...kids(n)); }
  return { role: 'lead', team };
}

module.exports = { create, access, parseEvery, parseAt, nextRun, describe };
