// Saved teams: a boss setup plus a fixed set of members, started together with one click.
// Stored as JSON in <workspace>/.dispatch/teams (project) or ~/.dispatch/teams (global).
// Members keep a snapshot of their template so a global team also works in folders that lack those templates.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dirs = workspace => [
  { scope: 'project', dir: path.join(workspace, '.dispatch', 'teams') },
  { scope: 'global', dir: path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'teams') },
];
const slug = s => String(s).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
const NAME = /^[a-z][a-z0-9-]{0,30}$/;

function list(workspace) {
  const out = []; const seenDirs = new Set();
  for (const { scope, dir } of dirs(workspace)) {
    if (seenDirs.has(path.resolve(dir).toLowerCase())) continue; seenDirs.add(path.resolve(dir).toLowerCase());
    let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) { try { out.push({ ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), file: path.join(dir, f), scope }); } catch {} }
  }
  return out;
}
const pick = t => t && { name: t.name, description: t.description || '', provider: t.provider, model: t.model || '', effort: t.effort || '', extra: t.extra || {}, body: t.body || '' };

function save(workspace, team, templates) {
  if (!String(team.name || '').trim()) throw new Error('Team name is required.');
  if (!team.boss?.template) throw new Error('Choose a boss for this team.');
  const seen = new Set();
  const members = (team.members || []).map(m => {
    const name = String(m.name || '').trim().toLowerCase();
    if (!NAME.test(name) || name === 'boss' || name === 'you') throw new Error(`"${m.name}" is not a valid agent name (lowercase letters, digits and dashes).`);
    if (seen.has(name)) throw new Error(`Two members are named ${name}.`); seen.add(name);
    const tpl = templates.find(t => t.name === m.template && t.extra?.role !== 'boss');
    if (!tpl && !m.snapshot) throw new Error(`Template ${m.template} was not found.`);
    return { name, template: m.template, snapshot: pick(tpl) || m.snapshot };
  });
  const bossTpl = templates.find(t => t.name === team.boss.template && t.extra?.role === 'boss');
  const data = {
    name: String(team.name).trim(), description: String(team.description || ''),
    boss: { template: team.boss.template, provider: team.boss.provider || '', model: team.boss.model || '', notes: String(team.boss.notes || ''), snapshot: pick(bossTpl) || team.boss.snapshot },
    members,
  };
  const { dir } = dirs(workspace).find(d => d.scope === (team.scope === 'project' ? 'project' : 'global'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug(data.name) + '.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  if (team.file && path.resolve(team.file) !== path.resolve(file)) { try { fs.unlinkSync(team.file); } catch {} }
  return file;
}
function remove(workspace, file) {
  const ok = dirs(workspace).some(d => path.resolve(file).toLowerCase().startsWith(path.resolve(d.dir).toLowerCase() + path.sep));
  if (!ok) throw new Error('Not a team file.');
  fs.unlinkSync(file); return true;
}
// Live template by name wins; the saved snapshot covers folders where it does not exist.
function resolve(team, templates) {
  const live = (name, boss) => templates.find(t => t.name === name && (t.extra?.role === 'boss') === boss);
  const b = live(team.boss.template, true) || team.boss.snapshot;
  if (!b) throw new Error(`Boss template ${team.boss.template} was not found.`);
  const members = team.members.map(m => ({ name: m.name, template: live(m.template, false) || m.snapshot })).filter(m => m.template);
  const roster = members.map(m => `- ${m.name}: ${m.template.description || m.template.name} (${m.template.provider}${m.template.model ? ', ' + m.template.model : ''})`).join('\n');
  const section = [`## Your team: ${team.name}`, team.description, `These agents are already on board and report to you. Give them work with \`dispatch send --to <name>\`; enlist more only when the team cannot cover a task.`, roster, team.boss.notes && `### Notes for this team\n${team.boss.notes}`].filter(Boolean).join('\n\n');
  const boss = { ...b, provider: team.boss.provider || b.provider, model: team.boss.provider && team.boss.provider !== b.provider ? team.boss.model : (team.boss.model || b.model), body: `${b.body}\n\n${section}`, extra: { ...(b.extra || {}), role: 'boss' } };
  return { boss, members };
}
module.exports = { list, save, remove, resolve, pick };
