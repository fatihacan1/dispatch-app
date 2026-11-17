// Saved workflows = named playbooks stored as Markdown with YAML frontmatter, like agent templates.
// Project: <workspace>/.dispatch/workflows/<name>.md, global: ~/.dispatch/workflows/<name>.md (DISPATCH_HOME respected).
// The body is free Markdown; the UI edits the numbered list "1. [template] instruction" as ordered steps.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const templates = require('./templates.cjs');

function scopes(workspace) {
  return [
    { scope: 'project', dir: path.join(workspace, '.dispatch', 'workflows') },
    { scope: 'global', dir: path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'workflows') },
  ];
}

const STEP = /^\s{0,3}(\d+)[.)]\s+(.*)$/;

/** Body -> { notes, steps: [{ template, instruction }] }. Text before the first list item is kept as notes. */
function parseSteps(body) {
  const notes = []; const steps = []; let cur = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = STEP.exec(line);
    if (m) {
      const a = /^\[([^\]]*)\]\s*([\s\S]*)$/.exec(m[2]);
      cur = { template: a ? a[1].trim() : '', instruction: (a ? a[2] : m[2]).trim() };
      steps.push(cur);
    } else if (cur) {
      if (/^\s+\S/.test(line)) cur.instruction += '\n' + line.trim();
      else if (!line.trim()) cur.pending = (cur.pending || 0) + 1;
      else { cur = null; notes.push(line); }
    } else notes.push(line);
  }
  for (const s of steps) delete s.pending;
  return { notes: notes.join('\n').trim(), steps };
}

function serializeSteps(steps, notes) {
  const list = (steps || []).filter(s => (s.instruction || '').trim() || (s.template || '').trim()).map((s, i) => {
    const tag = (s.template || '').trim() ? `[${s.template.trim()}] ` : '';
    const lines = String(s.instruction || '').trim().split(/\r?\n/);
    return `${i + 1}. ${tag}${lines[0]}` + lines.slice(1).map(l => '\n   ' + l.trim()).join('');
  });
  return [String(notes || '').trim(), list.join('\n')].filter(Boolean).join('\n\n');
}

function serialize({ name, description, steps, notes }) {
  const q = v => (/: |#|^[\[\]{}>|*&!%@`'"-]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
  return ['---', `name: ${q(name)}`, `description: ${q(description || '')}`, '---', '', serializeSteps(steps, notes), ''].join('\n');
}

function slug(name) { return String(name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow'; }

function list(workspace) {
  const out = []; const seen = new Set();
  for (const s of scopes(workspace)) {
    let files = [];
    try { files = fs.readdirSync(s.dir).filter(f => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      const file = path.join(s.dir, f);
      if (seen.has(file)) continue; seen.add(file);
      try {
        const { meta, body } = templates.parse(fs.readFileSync(file, 'utf8'));
        out.push({ file, scope: s.scope, name: meta.name || f.replace(/\.md$/, ''), description: meta.description || '', ...parseSteps(body) });
      } catch {}
    }
  }
  return out;
}

function save(workspace, w) {
  if (!w.name || !String(w.name).trim()) throw new Error('Name is required.');
  const scope = w.scope === 'global' ? 'global' : 'project';
  const dir = scopes(workspace).find(s => s.scope === scope).dir;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug(w.name) + '.md');
  if (fs.existsSync(file) && path.resolve(file) !== path.resolve(w.file || '')) throw new Error(`A ${scope} workflow named ${slug(w.name)} already exists.`);
  fs.writeFileSync(file, serialize(w), 'utf8');
  if (w.file && path.resolve(w.file) !== path.resolve(file)) { try { fs.unlinkSync(w.file); } catch {} }
  return file;
}

function remove(file) {
  if (!/[\\/]workflows[\\/][^\\/]+\.md$/.test(String(file))) throw new Error('Not a workflow file.');
  fs.unlinkSync(file); return true;
}

/** Names listed in a template's `workflows: a, b` frontmatter field. */
function mountedNames(template) {
  return String(template?.extra?.workflows || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Full text of one workflow as the agents read it. */
function text(w) {
  return `### ${w.name}${w.description ? ` - ${w.description}` : ''}\n${serializeSteps(w.steps, w.notes)}`;
}

/** Section appended to an agent's role prompt: the workflows its template mounts ('' when none). */
function promptFor(template, all) {
  const picked = mountedNames(template).map(n => all.find(w => w.name === n)).filter(Boolean);
  return picked.length ? `\n\n## Workflows you follow\nFollow these step by step when the task matches. A step tagged [name] is done by an agent of that template.\n\n${picked.map(text).join('\n\n')}\n` : '';
}

/** Boss/lead section: every workflow in full (the dispatch CLI reads files directly, so there is no `workflow show`). */
function catalogueFor(all) {
  if (!all.length) return '';
  return `\nWorkflows (saved playbooks). To run one, follow its steps with dispatch spawn / dispatch send, using the step's template for each [template] tag; the user can also ask "Run workflow <name>":\n${all.map(text).join('\n\n')}\n`;
}

module.exports = { scopes, parseSteps, serializeSteps, serialize, list, save, remove, mountedNames, text, promptFor, catalogueFor };
