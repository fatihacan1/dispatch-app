// .dispatch packs: share a trained workspace (or a single agent) as one file.
// A pack is a ZIP with dispatch.json (manifest) at the root:
//   agents/<file>.md            agent templates
//   teams/<file>.json           saved teams (members carry template snapshots)
//   skills/<name>/...           skill folders (SKILL.md + files)
//   memory/project.jsonl        boss memory graph (MCP Memory JSONL)
//   memory/global.jsonl         optional, only when the author chose to share it
//   settings/*.json             boss provider choice, boss-visible templates, project memory switches
//   outputs/...                 optional: the shared outputs gallery (.dispatch/outputs), up to 200 MB
// Never included: operations, chats, logs, outputs, trust, the code index, provider logins or keys.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zip = require('./zip.cjs');
const templatesLib = require('./templates.cjs');
const teamsLib = require('./teams.cjs');
const skillsLib = require('./skills.cjs');
const { withFileLock } = require('./memory-graph.cjs');

const FORMAT = 'dispatch-pack', VERSION = 1, EXT = 'dispatch';
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv']);
const SETTINGS = { 'boss-providers.json': 'boss-providers.json', 'boss-visible-templates.json': 'boss-visible-templates.json', 'memory-project.json': 'memory-project.json', 'schedules.json': 'schedules.json' };
const MAX_OUTPUTS = 200 * 1024 * 1024;
const SCRIPT =/\.(sh|ps1|py|js|mjs|cjs|ts|bat|cmd|exe|vbs)$/i;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'item';
const id = (...parts) => crypto.createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 16);

function files(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) files(path.join(dir, e.name), r, out); else if (e.isFile()) out.push(r);
  }
  return out;
}

function graphStats(text) {
  let entities = 0, relations = 0;
  for (const line of String(text || '').split('\n')) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r.type === 'entity') entities++; else if (r.type === 'relation') relations++; } catch {} }
  return { entities, relations };
}

/** Everything in this workspace (and the user's global Dispatch folder) that can go into a pack. */
function inventory({ workspace, globalDir, claudeHome }) {
  const dispatchDir = path.join(workspace, '.dispatch');
  const agents = templatesLib.list(workspace).filter(t => !t.readonly).map(t => ({
    id: id('agent', t.file), name: t.name, description: t.description, provider: t.provider, model: t.model, role: t.extra?.role || '',
    scope: t.scope === 'claude' ? (path.resolve(t.file).startsWith(path.resolve(workspace)) ? 'claude-project' : 'claude-user') : t.scope, file: t.file,
  }));
  // `uses`: the live agent templates a team is built from, so picking a team in Share can pick them too.
  const agentId = (name, boss) => agents.find(a => a.name === name && (a.role === 'boss') === boss)?.id;
  const teams = teamsLib.list(workspace).map(t => ({ id: id('team', t.file), name: t.name, description: t.description || '', scope: t.scope, members: (t.members || []).length, file: t.file,
    uses: [...new Set([agentId(t.boss?.template, true), ...(t.members || []).map(m => agentId(m.template, false))].filter(Boolean))] }));
  const skills = [];
  const store = skillsLib.create({ globalDir, projectDir: dispatchDir });
  for (const s of store.list()) skills.push({ id: id('skill', s.dir), name: s.name, description: s.description, scope: `dispatch-${s.scope}`, enabled: s.enabled, dir: s.dir });
  for (const s of skillsLib.claudeSkills({ claudeHome, workspace })) if (s.kind !== 'plugin') skills.push({ id: id('skill', s.dir), name: slug(s.folder), description: s.description, scope: `claude-${s.kind}`, enabled: true, dir: s.dir });
  for (const s of skills) { const f = files(s.dir); s.files = f.length; s.scripts = f.filter(x => SCRIPT.test(x)).length; }
  const memFile = { project: path.join(dispatchDir, 'memory', 'project.jsonl'), global: path.join(globalDir, 'memory', 'global.jsonl') };
  const memory = Object.fromEntries(Object.entries(memFile).map(([k, f]) => { let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch {} return [k, { ...graphStats(text), file: f }]; }));
  const settings = Object.keys(SETTINGS).filter(f => fs.existsSync(path.join(dispatchDir, f)));
  const outDir = path.join(dispatchDir, 'outputs');
  let outFiles = []; try { outFiles = files(outDir).filter(f => !path.posix.basename(f).startsWith('.')); } catch {}
  const outputs = { files: outFiles.length, bytes: outFiles.reduce((n, f) => { try { return n + fs.statSync(path.join(outDir, ...f.split('/'))).size; } catch { return n; } }, 0) };
  return { workspace, name: path.basename(workspace), agents, teams, skills, memory, settings, outputs };
}

/** Build a pack. selection: { agents: ids, teams: ids, skills: ids, memory: ['project','global'], settings: bool } */
function build({ workspace, globalDir, claudeHome, selection = {}, meta = {}, appVersion = '' }) {
  const inv = inventory({ workspace, globalDir, claudeHome });
  const pick = (list, ids) => list.filter(x => (ids || []).includes(x.id));
  const entries = [], used = new Set();
  const unique = (dir, base, ext) => { let n = `${dir}/${base}${ext}`, i = 2; while (used.has(n)) n = `${dir}/${base}-${i++}${ext}`; used.add(n); return n; };
  const manifest = {
    format: FORMAT, version: VERSION, name: String(meta.name || inv.name).trim().slice(0, 120), description: String(meta.description || '').trim().slice(0, 4000),
    author: String(meta.author || '').trim().slice(0, 120), created: new Date().toISOString(), app: appVersion,
    contents: { agents: [], teams: [], skills: [], memory: {}, settings: [] },
  };
  for (const a of pick(inv.agents, selection.agents)) {
    const p = unique('agents', slug(path.basename(a.file, '.md')), '.md');
    entries.push({ name: p, data: fs.readFileSync(a.file) });
    manifest.contents.agents.push({ path: p, name: a.name, description: a.description, provider: a.provider, model: a.model, role: a.role, scope: a.scope.startsWith('claude') ? 'project' : a.scope });
  }
  for (const t of pick(inv.teams, selection.teams)) {
    const p = unique('teams', slug(path.basename(t.file, '.json')), '.json');
    entries.push({ name: p, data: fs.readFileSync(t.file) });
    manifest.contents.teams.push({ path: p, name: t.name, description: t.description, members: t.members, scope: t.scope });
  }
  for (const s of pick(inv.skills, selection.skills)) {
    const p = unique('skills', slug(s.name), '');
    const list = files(s.dir);
    for (const f of list) entries.push({ name: `${p}/${f}`, data: fs.readFileSync(path.join(s.dir, ...f.split('/'))) });
    manifest.contents.skills.push({ path: p, name: slug(s.name), description: s.description, files: list.length, scripts: list.filter(x => SCRIPT.test(x)).length, enabled: s.enabled });
  }
  for (const scope of ['project', 'global']) {
    if (!(selection.memory || []).includes(scope)) continue;
    let text = ''; try { text = fs.readFileSync(inv.memory[scope].file, 'utf8'); } catch {}
    if (!text.trim()) continue;
    entries.push({ name: `memory/${scope}.jsonl`, data: text });
    manifest.contents.memory[scope] = { path: `memory/${scope}.jsonl`, ...graphStats(text) };
  }
  if (selection.settings) for (const f of inv.settings) {
    entries.push({ name: `settings/${f}`, data: fs.readFileSync(path.join(workspace, '.dispatch', f)) });
    manifest.contents.settings.push(`settings/${f}`);
  }
  if (selection.outputs && inv.outputs.files) {
    if (inv.outputs.bytes > MAX_OUTPUTS) throw new Error(`Outputs are ${Math.round(inv.outputs.bytes / 1048576)} MB; packs take up to ${MAX_OUTPUTS / 1048576} MB of outputs. Move big files out of .dispatch/outputs or export without outputs.`);
    const outDir = path.join(workspace, '.dispatch', 'outputs');
    const list = files(outDir).filter(f => !path.posix.basename(f).startsWith('.'));
    for (const f of list) entries.push({ name: `outputs/${f}`, data: fs.readFileSync(path.join(outDir, ...f.split('/'))) });
    manifest.contents.outputs = { files: list.length, bytes: inv.outputs.bytes };
  }
  const c = manifest.contents;
  if (!c.agents.length && !c.teams.length && !c.skills.length && !Object.keys(c.memory).length && !c.settings.length && !c.outputs?.files) throw new Error('Choose at least one thing to export.');
  manifest.kind = c.agents.length === 1 && !c.teams.length && !c.skills.length && !Object.keys(c.memory).length ? 'agent' : 'workspace';
  entries.unshift({ name: 'dispatch.json', data: JSON.stringify(manifest, null, 2) }, { name: 'README.md', data: readme(manifest) });
  return { buffer: zip.write(entries), manifest };
}

function readme(m) {
  const c = m.contents, lines = [`# ${m.name}`, '', m.description || '', '', `A Dispatch pack${m.author ? ` by ${m.author}` : ''}, made ${m.created.slice(0, 10)}. Open it with Dispatch to import.`, ''];
  if (c.agents.length) lines.push('## Agents', ...c.agents.map(a => `- **${a.name}** (${a.provider}${a.model ? ', ' + a.model : ''}): ${a.description}`), '');
  if (c.teams.length) lines.push('## Teams', ...c.teams.map(t => `- **${t.name}**: ${t.description} (${t.members} members)`), '');
  if (c.skills.length) lines.push('## Skills', ...c.skills.map(s => `- **${s.name}**: ${s.description}`), '');
  const mem = Object.entries(c.memory);
  if (mem.length) lines.push('## Boss memory', ...mem.map(([k, v]) => `- ${k}: ${v.entities} entries, ${v.relations} links`), '');
  return lines.join('\n');
}

/** Read a pack and describe it against the target workspace. Returns the parsed pack for import(). */
function open(buffer) {
  const entries = zip.read(buffer);
  const byName = new Map(entries.map(e => [e.name, e.data]));
  let manifest; try { manifest = JSON.parse(byName.get('dispatch.json').toString('utf8')); } catch { throw new Error('This file is not a Dispatch pack (dispatch.json is missing).'); }
  if (manifest.format !== FORMAT) throw new Error('This file is not a Dispatch pack.');
  if (manifest.version > VERSION) throw new Error('This pack was made by a newer Dispatch. Update Dispatch to open it.');
  const c = manifest.contents = { agents: [], teams: [], skills: [], memory: {}, settings: [], ...(manifest.contents || {}) };
  c.agents = c.agents.filter(a => zip.safeName(a.path) && byName.has(a.path));
  c.teams = c.teams.filter(t => zip.safeName(t.path) && byName.has(t.path));
  c.skills = c.skills.filter(s => zip.safeName(s.path) && entries.some(e => e.name.startsWith(s.path + '/') && /\/skill\.md$/i.test(e.name)));
  for (const k of Object.keys(c.memory)) if (!['project', 'global'].includes(k) || !byName.has(c.memory[k].path)) delete c.memory[k];
  c.settings = c.settings.filter(p => byName.has(p) && SETTINGS[path.posix.basename(p)]);
  const outs = entries.filter(e => e.name.startsWith('outputs/'));
  c.outputs = outs.length ? { files: outs.length, bytes: outs.reduce((n, e) => n + e.data.length, 0) } : null;
  return { manifest, entries, byName };
}

/** What already exists in the target, so the user can see what an import would replace. */
function describe(pack, { workspace, globalDir }) {
  const c = pack.manifest.contents;
  const tplNames = new Set(templatesLib.list(workspace).map(t => t.name));
  const teamNames = new Set(teamsLib.list(workspace).map(t => t.name));
  const skillNames = new Set(skillsLib.create({ globalDir, projectDir: path.join(workspace, '.dispatch') }).list().map(s => s.name));
  return {
    manifest: pack.manifest,
    agents: c.agents.map(a => ({ ...a, exists: tplNames.has(a.name) })),
    teams: c.teams.map(t => ({ ...t, exists: teamNames.has(t.name) })),
    skills: c.skills.map(s => ({ ...s, exists: skillNames.has(s.name) })),
    memory: c.memory, settings: c.settings, outputs: c.outputs,
    warnings: [
      ...(c.skills.some(s => s.scripts) ? ['Some skills include scripts that agents may run. Import only packs from people you trust.'] : []),
      ...(c.agents.length || c.teams.length ? ['Agent prompts decide what agents do in your workspace. Read them before you start an operation.'] : []),
    ],
  };
}

/** Merge memory JSONL into the target graph: entities by name (observations unioned), relations deduplicated. */
async function mergeMemory(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let added = 0, merged = 0;
  await withFileLock(`${file}.lock`, async () => {
    let lines = []; try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()); } catch {}
    const records = lines.map(l => { try { return JSON.parse(l); } catch { return l; } });
    const entities = new Map(records.filter(r => r && r.type === 'entity').map(r => [r.name, r]));
    const relKey = r => `${r.from}\0${r.relationType}\0${r.to}`;
    const relations = new Set(records.filter(r => r && r.type === 'relation').map(relKey));
    for (const line of String(text).split('\n')) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r?.type === 'entity' && typeof r.name === 'string') {
        const obs = Array.isArray(r.observations) ? r.observations.filter(o => typeof o === 'string') : [];
        const have = entities.get(r.name);
        if (!have) { const rec = { ...r, observations: obs, updatedAt: r.updatedAt || new Date().toISOString() }; entities.set(r.name, rec); records.push(rec); added++; }
        else { const before = have.observations.length; have.observations = [...new Set([...(have.observations || []), ...obs])]; if (!have.summary && r.summary) have.summary = r.summary; if (have.observations.length !== before) merged++; }
      } else if (r?.type === 'relation' && r.from && r.to && r.relationType && !relations.has(relKey(r))) { relations.add(relKey(r)); records.push({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType }); }
    }
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, records.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n');
    fs.renameSync(tmp, file);
  });
  return { added, merged };
}

/**
 * Apply a pack. choice: { agents: paths, teams: paths, skills: paths, memory: { project: 'project'|'global'|null, global: ... },
 * settings: bool, scope: 'project'|'global' (where agents, teams and skills go), replace: bool }
 */
async function apply(pack, { workspace, globalDir, choice = {} }) {
  const c = pack.manifest.contents, scope = choice.scope === 'global' ? 'global' : 'project', replace = !!choice.replace;
  const dispatchDir = path.join(workspace, '.dispatch'), base = scope === 'global' ? globalDir : dispatchDir;
  const done = { agents: 0, teams: 0, skills: 0, memory: 0, settings: 0, skipped: [] };
  const want = (list, picked) => list.filter(x => !picked || picked.includes(x.path));
  const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

  const existingTpl = templatesLib.list(workspace).filter(t => !t.readonly);
  for (const a of want(c.agents, choice.agents)) {
    const same = existingTpl.find(t => t.name === a.name && (t.scope === scope));
    if (templatesLib.list(workspace).some(t => t.name === a.name) && !replace) { done.skipped.push(`agent ${a.name}`); continue; }
    if (same) { try { fs.unlinkSync(same.file); } catch {} }
    write(path.join(base, 'agents', path.posix.basename(a.path)), pack.byName.get(a.path)); done.agents++;
  }
  const existingTeams = teamsLib.list(workspace);
  for (const t of want(c.teams, choice.teams)) {
    if (existingTeams.some(x => x.name === t.name) && !replace) { done.skipped.push(`team ${t.name}`); continue; }
    write(path.join(base, 'teams', path.posix.basename(t.path)), pack.byName.get(t.path)); done.teams++;
  }
  const store = skillsLib.create({ globalDir, projectDir: dispatchDir });
  const haveSkills = new Set(store.list().map(s => s.name));
  const picked = want(c.skills, choice.skills);
  if (picked.length) {
    const root = store.ensurePlugin(scope), sources = readJson(path.join(root, 'sources.json'), {});
    for (const s of picked) {
      const name = slug(s.name);
      if (haveSkills.has(name) && !replace) { done.skipped.push(`skill ${name}`); continue; }
      const target = path.join(root, s.enabled === false ? 'disabled' : 'skills', name);
      for (const d of ['skills', 'disabled']) fs.rmSync(path.join(root, d, name), { recursive: true, force: true });
      for (const e of pack.entries) if (e.name.startsWith(s.path + '/')) write(path.join(target, ...e.name.slice(s.path.length + 1).split('/')), e.data);
      sources[name] = { kind: 'pack', pack: pack.manifest.name, author: pack.manifest.author || '', installedAt: new Date().toISOString() };
      done.skills++;
    }
    fs.writeFileSync(path.join(root, 'sources.json'), JSON.stringify(sources, null, 2));
  }
  for (const [from, info] of Object.entries(c.memory)) {
    const to = choice.memory ? choice.memory[from] : from === 'project' ? 'project' : null;
    if (!to) continue;
    const file = to === 'global' ? path.join(globalDir, 'memory', 'global.jsonl') : path.join(dispatchDir, 'memory', 'project.jsonl');
    const r = await mergeMemory(file, pack.byName.get(info.path).toString('utf8'));
    done.memory += r.added + r.merged;
  }
  // Outputs land in .dispatch/outputs; a file that already exists is kept unless replace is on.
  if (c.outputs && choice.outputs !== false) for (const e of pack.entries) {
    if (!e.name.startsWith('outputs/')) continue;
    const f = path.join(dispatchDir, ...e.name.split('/'));
    if (fs.existsSync(f) && !replace) continue;
    write(f, e.data); done.outputs = (done.outputs || 0) + 1;
  }
  if (choice.settings) for (const p of c.settings) {
    const f = path.join(dispatchDir, SETTINGS[path.posix.basename(p)]);
    if (path.posix.basename(p) === 'schedules.json') {
      // Imported schedules are added paused: the user turns each one on after reading it.
      let theirs = []; try { theirs = JSON.parse(pack.byName.get(p).toString('utf8')); } catch {}
      const mine = readJson(f, []), ids = new Set(mine.map(s => s.id));
      const added = (Array.isArray(theirs) ? theirs : []).filter(s => s && s.id && s.task && !ids.has(s.id)).map(s => ({ ...s, status: 'paused', runs: 0, last: 0, lastNote: `Imported from ${pack.manifest.name}` }));
      write(f, JSON.stringify([...mine, ...added], null, 2)); done.schedules = added.length; continue;
    }
    if (fs.existsSync(f) && !replace) { done.skipped.push(`setting ${path.posix.basename(p)}`); continue; }
    write(f, pack.byName.get(p)); done.settings++;
  }
  return done;
}

module.exports = { FORMAT, VERSION, EXT, inventory, build, open, describe, apply, mergeMemory };
