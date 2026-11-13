#!/usr/bin/env node
// Dispatch memory MCP server (stdio, JSON-RPC 2.0, no dependencies). Given to the boss only.
// Tool set follows the official MCP Memory server (create_entities, add_observations, ...) with a
// `scope` argument, plus tiered reads: memory_search (L1) and memory_open (L2).
// Env: DISPATCH_MEMORY_GLOBAL_DIR, DISPATCH_MEMORY_PROJECT_DIR, DISPATCH_MEMORY_LOG, DISPATCH_AGENT.
const memory = require('./memory.cjs').create({
  globalDir: process.env.DISPATCH_MEMORY_GLOBAL_DIR || require('node:path').join(require('node:os').homedir(), '.dispatch'),
  projectDir: process.env.DISPATCH_MEMORY_PROJECT_DIR || require('node:path').join(process.cwd(), '.dispatch'),
  log: process.env.DISPATCH_MEMORY_LOG || '',
});
const AGENT = process.env.DISPATCH_AGENT || 'boss';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const strs = description => ({ type: 'array', items: { type: 'string' }, description });
const SCOPE_READ = str('project, global, or omit for both (only scopes the user enabled).', { enum: ['project', 'global', 'all'] });
const SCOPE_WRITE = str('project (default): facts about this workspace. global: facts true in every workspace, such as user preferences.', { enum: ['project', 'global'] });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ENTITY = obj({
  name: str('Stable, short identifier, e.g. "build-system" or "user". Reuse existing names; search first.'),
  entityType: str('Kind of thing: user, preference, decision, convention, component, gotcha, person, tool...'),
  summary: str('One line (under 120 chars) shown in the boss index. Say the most useful thing.'),
  observations: strs('Atomic facts, one per string. Include the reason for decisions.'),
  pinned: { type: 'boolean', description: 'Pinned entities are shown in full at every boss start. Use rarely.' },
}, ['name', 'entityType', 'summary', 'observations']);
const RELATION = obj({ from: str('Entity name'), to: str('Entity name'), relationType: str('Active voice, e.g. "depends on", "owned by", "replaces"') }, ['from', 'to', 'relationType']);

const TOOLS = {
  memory_search: {
    description: 'Search Dispatch memory before planning. Returns ranked entities with their one-line summary and only the observations that match (cheap). Use memory_open for everything about an entity.',
    schema: obj({ query: str('Keywords'), scope: SCOPE_READ, limit: { type: 'integer', minimum: 1, maximum: 25 } }, ['query']),
    run: a => memory.search(a.query, { scope: a.scope, limit: a.limit }),
  },
  memory_open: {
    description: 'Read entities in full: every observation and the relations that touch them.',
    schema: obj({ names: strs('Entity names'), scope: SCOPE_READ }, ['names']),
    run: a => memory.open(a.names || [], a.scope),
  },
  memory_overview: {
    description: 'The index you received at start (names and one-line summaries), refreshed. Use after many changes.',
    schema: obj({}),
    run: () => memory.overview().text || 'Memory is empty.',
  },
  create_entities: {
    description: 'Create new entities. Existing names are skipped; use add_observations or update_entity for those.',
    schema: obj({ entities: { type: 'array', items: ENTITY }, scope: SCOPE_WRITE }, ['entities']),
    write: true, run: a => memory.writable(a.scope).createEntities(a.entities || []).then(created => ({ created, skipped: (a.entities || []).map(e => e.name).filter(n => !created.includes(n)) })),
  },
  add_observations: {
    description: 'Add facts to existing entities. Duplicates are ignored.',
    schema: obj({ observations: { type: 'array', items: obj({ entityName: str('Entity name'), contents: strs('New facts') }, ['entityName', 'contents']) }, scope: SCOPE_WRITE }, ['observations']),
    write: true, run: a => memory.writable(a.scope).addObservations(a.observations || []),
  },
  update_entity: {
    description: 'Change an entity\'s summary, type or pinned flag. To replace a wrong fact, delete_observations then add_observations.',
    schema: obj({ name: str('Entity name'), summary: str('New one-line summary'), entityType: str('New type'), pinned: { type: 'boolean' }, scope: SCOPE_WRITE }, ['name']),
    write: true, run: a => memory.writable(a.scope).updateEntity(a.name, a),
  },
  create_relations: {
    description: 'Connect entities. Both entities must exist in the same scope.',
    schema: obj({ relations: { type: 'array', items: RELATION }, scope: SCOPE_WRITE }, ['relations']),
    write: true, run: a => memory.writable(a.scope).createRelations(a.relations || []),
  },
  delete_observations: {
    description: 'Remove outdated or wrong facts (exact text).',
    schema: obj({ deletions: { type: 'array', items: obj({ entityName: str('Entity name'), observations: strs('Exact facts to remove') }, ['entityName', 'observations']) }, scope: SCOPE_WRITE }, ['deletions']),
    write: true, run: a => memory.writable(a.scope).deleteObservations(a.deletions || []),
  },
  delete_entities: {
    description: 'Delete entities and their relations.',
    schema: obj({ entityNames: strs('Entity names'), scope: SCOPE_WRITE }, ['entityNames']),
    write: true, run: a => memory.writable(a.scope).deleteEntities(a.entityNames || []),
  },
  delete_relations: {
    description: 'Delete relations.',
    schema: obj({ relations: { type: 'array', items: RELATION }, scope: SCOPE_WRITE }, ['relations']),
    write: true, run: a => memory.writable(a.scope).deleteRelations(a.relations || []),
  },
};

function detail(name, a) {
  if (name === 'memory_search') return a.query;
  if (name === 'memory_open') return (a.names || []).join(', ');
  if (name === 'create_entities') return (a.entities || []).map(e => e.name).join(', ');
  if (name === 'add_observations') return (a.observations || []).map(o => `${o.entityName}: ${(o.contents || []).join(' | ')}`).join('; ');
  if (name === 'delete_observations') return (a.deletions || []).map(o => `${o.entityName}: ${(o.observations || []).join(' | ')}`).join('; ');
  if (name === 'delete_entities') return (a.entityNames || []).join(', ');
  if (name === 'update_entity') return a.name;
  if (name.endsWith('_relations')) return (a.relations || []).map(r => `${r.from} ${r.relationType} ${r.to}`).join('; ');
  return '';
}

const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
async function handle(m) {
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dispatch-memory', version: '1.0.0' } } });
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) } });
  if (m.method === 'tools/call') {
    const name = m.params?.name, a = m.params?.arguments || {}, tool = TOOLS[name];
    const base = { by: AGENT, tool: name, scope: a.scope || (tool?.write ? 'project' : 'all'), detail: String(detail(name, a) || '').slice(0, 400) };
    try {
      if (!tool) throw new Error(`Unknown tool ${name}`);
      const result = await tool.run(a);
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      memory.record({ ...base, ok: true, tokens: memory.tokens(text), results: Array.isArray(result) ? result.length : result?.entities ? result.entities.length : undefined });
      return send({ id: m.id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      const text = String(e?.message || e);
      memory.record({ ...base, ok: false, error: text });
      return send({ id: m.id, result: { content: [{ type: 'text', text }], isError: true } });
    }
  }
  if (m.method === 'ping') return send({ id: m.id, result: {} });
  if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { void handle(JSON.parse(line)); } catch {} } } });
