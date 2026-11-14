// Dispatch skills: Claude Code skills (folders with SKILL.md) installed from GitHub or a local folder.
// Each scope is a Claude Code plugin root that main.cjs passes with --plugin-dir to the boss
// (and, if the user chooses, to every Claude agent). ~/.claude/skills is never touched.
//   <root>/.claude-plugin/plugin.json
//   <root>/skills/<name>/SKILL.md        enabled
//   <root>/disabled/<name>/SKILL.md      installed but off
//   <root>/sources.json                  where each skill came from, for updates
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const SCOPES = ['project', 'global'];
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv']);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function frontmatter(text) {
  const m = String(text).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = kv[2].replace(/^["']|["']$/g, '').trim(); }
    else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

function parseSource(input) {
  const s = String(input || '').trim().replace(/\.git$/, '');
  let m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/([^\s#?]*))?)?/i);
  if (m) { let sub = (m[4] || '').replace(/\/+$/, ''); if (/(^|\/)SKILL\.md$/i.test(sub)) sub = sub.replace(/\/?SKILL\.md$/i, ''); return { owner: m[1], repo: m[2], ref: m[3] || '', sub }; }
  m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.+))?$/);
  if (m && !s.includes(':') && !s.startsWith('.')) return { owner: m[1], repo: m[2], ref: '', sub: (m[3] || '').replace(/\/+$/, '') };
  throw new Error('Paste a GitHub link, like https://github.com/owner/repo or a link to a folder inside it.');
}

// Every folder under dir that holds a SKILL.md (a skill folder is not searched further). count(dir) gives the files
// in a skill folder; for a download it comes from the archive listing, since only SKILL.md files are unpacked.
function findSkills(dir, count = listFiles, base = dir, depth = 0, out = []) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  const skillFile = entries.find(e => e.isFile() && e.name.toLowerCase() === 'skill.md');
  if (skillFile) {
    const rel = path.relative(base, dir).split(path.sep).join('/');
    // The antivirus can quarantine a file right after unpacking (offensive-security skills): skip that skill,
    // say which, and keep the rest instead of failing the whole lookup.
    let meta, files;
    try { meta = frontmatter(fs.readFileSync(path.join(dir, skillFile.name), 'utf8')); files = count(dir); }
    catch { (out.blocked ||= []).push(rel || path.basename(dir)); return out; }
    out.push({ dir, rel, name: slug(meta.name || path.basename(dir)) || 'skill', description: meta.description || '', files: files.length, scripts: files.filter(f => /\.(sh|ps1|py|js|mjs|cjs|ts|bat|cmd|exe)$/i.test(f)).length, skillFile: skillFile.name });
    return out;
  }
  if (depth > 6) return out;
  for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) findSkills(path.join(dir, e.name), count, base, depth + 1, out);
  return out;
}
function listFiles(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listFiles(path.join(dir, e.name), r, out); else out.push(r);
  }
  return out;
}

const run = (file, args, opts = {}) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)));

const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
// Unpack these archive members (exact names, in chunks so the command line stays short).
async function untar(archive, out, members) {
  for (let i = 0; i < members.length; i += 200) await run(TAR, ['-xzf', archive, '-C', out, ...members.slice(i, i + 200)], { maxBuffer: 64 * 1024 * 1024 });
}

// Downloads the repo as an archive but unpacks only its SKILL.md files. Everything else stays packed until the user
// installs a skill, and then only that skill's folder comes out: security repos are full of exploit samples, and
// unpacking all of them made the antivirus raise virus warnings for files nobody installed.
async function download(src, workDir) {
  const headers = { 'user-agent': 'dispatch-skills', accept: 'application/vnd.github+json' };
  let ref = src.ref;
  if (!ref) {
    const r = await fetch(`https://api.github.com/repos/${src.owner}/${src.repo}`, { headers, signal: AbortSignal.timeout(20000) });
    if (r.status === 404) throw new Error(`GitHub repository ${src.owner}/${src.repo} was not found (or it is private).`);
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${src.owner}/${src.repo}.`);
    ref = (await r.json()).default_branch || 'main';
  }
  const res = await fetch(`https://codeload.github.com/${src.owner}/${src.repo}/tar.gz/${encodeURIComponent(ref)}`, { headers: { 'user-agent': 'dispatch-skills' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Could not download ${src.owner}/${src.repo}@${ref} (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 200 * 1024 * 1024) throw new Error('That repository is larger than 200 MB.');
  const archive = path.join(workDir, 'src.tar.gz'), out = path.join(workDir, 'x');
  fs.writeFileSync(archive, buf); fs.mkdirSync(out);
  const listing = String(await run(TAR, ['-tzf', archive], { maxBuffer: 64 * 1024 * 1024 })).split(/\r?\n/).filter(Boolean);
  const files = listing.filter(n => !n.endsWith('/'));
  const top = (listing[0] || '').split('/')[0];
  if (!top) throw new Error('The download was empty.');
  const sub = src.sub ? `${top}/${src.sub.replace(/\/+$/, '')}/` : `${top}/`;
  await untar(archive, out, files.filter(n => n.startsWith(sub) && path.posix.basename(n).toLowerCase() === 'skill.md'));
  fs.mkdirSync(path.join(out, top), { recursive: true });
  const members = dir => { const prefix = path.relative(out, dir).split(path.sep).join('/') + '/'; return files.filter(n => n.startsWith(prefix) && !n.split('/').some(x => SKIP.has(x))).map(n => [n, n.slice(prefix.length)]); };
  // Files of one skill folder, read from the listing; and unpacking that folder right before it is installed.
  const count = dir => members(dir).map(m => m[1]);
  const unpack = dir => untar(archive, out, members(dir).map(m => m[0]));
  return { root: path.join(out, top), ref, count, unpack };
}

function create({ globalDir, projectDir }) {
  const roots = { global: path.join(globalDir, 'skills'), project: path.join(projectDir, 'skills') };
  const settingsFile = path.join(globalDir, 'skills-settings.json');
  const settings = () => ({ claudeAgents: false, ...readJson(settingsFile, {}) });
  const saveSettings = patch => { const next = { ...settings(), ...patch }; fs.mkdirSync(globalDir, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2)); return next; };
  const root = scope => { if (!SCOPES.includes(scope)) throw new Error('Unknown skill scope'); return roots[scope]; };
  const sourcesFile = scope => path.join(root(scope), 'sources.json');

  function ensurePlugin(scope) {
    const r = root(scope);
    fs.mkdirSync(path.join(r, '.claude-plugin'), { recursive: true }); fs.mkdirSync(path.join(r, 'skills'), { recursive: true });
    const manifest = path.join(r, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ name: scope === 'global' ? 'dispatch' : 'dispatch-project', version: '1.0.0', description: `Skills installed with Dispatch (${scope})` }, null, 2));
    return r;
  }

  function list() {
    const out = [];
    for (const scope of SCOPES) {
      const sources = readJson(sourcesFile(scope), {});
      for (const [folder, enabled] of [['skills', true], ['disabled', false]]) {
        const dir = path.join(roots[scope], folder);
        let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
        for (const name of names) {
          const full = path.join(dir, name);
          const file = fs.readdirSync(full).find(f => f.toLowerCase() === 'skill.md');
          if (!file) continue;
          const meta = frontmatter(fs.readFileSync(path.join(full, file), 'utf8'));
          out.push({ name, scope, enabled, description: meta.description || '', dir: full, file: path.join(full, file), source: sources[name] || null });
        }
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Fetch a GitHub link (or read a local folder) and report the skills inside. Nothing is installed yet.
  const previews = new Map();
  async function preview(input) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skill-'));
    try {
      let base, source, count = listFiles, unpack = null;
      if (input && fs.existsSync(String(input)) && fs.statSync(String(input)).isDirectory()) { base = path.resolve(String(input)); source = { kind: 'folder', path: base }; }
      else {
        const src = parseSource(input);
        const dl = await download(src, work); const { root: repoRoot, ref } = dl; count = dl.count; unpack = dl.unpack;
        base = src.sub ? path.join(repoRoot, ...src.sub.split('/')) : repoRoot;
        if (!fs.existsSync(base)) throw new Error(`Folder "${src.sub}" is not in ${src.owner}/${src.repo}@${ref}.`);
        source = { kind: 'github', owner: src.owner, repo: src.repo, ref: src.ref || ref, pinnedRef: !!src.ref, sub: src.sub, url: `https://github.com/${src.owner}/${src.repo}` };
      }
      const found = findSkills(base, count);
      const blocked = found.blocked || [];
      if (!found.length && blocked.length) throw new Error(`Windows could not open ${blocked.length === 1 ? 'this skill' : `these ${blocked.length} skills`} (${blocked.slice(0, 5).join(', ')}${blocked.length > 5 ? ', …' : ''}). Usually the antivirus removed a file it flagged, which happens with offensive-security skills.`);
      if (!found.length) throw new Error('No SKILL.md found there. A skill is a folder with a SKILL.md file.');
      const installed = new Set(list().map(s => `${s.scope}:${s.name}`));
      const id = Math.random().toString(36).slice(2);
      previews.set(id, { work, base, source, found, unpack });
      setTimeout(() => discard(id), 30 * 60 * 1000).unref?.();
      return { id, source, blocked, skills: found.map(f => ({ name: f.name, path: f.rel || '.', description: f.description, files: f.files, scripts: f.scripts, installed: { project: installed.has(`project:${f.name}`), global: installed.has(`global:${f.name}`) } })) };
    } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw e; }
  }
  function discard(id) { const p = previews.get(id); if (!p) return; previews.delete(id); fs.rmSync(p.work, { recursive: true, force: true }); }

  async function install(id, names, scope) {
    const p = previews.get(id); if (!p) throw new Error('This preview expired. Look the link up again.');
    const r = ensurePlugin(scope), sources = readJson(sourcesFile(scope), {}), done = [];
    for (const f of p.found.filter(f => names.includes(f.name))) {
      const target = path.join(r, 'skills', f.name);
      fs.rmSync(target, { recursive: true, force: true }); fs.rmSync(path.join(r, 'disabled', f.name), { recursive: true, force: true });
      try { if (p.unpack) await p.unpack(f.dir); fs.cpSync(f.dir, target, { recursive: true, filter: s => !SKIP.has(path.basename(s)) }); } catch { fs.rmSync(target, { recursive: true, force: true }); continue; }
      sources[f.name] = { ...p.source, skillPath: f.rel, installedAt: new Date().toISOString() };
      done.push(f.name);
    }
    fs.writeFileSync(sourcesFile(scope), JSON.stringify(sources, null, 2));
    discard(id);
    return done;
  }

  async function update(name, scope) {
    const src = readJson(sourcesFile(scope), {})[name];
    if (!src || src.kind !== 'github') throw new Error('This skill was not installed from GitHub, so it cannot be updated.');
    const sub = [src.sub, src.skillPath].filter(x => x && x !== '.').join('/');
    const url = `https://github.com/${src.owner}/${src.repo}${src.pinnedRef || sub ? `/tree/${src.pinnedRef ? src.ref : (await defaultRef(src))}${sub ? '/' + sub : ''}` : ''}`;
    const p = await preview(url);
    const match = p.skills.find(s => s.name === name) || (p.skills.length === 1 ? p.skills[0] : null);
    if (!match) { discard(p.id); throw new Error(`"${name}" is no longer in ${src.owner}/${src.repo}.`); }
    const enabled = fs.existsSync(path.join(root(scope), 'skills', name));
    await install(p.id, [match.name], scope);
    if (!enabled) setEnabled(name, scope, false);
    return true;
  }
  async function defaultRef(src) {
    const r = await fetch(`https://api.github.com/repos/${src.owner}/${src.repo}`, { headers: { 'user-agent': 'dispatch-skills' }, signal: AbortSignal.timeout(20000) });
    return r.ok ? (await r.json()).default_branch || src.ref : src.ref;
  }

  function setEnabled(name, scope, on) {
    const r = root(scope), from = path.join(r, on ? 'disabled' : 'skills', name), to = path.join(r, on ? 'skills' : 'disabled', name);
    if (!fs.existsSync(from)) return fs.existsSync(to);
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); return true;
  }
  function remove(name, scope) {
    const r = root(scope);
    for (const d of ['skills', 'disabled']) fs.rmSync(path.join(r, d, name), { recursive: true, force: true });
    const sources = readJson(sourcesFile(scope), {}); delete sources[name];
    if (fs.existsSync(sourcesFile(scope))) fs.writeFileSync(sourcesFile(scope), JSON.stringify(sources, null, 2));
    return true;
  }

  // Plugin roots to pass with --plugin-dir: only scopes that have at least one enabled skill.
  function pluginDirs() {
    return SCOPES.filter(s => { try { return fs.readdirSync(path.join(roots[s], 'skills')).length > 0; } catch { return false; } }).map(s => ensurePlugin(s));
  }
  return { roots, settings, saveSettings, list, preview, discard, install, update, setEnabled, remove, pluginDirs, ensurePlugin };
}

// Skills Claude Code already loads on its own, for every Claude agent (not managed by Dispatch):
// ~/.claude/skills (user), <workspace>/.claude/skills (project), and skills inside installed plugins (read-only).
// Also Codex: ~/.codex/skills and <workspace>/.codex/skills, plus the shared ~/.agents/skills folders Codex reads too.
// Read fresh on every call, so skills Claude or Codex add by themselves show up on the next refresh.
function claudeSkills({ claudeHome, workspace, codexHome, agentsHome }) {
  const out = [];
  const scan = (dir, provider, kind, extra = {}) => {
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if ((!e.isDirectory() && !e.isSymbolicLink()) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      let file; try { file = fs.readdirSync(full).find(f => f.toLowerCase() === 'skill.md'); } catch { continue; }
      if (!file) continue;
      let meta = {}; try { meta = frontmatter(fs.readFileSync(path.join(full, file), 'utf8')); } catch {}
      let created = 0; try { const st = fs.statSync(full); created = Math.round(st.birthtimeMs || st.ctimeMs || st.mtimeMs); } catch {}
      out.push({ id: `${provider}:${kind}:${extra.plugin || ''}:${e.name}`, name: meta.name || e.name, folder: e.name, provider, kind, created, description: meta.description || '', dir: full, file: path.join(full, file), removable: kind !== 'plugin', ...extra });
    }
  };
  scan(path.join(claudeHome, 'skills'), 'claude', 'user');
  if (workspace) scan(path.join(workspace, '.claude', 'skills'), 'claude', 'project');
  const installed = readJson(path.join(claudeHome, 'plugins', 'installed_plugins.json'), {});
  for (const [id, value] of Object.entries(installed.plugins || {})) {
    for (const entry of [].concat(value || [])) if (entry?.installPath) scan(path.join(entry.installPath, 'skills'), 'claude', 'plugin', { plugin: id.split('@')[0] });
  }
  if (codexHome) scan(path.join(codexHome, 'skills'), 'codex', 'user');
  if (agentsHome) scan(path.join(agentsHome, 'skills'), 'codex', 'user');
  if (workspace) { scan(path.join(workspace, '.codex', 'skills'), 'codex', 'project'); scan(path.join(workspace, '.agents', 'skills'), 'codex', 'project'); }
  return out.sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
}

module.exports = { claudeSkills, create, parseSource, frontmatter, findSkills, SCOPES };
