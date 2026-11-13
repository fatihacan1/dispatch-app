import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('project tabs: a background project keeps its agents running', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tabs-a-'));
 const second = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tabs-b-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
 try {
  const page = await app.firstWindow();
  await expect(page.locator('.ptab')).toHaveCount(1, { timeout: 20000 });
  await page.getByRole('button', { name: 'Start operation' }).click();
  await expect(page.locator('button.agent').filter({ hasText: /scout/i })).toBeVisible();
  // Open the second project in a new tab.
  const opened = app.waitForEvent('window');
  await page.evaluate(f => (window as any).army.tabs.open(f), second);
  const page2 = await opened;
  await expect(page2.locator('.ptab')).toHaveCount(2);
  await expect(page2.locator('.ptab.active .ptab-name')).toHaveText(path.basename(second));
  // The first project's agents are still running in the background.
  await expect.poll(async () => (await page2.evaluate(() => (window as any).army.tabs.list())).tabs[0].running).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.army.output('boss'))).toContain('DISPATCH / DEMO AGENT: boss');
  // Each tab's calls go to its own project.
  expect((await page2.evaluate(() => window.army.info())).workspace).toBe(second);
  expect((await page.evaluate(() => window.army.info())).workspace).toBe(workspace);
  // The same folder twice only switches to its tab; a sixth tab is refused.
  await page2.evaluate(f => (window as any).army.tabs.open(f), workspace);
  await expect(page2.locator('.ptab.active .ptab-name')).toHaveText(path.basename(workspace));
  await expect(page2.locator('.ptab')).toHaveCount(2);
  // Closing the second tab leaves the first one running.
  const list = await page.evaluate(() => (window as any).army.tabs.list());
  await page.evaluate(id => (window as any).army.tabs.close(id), list.tabs[1].id);
  await expect(page.locator('.ptab')).toHaveCount(1, { timeout: 20000 });
  expect((await page.evaluate(() => (window as any).army.tabs.list())).tabs[0].running).toBeGreaterThan(0);
 } finally { await app.close(); for (const d of [workspace, second]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
