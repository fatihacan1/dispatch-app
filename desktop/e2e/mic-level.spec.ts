import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('microphone test shows live level and hears audio', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-mic-level-'));
  const shot = 'D:\\Fatih\\Kodlar\\Dispatch\\.dispatch\\outputs\\boss\\shots\\mic-level.png';
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  const app = await electron.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      path.resolve('electron/main.cjs'),
      '--demo',
    ],
    cwd: workspace,
    env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop microphone test' })).toBeVisible();
    await expect(page.getByText('We hear you')).toBeVisible({ timeout: 6000 });
    await page.screenshot({ path: shot });
    await page.getByRole('button', { name: 'Stop microphone test' }).click();
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
