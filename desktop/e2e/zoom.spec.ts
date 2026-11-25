import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Ctrl + / Ctrl - / Ctrl 0 size the whole window, and the size is still there on the next start.
test('zoom with the keyboard and in Settings, kept after a restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-zoom-'));
  for (const d of [root, path.join(root, '.dispatch')]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'ui.json'), JSON.stringify({ hintSeen: true, theme: 'dark', themeColors: {} })); }
  const start = () => electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: root, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root, DISPATCH_TEST_HIDDEN: '1', VITE_DEV_SERVER_URL: '' } });
  const factor = (app: any) => app.evaluate(({ webContents }: any) => webContents.getAllWebContents().filter((w: any) => /index\.html/.test(w.getURL())).map((w: any) => Math.round(w.getZoomFactor() * 100))[0]);
  // Key events on the main process side: Playwright's own keyboard goes straight to the page.
  const key = (app: any, keyCode: string, modifiers: string[]) => app.evaluate(({ webContents }: any, a: any) => { const w = webContents.getAllWebContents().find((x: any) => /index\.html/.test(x.getURL())); w.sendInputEvent({ type: 'keyDown', ...a }); w.sendInputEvent({ type: 'keyUp', ...a }); }, { keyCode, modifiers });
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  let app = await start();
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    const wide = await page.evaluate(() => innerWidth);
    await key(app, '=', [mod]); await expect.poll(() => factor(app)).toBe(110);
    await key(app, '=', [mod]); await expect.poll(() => factor(app)).toBe(120);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(wide);
    await key(app, '-', [mod]); await expect.poll(() => factor(app)).toBe(110);
    await key(app, '0', [mod]); await expect.poll(() => factor(app)).toBe(100);
    // Without the modifier, or with AltGr, nothing happens.
    await key(app, '=', []); await key(app, '=', [mod, 'alt']); await page.waitForTimeout(300); expect(await factor(app)).toBe(100);
    await page.getByRole('button', { name: 'Settings' }).first().click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.locator('.zoom-set output')).toHaveText('130%');
    await page.locator('.zoom-set').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join('test-results', 'zoom-130.png') });
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.topbar')!).paddingRight));
    if (process.platform !== 'darwin') expect(Math.round(pad * 1.3)).toBe(150);
  } finally { await app.close(); }
  app = await start();
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).waitFor();
    await expect.poll(() => factor(app)).toBe(130);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--zoom'))).toBe('1.3');
  } finally { await app.close(); }
});
