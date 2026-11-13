import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('composer shows and delivers a multiline order', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-send-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    const order = 'Check the first item\nand the second item';
    await page.getByLabel('Message', { exact: true }).fill(order);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const message = page.locator('.message').filter({ hasText: order });
    await expect(message).toHaveCount(1);
    await expect(message).toContainText('you');
    await expect.poll(() => page.evaluate(() => window.army.output('boss')), { timeout: 15000 }).toContain('second item');
    await expect(message).toHaveCount(1);
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
