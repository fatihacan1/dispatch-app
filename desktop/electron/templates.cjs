// Agent templates = Markdown files with YAML frontmatter (Claude Code subagent format).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MODELS = {
  claude: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  codex: ['gpt-6.1-terra', 'gpt-6.1-sol'],
  antigravity: ['default'],
  opencode: ['default'],
  qoder: ['default'],
  gemini: ['default'],
};

function scopes(workspace) {
  return [
    { scope: 'project', dir: path.join(workspace, '.dispatch', 'agents'), readonly: false },
    { scope: 'global', dir: path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'agents'), readonly: false },
    { scope: 'claude', dir: path.join(workspace, '.claude', 'agents'), readonly: false },
    { scope: 'claude', dir: path.join(os.homedir(), '.claude', 'agents'), readonly: false },
    { scope: 'built-in', dir: path.join(__dirname, 'builtin-agents'), readonly: true },
  ];
}

function parse(text) {
  text = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2].replace(/^\r?\n/, '') };
}

function serialize({ name, description, provider, model, effort, permission, extra = {}, body }) {
  const q = v => (/: |#|^[\[\]{}>|*&!%@`'"-]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
  const lines = ['---', `name: ${q(name)}`, `description: ${q(description || '')}`, `provider: ${q(provider || 'claude')}`];
  if (model) lines.push(`model: ${q(model)}`);
  if (effort) lines.push(`effort: ${q(effort)}`);
  if (permission) lines.push(`permission: ${q(permission)}`);
  for (const [k, v] of Object.entries(extra)) if (!['name', 'description', 'provider', 'model', 'effort', 'permission'].includes(k)) lines.push(`${k}: ${v}`);
  lines.push('---', '', (body || '').trim(), '');
  return lines.join('\n');
}

function list(workspace) {
  const out = []; const seen = new Set();
  for (const s of scopes(workspace)) {
    let files = [];
    try { files = fs.readdirSync(s.dir).filter(f => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      const file = path.join(s.dir, f);
      if (seen.has(file)) continue; seen.add(file);
      try {
        const { meta, body } = parse(fs.readFileSync(file, 'utf8'));
        const provider = meta.provider || 'claude';
        out.push({ file, scope: s.scope, readonly: s.readonly, name: meta.name || f.replace(/\.md$/, ''), description: meta.description || '', provider, model: meta.model || '', effort: meta.effort || '', permission: meta.permission || '', extra: meta, body });
      } catch {}
    }
  }
  return out;
}

function slug(name) { return String(name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'; }

function save(workspace, t) {
  if (!t.name || !String(t.name).trim()) throw new Error('Name is required.');
  const scope = t.scope === 'global' ? 'global' : t.scope === 'claude' ? 'claude' : 'project';
  const dir = scope === 'global' ? path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'agents') : scope === 'claude' ? path.dirname(t.file || path.join(workspace, '.claude', 'agents', 'x.md')) : path.join(workspace, '.dispatch', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug(t.name) + '.md');
  fs.writeFileSync(file, serialize(t), 'utf8');
  if (t.file && path.resolve(t.file) !== path.resolve(file) && !t.file.includes('builtin-agents')) { try { fs.unlinkSync(t.file); } catch {} }
  return file;
}

function remove(file) { if (file.includes('builtin-agents')) throw new Error('Built-in templates cannot be deleted.'); fs.unlinkSync(file); return true; }

module.exports = { MODELS, list, save, remove, parse, serialize, scopes };
