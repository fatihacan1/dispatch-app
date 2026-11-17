import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Frosted Glass defines its surfaces as rgba(); Monaco only reads hex. Opening the editor on that theme used to throw
// "Illegal value for token color" and unmount the whole app (blank window after resuming an operation).
test('editor opens on the Frosted Glass theme without blanking the app', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-frosted-'));
 const ui = JSON.stringify({ hintSeen: true, ideOpen: true, ideEditorOnFile: true, theme: 'frosted', themeColors: {} });
 for (const d of [root, path.join(root, '.dispatch')]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'ui.json'), ui); }
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: root, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root } });
 const errors: string[] = [];
 try {
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Start operation' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'frosted');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(3000);
  expect(errors).toEqual([]);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
 } finally { await app.close(); }
});
