import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('a saved team starts its boss and members together', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-team-'));
  const dir = path.join(workspace, '.dispatch', 'agents'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'modeler.md'), '---\nname: modeler\ndescription: Builds 3D models\nprovider: codex\nmodel: gpt-6.1-sol\n---\nYou build 3D models.\n');
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Templates' }).click();
    await page.getByRole('tab', { name: 'Teams' }).click();
    await page.getByRole('button', { name: 'New team' }).click();
    await page.getByLabel('Name').fill('Game studio');
    await page.getByLabel('Notes for the boss').fill('Ship a playable build every day.');
    await page.getByRole('button', { name: 'Add member' }).click();
    await page.getByLabel('Member 1 template').selectOption('modeler');
    await page.getByLabel('Member 1 name').fill('artist');
    await page.getByRole('button', { name: 'Save team' }).click();
    await expect(page.getByText('Team saved.')).toBeVisible();
    expect(fs.existsSync(path.join(workspace, '.dispatch', 'teams', 'game-studio.json'))).toBe(true);

    await page.getByRole('button', { name: 'Home' }).click();
    await page.getByLabel('Team').selectOption({ label: 'Game studio · boss + 1' });
    await page.getByRole('button', { name: 'Start team' }).click();
    const boss = await page.evaluate(() => (window as any).army.debugAgent('boss'));
    expect(boss.prompt).toContain('Your team: Game studio');
    expect(boss.prompt).toContain('artist: Builds 3D models');
    expect(boss.prompt).toContain('Ship a playable build every day.');
    const artist = await page.evaluate(() => (window as any).army.debugAgent('artist'));
    expect(artist.prompt).toContain('You build 3D models.');
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
