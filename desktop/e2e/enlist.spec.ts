import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('enlist a template and receive a demo bus reply', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-enlist-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => window.army.templates.save({ name: 'smoke-reviewer', description: 'Scenario test', scope: 'project', provider: 'codex', model: 'gpt-6.1-terra', body: 'Test role prompt' }));
    await page.getByRole('button', { name: 'Start operation' }).click();
    await page.getByRole('button', { name: '+ Enlist agent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Enlist agent' });
    await expect(dialog.getByRole('button', { name: /smoke-reviewer/i }).first()).toBeVisible();
    await dialog.getByRole('button', { name: /smoke-reviewer/i }).first().click();
    await dialog.getByPlaceholder('What should this agent start with?').fill('first task');
    await dialog.getByRole('button', { name: 'Enlist', exact: true }).click();
    await expect(page.getByRole('button', { name: /smoke-reviewer-1/i }).first()).toBeVisible();
    const debug = await page.evaluate(() => window.army.debugAgent('smoke-reviewer-1'));
    expect(debug.command).toBe('codex');
    expect(debug.args).toEqual(expect.arrayContaining(['-m', 'gpt-6.1-terra']));
    expect(debug.prompt).toContain('Test role prompt');
    expect(debug.prompt).toContain('dispatch send');
    await expect.poll(() => page.evaluate(() => window.army.output('smoke-reviewer-1')), { timeout: 15000 }).toContain('first task');
    await page.getByLabel('Message', { exact: true }).fill('hello');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Received: hello', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
