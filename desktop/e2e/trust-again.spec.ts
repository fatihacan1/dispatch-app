import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
// "Not now" on one agent's trust prompt must not hide the dialog for an agent that starts waiting later.
test('trust dialog comes back for an agent that asks after Not now', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-trust-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, DISPATCH_DEMO_ATTENTION: 'trust-late', VITE_DEV_SERVER_URL: '' } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Trust this folder?' });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('boss is waiting.')).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(dialog).toHaveCount(0);
    // The boss still waits; the coder now asks too: the dialog is back and names both.
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText(/coder/)).toBeVisible();
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true }); }
});
