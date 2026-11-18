import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// The MCP page lists the catalogue by group, filters it, and shows an empty Connected tab with a way back.
test('MCP page: browse, search and the connected tab', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-mcp-page-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: root, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Work and docs' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Connect Notion' })).toBeVisible();
    await page.getByLabel('Search apps').fill('stripe');
    await expect(page.getByRole('button', { name: 'Connect Stripe' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Notion' })).toHaveCount(0);
    await page.getByRole('tab', { name: /Connected/ }).click();
    await expect(page.getByText('Nothing connected yet')).toBeVisible();
    await page.getByRole('button', { name: 'Browse apps' }).click();
    await expect(page.getByLabel('Search apps')).toBeVisible();
  } finally { await app.close(); }
});
