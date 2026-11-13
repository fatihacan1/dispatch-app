const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { create, parseSource, frontmatter } = require('./skills.cjs');

test('GitHub links and shorthands', () => {
  assert.deepEqual(parseSource('https://github.com/anthropics/skills'), { owner: 'anthropics', repo: 'skills', ref: '', sub: '' });
  assert.deepEqual(parseSource('https://github.com/anthropics/skills/tree/main/skills/pdf/'), { owner: 'anthropics', repo: 'skills', ref: 'main', sub: 'skills/pdf' });
  assert.deepEqual(parseSource('github.com/a/b/blob/dev/x/SKILL.md'), { owner: 'a', repo: 'b', ref: 'dev', sub: 'x' });
  assert.deepEqual(parseSource('a/b.git'), { owner: 'a', repo: 'b', ref: '', sub: '' });
  assert.throws(() => parseSource('https://gitlab.com/a/b'), /GitHub link/);
  assert.deepEqual(frontmatter('---\nname: pdf\ndescription: "Read PDFs"\n  and forms\n---\nbody'), { name: 'pdf', description: 'Read PDFs and forms' });
});

test('install from a folder, toggle, plugin dirs, remove', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skills-'));
  try {
    const src = path.join(root, 'src');
    for (const [dir, name] of [['tools/alpha', 'alpha'], ['tools/beta', 'Beta Skill']]) {
      fs.mkdirSync(path.join(src, dir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(src, dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Does ${name}\n---\nSteps`);
      fs.writeFileSync(path.join(src, dir, 'scripts', 'run.py'), 'print(1)');
    }
    fs.mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(src, 'node_modules', 'x', 'SKILL.md'), '---\nname: nope\n---');
    const s = create({ globalDir: path.join(root, 'home'), projectDir: path.join(root, 'ws') });
    assert.deepEqual(s.pluginDirs(), []);
    const p = await s.preview(src);
    assert.deepEqual(p.skills.map(x => [x.name, x.path, x.scripts]), [['alpha', 'tools/alpha', 1], ['beta-skill', 'tools/beta', 1]]);
    assert.deepEqual(s.install(p.id, ['alpha'], 'global'), ['alpha']);
    assert.ok(fs.existsSync(path.join(root, 'home', 'skills', '.claude-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(root, 'home', 'skills', 'skills', 'alpha', 'scripts', 'run.py')));
    assert.deepEqual(s.pluginDirs(), [path.join(root, 'home', 'skills')]);
    assert.equal(s.list()[0].source.kind, 'folder');
    s.setEnabled('alpha', 'global', false);
    assert.equal(s.list()[0].enabled, false);
    assert.deepEqual(s.pluginDirs(), [], 'no enabled skills, no plugin dir');
    s.setEnabled('alpha', 'global', true);
    s.remove('alpha', 'global');
    assert.deepEqual(s.list(), []);
    assert.throws(() => s.install(p.id, ['alpha'], 'global'), /expired/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real GitHub lookup and install', { skip: !process.env.DISPATCH_NET_TESTS }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skills-net-'));
  try {
    const s = create({ globalDir: path.join(root, 'home'), projectDir: path.join(root, 'ws') });
    const p = await s.preview('https://github.com/anthropics/skills');
    assert.ok(p.skills.length > 3, `found ${p.skills.length}`);
    const one = p.skills[0].name;
    s.install(p.id, [one], 'project');
    assert.equal(s.list()[0].source.owner, 'anthropics');
    assert.ok(await s.update(one, 'project'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
