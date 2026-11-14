import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('boss template and model override launch and change boss', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-boss-'));
  const dir = path.join(workspace, '.dispatch', 'agents'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'boss.md'), '---\nname: boss\nrole: boss\nprovider: claude\nmodel: custom-template-model\n---\nCustom boss instructions\n');
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('custom-template-model', { timeout: 20000 });
    await page.getByRole('button', { name: 'Start operation' }).click();
    let boss = await page.evaluate(() => (window as any).army.debugAgent('boss'));
    expect(boss.args).toContain('custom-template-model'); expect(boss.prompt).toContain('Custom boss instructions');
    await page.getByRole('button', { name: 'Actions for boss' }).click();
    await page.getByRole('button', { name: /^Change boss/ }).click();
    await page.getByRole('dialog').getByLabel('Model', { exact: true }).selectOption('claude-sonnet-5-5');
    await page.getByRole('button', { name: 'Change boss', exact: true }).click();
    boss = await page.evaluate(() => (window as any).army.debugAgent('boss'));
    expect(boss.args).toContain('claude-sonnet-5-5');
    await expect(page.getByRole('button', { name: /boss.*claude-sonnet-5-5/i }).first()).toBeVisible();
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
