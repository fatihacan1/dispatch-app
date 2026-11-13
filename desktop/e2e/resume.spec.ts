import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('operations survive restart and workspaces switch independently', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-resume-'));
 const first = path.join(root, 'first'); const second = path.join(root, 'second');
 fs.mkdirSync(first); fs.mkdirSync(second);
 const launch = () => electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: first, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root } });
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
  await expect(page.getByText('Received: resume history', { exact: true }).first()).toBeVisible();
  const debug = await page.evaluate(() => (window.army as any).debugAgent('boss'));
  expect(debug.args).toContain('--resume'); expect(debug.args).toContain(saved.agents[0].sessionId);
  await app.evaluate(({ dialog }, target) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, second);
  await page.getByTitle(/Switch workspace/).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await page.getByRole('dialog', { name: 'Switch workspace?' }).getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByText('No operations yet.')).toBeVisible();
  await app.close(); app = await launch(); page = await app.firstWindow();
  await expect(page.getByTitle(`Switch workspace (${second})`)).toBeVisible();
  await page.getByTitle(`Switch workspace (${second})`).click();
  await expect(page.getByRole('button', { name: first, exact: true })).toBeVisible();
  await page.getByRole('button', { name: first, exact: true }).click();
  await expect(page.locator('.team')).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByTitle('Resume this operation')).toBeVisible();
  await page.getByRole('button', { name: 'Delete operation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this operation?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No operations yet.')).toBeVisible();
  expect(fs.existsSync(path.join(opDir, file))).toBe(false);
 } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

