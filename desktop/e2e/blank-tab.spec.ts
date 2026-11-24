import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('a new tab opens without choosing a folder', async () => {
 const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-blank-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: home, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home } });
 try {
  const page = await app.firstWindow();
  await expect(page.locator('.ptab')).toHaveCount(1, { timeout: 20000 });
  const add = async (from: typeof page) => { const opened = app.waitForEvent('window'); await from.getByRole('button', { name: 'Open a project in a new tab' }).click(); await from.getByRole('menuitem', { name: 'New tab without a folder' }).click(); return opened; };
  const second = await add(page);
  await expect(second.locator('.ptab.active .ptab-name')).toHaveText('Chat 1', { timeout: 20000 });
  expect((await second.evaluate(() => window.army.info())).workspace).toBe(path.join(home, 'Dispatch Chats', 'Chat 1'));
  await second.getByRole('button', { name: 'Start operation' }).click();
  await expect(second.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await second.screenshot({ path: path.resolve('..', '.dispatch', 'outputs', 'boss', 'shots', 'blank-tab.png') });
  // Another one gets its own folder; closed unused, its folder is taken again.
  const third = await add(second);
  await expect(third.locator('.ptab.active .ptab-name')).toHaveText('Chat 2', { timeout: 20000 });
  const tabs = (await second.evaluate(() => (window as any).army.tabs.list())).tabs;
  await second.evaluate(id => (window as any).army.tabs.close(id), tabs[2].id);
  await expect(second.locator('.ptab')).toHaveCount(2);
  const again = await add(second);
  await expect(again.locator('.ptab.active .ptab-name')).toHaveText('Chat 2', { timeout: 20000 });
 } finally { await app.close(); fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
