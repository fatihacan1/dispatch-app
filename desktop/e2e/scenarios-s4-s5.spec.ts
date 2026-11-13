import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('demo agents coordinate, wait for a reply, and build the team', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-scenarios-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  const send = async (text: string) => { await page.getByLabel('Message', { exact: true }).fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click(); };
  await send('coder implement X');
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(page.getByText('Done: coder implement X', { exact: false }).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'BOSS ↔ CODER' }).click();
  const memos = page.locator('.conversation .memo');
  await expect(memos).toHaveCount(2);
  await expect(memos.nth(0)).toContainText('to coder');
  await expect(memos.nth(1)).toContainText('to boss');
  await page.getByRole('button', { name: /^boss · / }).click();
  await send('ask scout status');
  await expect.poll(async () => page.evaluate(() => window.army.output('boss')), { timeout: 15000 }).toContain('Done: ask scout status');
  await send('spawn a coder for token refresh');
  await expect(page.getByRole('button', { name: /coder-1/ }).first()).toContainText('by boss', { timeout: 15000 });
  await expect.poll(async () => page.evaluate(() => window.army.output('coder-1')), { timeout: 15000 }).toContain('spawn a coder for token refresh');
  await send('create template for specialist');
  await expect(page.getByRole('button', { name: /specialist-1/ }).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Agent templates', exact: true }).click();
  await expect(page.getByText('demo-specialist', { exact: true }).first()).toBeVisible({ timeout: 15000 });
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

