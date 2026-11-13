import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('Turkish interface language from Settings', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-i18n-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await page.evaluate(() => localStorage.setItem('dispatch.lang', 'tr')); await page.reload();
  await expect(page.getByRole('button', { name: 'Ayarlar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ayarlar', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(os.tmpdir(), 'dispatch-tr.png') });
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
