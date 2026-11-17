// Task board: every piece of work a lead (the boss or a team lead) hands an agent becomes a card, so an agent that
// sits half-done is seen. Pure logic; the engine feeds it events and gives it a file to keep the cards in
// (<operations>/<operation id>/tasks.json).
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 200;
const OPEN = ['working', 'waiting', 'stalled'];
// Attention reasons that mean the agent is held up until someone acts.
const WAITING = ['Approve command', 'Question', 'Sign in', 'Limit reached'];

const titleOf = text => {
  const line = String(text || '').split(/\r?\n/).map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || 'Task';
  return line.length > 90 ? line.slice(0, 89).trimEnd() + '…' : line;
};

// file(): the current operation's tasks.json, or null with no operation. leadOf(name): who hands that agent work.
// onChange(list): called after every change.
// mirror(): optional fixed file holding the current operation's cards, for `dispatch tasks` (the CLI does not know the operation id).
function createTaskBoard({ file, leadOf, onChange = () => {}, now = () => Date.now(), mirror = () => null }) {
  let loadedFrom = null, tasks = [];
  const iso = () => new Date(now()).toISOString();
  function write(f) { if (f) try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(tasks, null, 2)); } catch {} }
  function load() {
    const f = file();
    if (f === loadedFrom) return f;
    loadedFrom = f; tasks = [];
    if (f) try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(v)) tasks = v; } catch {}
    write(mirror());
    return f;
  }
  function commit() {
    if (tasks.length > KEEP) tasks = tasks.slice(-KEEP);
    const f = loadedFrom;
    write(f); write(mirror());
    onChange(tasks.slice());
  }
  const open = name => { for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].agent === name && OPEN.includes(tasks[i].status)) return tasks[i]; return null; };
  function close(task, status, reason) { task.status = status; task.endedAt = iso(); task.reason = reason || null; delete task.waitReason; delete task.waitingAt; }

  // Every message that reaches an agent or a person. Returns true when the board changed.
  function message(msg) {
    if (!load() || !msg || msg.from === 'dispatch') return false;
    const { from, to } = msg;
    // A lead's new work: a plain send (not a question, not an answer) to an agent it leads.
    if (msg.kind === 'send' && !msg.reply_to && from !== to && leadOf(to) === from) {
      const previous = open(to); if (previous) close(previous, 'done', 'Superseded');
      tasks.push({ id: msg.id || `${to}-${now()}`, agent: to, lead: from, title: titleOf(msg.text), text: String(msg.text || ''), startedAt: msg.time || iso(), status: 'working', endedAt: null });
      commit(); return true;
    }
    // The agent reported back to its lead: done. Its own questions (ask) do not end the task.
    if ((msg.kind === 'send' || msg.kind === 'reply') && from !== to) {
      const task = open(from);
      if (task && task.lead === to) { close(task, 'done', null); commit(); return true; }
    }
    return false;
  }
  function attention(name, reason) {
    if (!load()) return false;
    const task = open(name); if (!task) return false;
    if (reason === 'Exited') { close(task, 'stopped', 'Exited'); commit(); return true; }
    if (WAITING.includes(reason)) { if (task.status === 'waiting' && task.waitReason === reason) return false; task.status = 'waiting'; task.waitReason = reason; task.waitingAt = iso(); delete task.waitToldAt; commit(); return true; }
    if (!reason && task.status === 'waiting') { task.status = 'working'; delete task.waitReason; delete task.waitingAt; commit(); return true; }
    return false;
  }
  // Cards that sat waiting for ms or more and whose lead was not told yet: [{ lead, text }], each card once. (A stall is already
  // told to the lead by the engine's watchdog, so only waiting is handled here.)
  function dueNotices(ms = 180000) {
    if (!load()) return [];
    const out = [];
    for (const t of tasks) {
      if (t.status !== 'waiting' || t.waitToldAt || !t.waitingAt || now() - Date.parse(t.waitingAt) < ms) continue;
      t.waitToldAt = iso();
      out.push({ lead: t.lead, text: `Task board: ${t.agent} waiting ${Math.round((now() - Date.parse(t.waitingAt)) / 60000)}m (${t.waitReason}) on ${t.title}.` });
    }
    if (out.length) commit();
    return out;
  }
  // The stall watchdog fired (quiet for minutes while it should be working, or idle without reporting back).
  function stalled(name) {
    if (!load()) return false;
    const task = open(name); if (!task || task.status !== 'working') return false;
    task.status = 'stalled'; task.stalledAt = iso(); commit(); return true;
  }
  // Real progress on its screen again. Called often, so it does nothing unless the card says stalled.
  function progress(name) {
    if (!load()) return false;
    const task = open(name); if (!task || task.status !== 'stalled') return false;
    task.status = 'working'; delete task.stalledAt; commit(); return true;
  }
  function stopped(name, reason = 'Stopped') {
    if (!load()) return false;
    const task = open(name); if (!task) return false;
    close(task, 'stopped', reason); commit(); return true;
  }
  // Cards still open for agents that are no longer around (stopped or removed while the app was closed).
  function reconcile(isGone) {
    if (!load()) return false;
    let changed = false;
    for (const t of tasks) if (OPEN.includes(t.status) && isGone(t.agent)) { close(t, 'stopped', 'Stopped'); changed = true; }
    if (changed) commit();
    return changed;
  }
  function list() { load(); return tasks.slice(); }
  return { message, attention, dueNotices, stalled, progress, stopped, reconcile, list };
}

module.exports = { createTaskBoard, titleOf, WAITING, OPEN, KEEP };

