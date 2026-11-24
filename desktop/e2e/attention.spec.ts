import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('simultaneous prompts open the right terminals and hold messages', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-attention-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, DISPATCH_DEMO_ATTENTION: '1', VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  await expect(page.getByRole('dialog', { name: 'Trust this folder?' })).toBeVisible();
  await expect(page.getByText('boss is waiting.')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog', { name: 'Trust this folder?' })).toHaveCount(0);
  await expect(page.getByText('3 need you', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^coder .*approve command/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in$/ }).first()).toBeVisible();
  // The menu in its terminal is a card in its chat, with the same choices.
  await page.getByRole('button', { name: /^coder .*approve command/ }).click();
  const card = page.locator('.question-card');
  await expect(card.getByRole('button', { name: 'Yes' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'No' })).toBeVisible();
  await page.screenshot({ path: 'test-results/menu-card.png' });
  await page.evaluate(() => window.army.send('coder', 'queued attention test'));
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.army.output('coder'))).not.toContain('queued attention test');
  await card.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByRole('button', { name: /^coder .*approve command/ })).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.getByText('2 need you', { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.army.output('coder')), { timeout: 10000 }).toContain('queued attention test');
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

