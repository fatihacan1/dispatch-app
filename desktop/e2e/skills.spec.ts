import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('skills: look up a source, install, view, turn off and remove', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skills-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skillhome-'));
  const src = path.join(workspace, 'incoming');
  for (const name of ['release-notes', 'changelog']) {
    fs.mkdirSync(path.join(src, name, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(src, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Writes ${name} from merged pull requests.\n---\nRead the git log, group by type.`);
  }
  fs.writeFileSync(path.join(src, 'release-notes', 'scripts', 'collect.py'), 'print(1)');
  // Skills Claude Code already has: one personal, one from a plugin.
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'old-notes'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'old-notes', 'SKILL.md'), '---\nname: old-notes\ndescription: An old personal skill.\n---\nOld steps.');
  const plugin = path.join(home, '.claude', 'plugins', 'cache', 'm', 'toolkit', '1.0.0');
  fs.mkdirSync(path.join(plugin, 'skills', 'lint'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'skills', 'lint', 'SKILL.md'), '---\nname: lint\ndescription: Lints code.\n---\nRun the linter.');
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'toolkit@m': [{ scope: 'user', installPath: plugin }] } }));
  fs.mkdirSync(path.join(home, '.codex', 'skills', 'codex-review'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'skills', 'codex-review', 'SKILL.md'), '---\nname: codex-review\ndescription: A Codex-only skill.\n---\nReview.');
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Brain', exact: true }).click();
    await page.getByRole('tab', { name: 'Skills', exact: true }).click();
    await expect(page.getByText('No skills yet.')).toBeVisible();
    await page.getByLabel('GitHub link').fill(src);
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText('2 skills found')).toBeVisible();
    await expect(page.getByText(/include 1 script/)).toBeVisible();
    await page.getByLabel('Install changelog').uncheck();
    await page.screenshot({ path: 'e2e/screens/skills-preview.png' });
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    const installed = path.join(home, '.dispatch', 'skills', 'skills', 'release-notes', 'SKILL.md');
    await expect.poll(() => fs.existsSync(installed)).toBe(true);
    expect(fs.existsSync(path.join(home, '.dispatch', 'skills', 'skills', 'changelog'))).toBe(false);
    await page.getByRole('button', { name: 'Show release-notes', exact: true }).click();
    await expect(page.locator('.skill-body')).toContainText('group by type');
    await expect(page.locator('.skill-src')).toContainText('incoming');
    await page.screenshot({ path: 'e2e/screens/skills-installed.png' });
    await page.getByLabel('Use release-notes').uncheck();
    await expect.poll(() => fs.existsSync(path.join(home, '.dispatch', 'skills', 'disabled', 'release-notes', 'SKILL.md'))).toBe(true);
    await page.getByLabel('Give skills to other Claude agents').check();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(home, '.dispatch', 'skills-settings.json'), 'utf8')).claudeAgents).toBe(true);
    await page.getByRole('button', { name: 'Remove release-notes' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('No skills yet.')).toBeVisible();

    await expect(page.getByText('Plugin: toolkit')).toBeVisible();
    await page.getByRole('tab', { name: /^Codex/ }).click();
    await expect(page.getByText('codex-review')).toBeVisible();
    await expect(page.getByText('old-notes')).toHaveCount(0);
    await page.getByRole('tab', { name: /^Claude/ }).click();
    await expect(page.getByText('codex-review')).toHaveCount(0);
    await page.getByRole('tab', { name: /^All/ }).first().click();
    await expect(page.getByRole('button', { name: 'Delete lint' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show old-notes', exact: true }).click();
    await expect(page.getByText('Old steps.')).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/skills-claude.png', fullPage: true });
    await page.getByRole('button', { name: 'Delete old-notes' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => fs.existsSync(path.join(home, '.claude', 'skills', 'old-notes'))).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
