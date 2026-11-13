// Knowledge graph store for Dispatch memory.
// Ported from the official MCP Memory server (modelcontextprotocol/servers, src/memory/index.ts),
// Copyright Anthropic, PBC and MCP contributors; MIT / Apache-2.0 (the project is moving from MIT to
// Apache-2.0). See desktop/THIRD_PARTY_LICENSES.md.
// Kept from upstream: JSONL format ({type:"entity"|"relation"}), one mutation queue per process,
// a lock file between processes, atomic temp-file + rename saves, unreadable lines and unknown
// fields written back unchanged, and the create/add/delete semantics of the nine tools.
// Dispatch additions (stored as extra fields, so upstream readers still load the file):
// `summary` (L0, one line), `pinned`, `updatedAt`.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

const ENTITY_FIELDS = new Set(['name', 'entityType', 'observations']);
const RELATION_FIELDS = new Set(['from', 'to', 'relationType']);
const OURS = ['summary', 'pinned', 'updatedAt'];
const ignore = () => {};
const busy = e => e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EBUSY');

async function lockIsStale(lockPath, staleMs) {
  const stats = await fs.stat(lockPath).catch(() => null);
  if (!stats) return false;
  if (Date.now() - stats.mtimeMs > staleMs) return true;
  try {
    const { pid, hostname } = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    if (hostname !== os.hostname() || !pid) return false;
    try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
  } catch { return false; }
}

// Upstream withFileLock: O_EXCL lock file, refreshed while held, broken when its owner is gone.
async function withFileLock(lockPath, operation, { staleMs = 30000, timeoutMs = 60000, retryMs = 10 } = {}) {
  const token = JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: randomBytes(16).toString('hex') });
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (;;) {
    let handle;
    try { handle = await fs.open(lockPath, 'wx'); } catch (e) { if (!busy(e)) throw e; }
    if (handle) {
      try { await handle.writeFile(token); await handle.close(); }
      catch (e) { await handle.close().catch(ignore); await fs.unlink(lockPath).catch(ignore); throw e; }
      break;
    }
    if (await lockIsStale(lockPath, staleMs)) { await fs.unlink(lockPath).catch(ignore); continue; }
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for the memory file lock ${lockPath}`);
    await new Promise(r => setTimeout(r, retryMs + Math.random() * retryMs));
  }
  const heartbeat = setInterval(() => { const now = new Date(); fs.utimes(lockPath, now, now).catch(ignore); }, staleMs / 2);
  heartbeat.unref();
  try { return await operation(); }
  finally {
    clearInterval(heartbeat);
    const current = await fs.readFile(lockPath, 'utf8').catch(() => null);
    if (current === token) await fs.unlink(lockPath).catch(ignore);
  }
}

const isStringArray = v => Array.isArray(v) && v.every(x => typeof x === 'string');
const validEntity = r => typeof r.name === 'string' && typeof r.entityType === 'string' && isStringArray(r.observations);
const validRelation = r => typeof r.from === 'string' && typeof r.to === 'string' && typeof r.relationType === 'string';

class KnowledgeGraphManager {
  constructor(memoryFilePath, lockOptions = {}) {
    this.file = memoryFilePath;
    this.lockOptions = lockOptions;
    this.queue = Promise.resolve();
    this.extra = new WeakMap();
  }

  withLock(operation) {
    const locked = () => withFileLock(`${this.file}.lock`, operation, this.lockOptions);
    const result = this.queue.then(locked, locked);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async load() {
    let data;
    try { data = await fs.readFile(this.file, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return { graph: { entities: [], relations: [] }, unreadable: [] }; throw e; }
    const graph = { entities: [], relations: [] }, unreadable = [];
    for (const line of data.split('\n').filter(l => l.trim() !== '')) {
      let item;
      try { item = JSON.parse(line); } catch { unreadable.push(line); continue; }
      if (!item || typeof item !== 'object') { unreadable.push(line); continue; }
      const [valid, fields, list] = item.type === 'entity' ? [validEntity, ENTITY_FIELDS, graph.entities] : item.type === 'relation' ? [validRelation, RELATION_FIELDS, graph.relations] : [];
      if (!valid || !valid(item)) { unreadable.push(line); continue; }
      const parsed = Object.fromEntries([...fields].map(k => [k, item[k]]));
      const extras = Object.entries(item).filter(([k]) => k !== 'type' && !fields.has(k));
      if (extras.length) this.extra.set(parsed, Object.fromEntries(extras));
      list.push(parsed);
    }
    return { graph, unreadable };
  }

  async save(graph, unreadable) {
    const lines = [
      ...graph.entities.map(e => JSON.stringify({ type: 'entity', name: e.name, entityType: e.entityType, observations: e.observations, ...this.extra.get(e) })),
      ...graph.relations.map(r => JSON.stringify({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType, ...this.extra.get(r) })),
      ...unreadable,
    ];
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = path.join(path.dirname(this.file), `${path.basename(this.file)}.${randomBytes(16).toString('hex')}.tmp`);
    try { await fs.writeFile(temp, lines.join('\n') + '\n'); await fs.rename(temp, this.file); }
    catch (e) { await fs.unlink(temp).catch(ignore); throw e; }
  }

  // Dispatch fields live in the extras map, so a write keeps them and upstream readers ignore them.
  meta(e) { return this.extra.get(e) || {}; }
  setMeta(e, patch) { const m = { ...this.meta(e) }; for (const k of OURS) if (patch[k] !== undefined) m[k] = patch[k]; m.updatedAt = new Date().toISOString(); this.extra.set(e, m); }
  view(e) { const m = this.meta(e); return { name: e.name, entityType: e.entityType, observations: e.observations, summary: m.summary || '', pinned: !!m.pinned, updatedAt: m.updatedAt || '' }; }

  mutate(fn) { return this.withLock(async () => { const { graph, unreadable } = await this.load(); const result = await fn(graph); await this.save(graph, unreadable); return result; }); }

  createEntities(entities) {
    return this.mutate(graph => {
      const fresh = entities.filter((e, i) => !graph.entities.some(x => x.name === e.name) && !entities.slice(0, i).some(x => x.name === e.name));
      for (const e of fresh) { const entity = { name: e.name, entityType: e.entityType, observations: [...new Set(e.observations || [])] }; this.setMeta(entity, e); graph.entities.push(entity); }
      return fresh.map(e => e.name);
    });
  }

  createRelations(relations) {
    return this.mutate(graph => {
      const names = new Set(graph.entities.map(e => e.name));
      for (const r of relations) { if (!names.has(r.from)) throw new Error(`Entity with name ${r.from} not found`); if (!names.has(r.to)) throw new Error(`Entity with name ${r.to} not found`); }
      const same = (a, b) => a.from === b.from && a.to === b.to && a.relationType === b.relationType;
      const fresh = relations.filter((r, i) => !graph.relations.some(x => same(x, r)) && !relations.slice(0, i).some(x => same(x, r))).map(r => ({ from: r.from, to: r.to, relationType: r.relationType }));
      graph.relations.push(...fresh);
      return fresh;
    });
  }

  addObservations(observations) {
    return this.mutate(graph => observations.map(o => {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) throw new Error(`Entity with name ${o.entityName} not found`);
      const added = [...new Set(o.contents)].filter(c => !entity.observations.includes(c));
      entity.observations.push(...added);
      this.setMeta(entity, {});
      return { entityName: o.entityName, addedObservations: added };
    }));
  }

  // Dispatch: edit summary / type / pinned of an entity (upstream has no update tool).
  updateEntity(name, patch) {
    return this.mutate(graph => {
      const entity = graph.entities.find(e => e.name === name);
      if (!entity) throw new Error(`Entity with name ${name} not found`);
      if (typeof patch.entityType === 'string' && patch.entityType.trim()) entity.entityType = patch.entityType.trim();
      if (isStringArray(patch.observations)) entity.observations = [...new Set(patch.observations.filter(Boolean))];
      this.setMeta(entity, patch);
      return this.view(entity);
    });
  }

  deleteEntities(names) {
    return this.mutate(graph => {
      const present = new Set(graph.entities.map(e => e.name));
      graph.entities = graph.entities.filter(e => !names.includes(e.name));
      graph.relations = graph.relations.filter(r => !names.includes(r.from) && !names.includes(r.to));
      return { deleted: names.filter(n => present.has(n)), notFound: names.filter(n => !present.has(n)) };
    });
  }

  deleteObservations(deletions) {
    return this.mutate(graph => {
      let deletedCount = 0; const missingEntities = [];
      for (const d of deletions) {
        const entity = graph.entities.find(e => e.name === d.entityName);
        if (!entity) { missingEntities.push(d.entityName); continue; }
        const before = entity.observations.length;
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
        if (entity.observations.length !== before) { deletedCount += before - entity.observations.length; this.setMeta(entity, {}); }
      }
      return { deletedCount, missingEntities };
    });
  }

  deleteRelations(relations) {
    return this.mutate(graph => {
      const before = graph.relations.length;
      graph.relations = graph.relations.filter(r => !relations.some(d => r.from === d.from && r.to === d.to && r.relationType === d.relationType));
      return { deletedCount: before - graph.relations.length };
    });
  }

  async readGraph() { const { graph } = await this.load(); return { entities: graph.entities.map(e => this.view(e)), relations: graph.relations }; }
}

module.exports = { KnowledgeGraphManager, withFileLock };
