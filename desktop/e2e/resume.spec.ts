import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('operations survive restart and project tabs run side by side', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-resume-'));
 const first = path.join(root, 'first'); const second = path.join(root, 'second');
 fs.mkdirSync(first); fs.mkdirSync(second);
 const launch = () => electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: first, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root, DISPATCH_TEST_TABS: '1' } });
 let app = await launch();
 try {
  let page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  await page.getByLabel('Message', { exact: true }).fill('resume history');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Received: resume history', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  const opDir = path.join(first, '.dispatch', 'operations');
  const file = fs.readdirSync(opDir).find(f => f.endsWith('.json'))!;
  const saved = JSON.parse(fs.readFileSync(path.join(opDir, file), 'utf8'));
  expect(saved.agents.map((a: any) => a.name)).toEqual(['boss', 'scout', 'coder']);
  expect(saved.agents[0].sessionId).toBeTruthy();
  await app.close(); app = await launch(); page = await app.firstWindow();
  // Opening the workspace resumes its latest operation automatically.
  await expect(page.getByText('Received: resume history', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  const debug = await page.evaluate(() => (window.army as any).debugAgent('boss'));
  expect(debug.args).toContain('--resume'); expect(debug.args).toContain(saved.agents[0].sessionId);
  // A second project opens in its own tab; the first keeps its agents running.
  await app.evaluate(({ dialog }, target) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, second);
  let opened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Open a project in a new tab' }).click();
  await page.getByRole('menuitem', { name: 'Open folder…' }).click();
  let page2 = await opened;
  await expect(page2.getByText('No operations yet.')).toBeVisible({ timeout: 20000 });
  expect((await page2.evaluate(() => (window as any).army.tabs.list())).tabs.map((t: any) => t.path)).toEqual([first, second]);
  // Both tabs come back after a restart, each with its own project.
  await app.close(); app = await launch(); page = await app.firstWindow();
  await expect(page.locator('.ptab')).toHaveCount(2, { timeout: 20000 });
  const tabs = (await page.evaluate(() => (window as any).army.tabs.list())).tabs;
  expect(tabs.map((t: any) => t.path)).toEqual([first, second]);
  const firstPage = app.windows().find(w => !w.url().includes('tray')) && await (async () => { for (const w of app.windows()) { try { if ((await w.evaluate(() => window.army.info())).workspace === first) return w; } catch {} } return null; })();
  expect(firstPage).toBeTruthy();
  await page.evaluate(id => (window as any).army.tabs.switch(id), tabs[0].id);
  await expect(firstPage!.locator('.team')).toBeVisible({ timeout: 20000 });
  await firstPage!.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(firstPage!.getByTitle('Resume this operation')).toBeVisible();
  await firstPage!.getByRole('button', { name: 'Delete operation', exact: true }).click();
  await firstPage!.getByRole('dialog', { name: 'Delete this operation?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(firstPage!.getByText('No operations yet.')).toBeVisible();
  expect(fs.existsSync(path.join(opDir, file))).toBe(false);
 } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

