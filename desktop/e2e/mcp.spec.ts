import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('independent tool choices persist per template', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-mcp-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('searcher');
  await page.getByLabel('Enable DDGS').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.existsSync(path.join(workspace, '.dispatch', 'agents', 'searcher.md'))).toBe(true);
  await expect(page.getByLabel('Enable DDGS')).toBeChecked();
  await expect(page.getByLabel('Enable RustXNG')).not.toBeChecked();
  const items = (await page.evaluate(() => window.army.templates.list())).items;
  expect(items.find((t: any) => t.name === 'searcher').extra.dispatch_mcp).toBe('ddgs');
  expect(items.find((t: any) => t.extra?.role === 'boss').extra.dispatch_mcp).toBeUndefined();
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
