import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('office visibility persists across relaunch', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-office-remember-'));
  const launch = () =>
    electron.launch({
      args: [path.resolve('electron/main.cjs'), '--demo'],
      cwd: workspace,
      env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' },
    });

  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await expect(page.locator('.office-wrap')).toBeVisible();

    // A 3D scene loads on a click only, and goes away with the page.
    await page.waitForTimeout(1500);
    await expect(page.locator('.office canvas')).toHaveCount(0);
    await page.screenshot({ path: path.resolve('..', '.dispatch', 'outputs', 'boss', 'shots', 'scene-closed.png') });
    await page.getByRole('button', { name: /Click to load the scene/ }).click();
    await expect(page.locator('.office canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.locator('.office canvas')).toHaveCount(0);
    await page.locator('.rail-item').filter({ hasText: 'Chat' }).click();
    await expect(page.getByRole('button', { name: /Click to load the scene/ })).toBeVisible();

    await page.getByRole('button', { name: 'Hide office', exact: true }).click();
    await expect(page.locator('.office-wrap')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show office', exact: true })).toBeVisible();

    await app.close();
    app = await launch();
    page = await app.firstWindow();

    await expect(page.getByRole('button', { name: 'Show office', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.office-wrap')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show office', exact: true }).click();
    await expect(page.locator('.office-wrap')).toBeVisible();

    await app.close();
    app = await launch();
    page = await app.firstWindow();

    await expect(page.locator('.office-wrap')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Hide office', exact: true })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
