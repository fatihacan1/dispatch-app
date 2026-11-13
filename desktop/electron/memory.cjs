// Dispatch boss memory: two knowledge graphs (project + global) over memory-graph.cjs,
// settings, tiered reads and an activity log.
// Tiers (idea from OpenViking's L0/L1/L2 context, no code taken; no extra LLM calls):
//   L0 = entity name + one-line summary, injected into the boss prompt within a token budget
//   L1 = memory_search: ranked entities with summary and only the matching observations
//   L2 = memory_open: full entities with every observation and their relations
const fs = require('node:fs');
const path = require('node:path');
const { KnowledgeGraphManager } = require('./memory-graph.cjs');

const SCOPES = ['project', 'global'];
const GLOBAL_DEFAULTS = { globalEnabled: true, autoInject: true, bossCanWrite: true, budgetTokens: 1200, disableProviderMemory: true };
const PROJECT_DEFAULTS = { projectEnabled: true, includeGlobal: true };
const tokens = text => Math.ceil(String(text || '').length / 4);
const words = s => String(s || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
const readJson = f => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

function create({ globalDir, projectDir, log }) {
  const dirs = { global: path.join(globalDir, 'memory'), project: path.join(projectDir, 'memory') };
  // Distinct names, so the two scopes never share a file even when the workspace is the home folder.
  const files = { global: path.join(dirs.global, 'global.jsonl'), project: path.join(dirs.project, 'project.jsonl') };
  const settingsFiles = { global: path.join(globalDir, 'memory-global.json'), project: path.join(projectDir, 'memory-project.json') };
  const graphs = { global: new KnowledgeGraphManager(files.global), project: new KnowledgeGraphManager(files.project) };

  const settings = () => ({ ...GLOBAL_DEFAULTS, ...readJson(settingsFiles.global), ...PROJECT_DEFAULTS, ...readJson(settingsFiles.project) });
  function saveSettings(patch) {
    const next = { ...settings(), ...patch };
    next.budgetTokens = Math.max(0, Math.min(20000, Math.round(Number(next.budgetTokens) || 0)));
    const pick = keys => Object.fromEntries(keys.map(k => [k, next[k]]));
    for (const [scope, keys] of [['global', Object.keys(GLOBAL_DEFAULTS)], ['project', Object.keys(PROJECT_DEFAULTS)]]) {
      fs.mkdirSync(path.dirname(settingsFiles[scope]), { recursive: true });
      fs.writeFileSync(settingsFiles[scope], JSON.stringify(pick(keys), null, 2));
    }
    return next;
  }
  const enabled = scope => { const s = settings(); return scope === 'project' ? !!s.projectEnabled : !!(s.globalEnabled && s.includeGlobal); };
  const active = () => SCOPES.filter(enabled);
  function scopesFor(scope) {
    if (scope === undefined || scope === null || scope === '' || scope === 'all') return active();
    if (!SCOPES.includes(scope)) throw new Error(`Unknown memory scope "${scope}". Use project or global.`);
    if (!enabled(scope)) throw new Error(`${scope} memory is turned off in Dispatch settings.`);
    return [scope];
  }
  function writable(scope = 'project') {
    const [s] = scopesFor(scope);
    if (!settings().bossCanWrite) throw new Error('Memory is read-only: the user turned off "Boss can write" in Dispatch settings.');
    return graphs[s];
  }

  function record(entry) {
    if (!log) return;
    try { fs.mkdirSync(path.dirname(log), { recursive: true }); fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n'); } catch {}
  }
  function activity(limit = 200) {
    try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; }
  }

  async function graph(scope) { return graphs[scope].readGraph(); }
  // Synchronous read for the boss prompt (startAgent is synchronous). Same JSONL format.
  function entitiesSync(scope) {
    let data = ''; try { data = fs.readFileSync(files[scope], 'utf8'); } catch { return []; }
    return data.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(r => r && r.type === 'entity' && typeof r.name === 'string' && Array.isArray(r.observations))
      .map(r => ({ name: r.name, entityType: String(r.entityType || ''), observations: r.observations.map(String), summary: r.summary || '', pinned: !!r.pinned, updatedAt: r.updatedAt || '', scope }));
  }
  const all = () => active().flatMap(entitiesSync);

  // L0: pinned entities with all observations, then one line per entity, newest first.
  function overview(budget = settings().budgetTokens) {
    const items = all();
    if (!items.length) return { text: '', shown: 0, total: 0, tokens: 0 };
    const line = e => `- ${e.name} [${e.entityType}${e.scope === 'global' ? ', global' : ''}]: ${e.summary || e.observations[0] || ''}${e.observations.length > 1 ? ` (${e.observations.length} facts)` : ''}\n`;
    const full = e => `- ${e.name} [${e.entityType}${e.scope === 'global' ? ', global' : ''}] (pinned)${e.summary ? ': ' + e.summary : ''}\n${e.observations.map(o => `  - ${o}`).join('\n')}\n`;
    const ordered = [...items.filter(e => e.pinned), ...items.filter(e => !e.pinned).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))];
    let body = '', shown = 0;
    for (const e of ordered) { const entry = e.pinned ? full(e) : line(e); if (tokens(body + entry) > budget) continue; body += entry; shown++; }
    const left = items.length - shown;
    const text = `\n## Dispatch memory\n${body}${left ? `${left} more entries not listed; memory_search finds them.\n` : ''}`;
    return { text, shown, total: items.length, tokens: tokens(text) };
  }

  // L1: BM25 over name, type, summary and observations; returns only matching observations.
  async function search(query, { scope, limit = 6, perEntity = 3 } = {}) {
    const terms = [...new Set(words(query))];
    const docs = [];
    for (const s of scopesFor(scope)) for (const e of (await graph(s)).entities) docs.push({ e, s, w: words([e.name, e.entityType, e.summary, ...e.observations].join(' ')) });
    if (!terms.length) return [];
    const avg = docs.reduce((a, d) => a + d.w.length, 0) / Math.max(1, docs.length);
    const df = Object.fromEntries(terms.map(t => [t, docs.filter(d => d.w.includes(t)).length]));
    const scored = docs.map(d => {
      let score = 0;
      for (const t of terms) { const tf = d.w.filter(w => w === t).length; if (!tf) continue; const idf = Math.log(1 + (docs.length - df[t] + 0.5) / (df[t] + 0.5)); score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.w.length / (avg || 1))); }
      if (words(d.e.name).some(w => terms.includes(w))) score *= 1.5;
      return { d, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(25, Number(limit) || 6)));
    return scored.map(({ d }) => {
      const hits = d.e.observations.map(o => ({ o, n: words(o).filter(w => terms.includes(w)).length })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, perEntity).map(x => x.o);
      return { name: d.e.name, scope: d.s, entityType: d.e.entityType, summary: d.e.summary, observations: hits, totalObservations: d.e.observations.length };
    });
  }

  // L2: full entities and every relation touching them.
  async function open(names, scope) {
    const out = { entities: [], relations: [] };
    for (const s of scopesFor(scope)) {
      const g = await graph(s);
      const found = g.entities.filter(e => names.includes(e.name));
      const set = new Set(found.map(e => e.name));
      out.entities.push(...found.map(e => ({ ...e, scope: s })));
      out.relations.push(...g.relations.filter(r => set.has(r.from) || set.has(r.to)).map(r => ({ ...r, scope: s })));
    }
    return out;
  }

  return { dirs, files, settingsFiles, graphs, settings, saveSettings, enabled, active, scopesFor, writable, record, activity, graph, all, entitiesSync, overview, search, open, tokens };
}

module.exports = { create, SCOPES, tokens };
