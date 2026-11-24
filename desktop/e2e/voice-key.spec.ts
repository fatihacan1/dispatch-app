import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('voice shortcut recorder sets, cancels with Escape, and resets', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-voice-key-'));
  const app = await electron.launch({
    args: [path.resolve('electron/main.cjs'), '--demo'],
    cwd: workspace,
    env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    const btn = page.getByRole('button', { name: 'Voice shortcut' });
    await expect(btn).toBeVisible();

    await btn.click();
    await page.keyboard.press('F8');
    await expect(btn).toHaveText('F8');
    await expect.poll(async () => (await page.evaluate(() => (window as any).army.voice.status())).shortcut).toBe('F8');

    await btn.click();
    await page.keyboard.press('Control+Shift+K');
    await expect(btn).toHaveText('Ctrl + Shift + K');

    await btn.click();
    await page.keyboard.press('Escape');
    await expect(btn).toHaveText('Ctrl + Shift + K');

    await page.locator('.voice-mic').getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(btn).toHaveText('Ctrl + Alt + Space');
    await expect.poll(async () => (await page.evaluate(() => (window as any).army.voice.status())).shortcut).toBe('Control+Alt+Space');
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
