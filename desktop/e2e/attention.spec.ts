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
  await expect(page.getByText('3 agents need you')).toBeVisible();
  await expect(page.getByText(/coder . approve command/)).toBeVisible();
  await expect(page.getByText(/· sign in/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Providers', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
  await page.getByRole('button', { name: 'Open coder terminal' }).click();
  await page.getByRole('button', { name: 'Open coder terminal' }).click();
  await expect(page.getByRole('tab',{name:'Terminal', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => window.army.send('coder', 'queued attention test'));
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.army.output('coder'))).not.toContain('queued attention test');
  await page.evaluate(() => window.army.input('coder', '\r'));
  await expect(page.getByText(/coder . approve command/)).toHaveCount(0);
  await expect(page.getByText('2 agents need you')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.army.output('coder')), { timeout: 10000 }).toContain('queued attention test');
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

