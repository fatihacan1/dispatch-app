import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('stop, restart and dismiss persist in the operation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-lifecycle-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await page.getByRole('button', { name: 'Actions for coder' }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: /coder.*stopped/i }).first()).toBeVisible();
    const file = path.join(workspace, '.dispatch', 'operations', fs.readdirSync(path.join(workspace, '.dispatch', 'operations')).find(f => f.endsWith('.json'))!);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).agents.find((a: any) => a.name === 'coder').stopped).toBe(true);
    await page.getByRole('button', { name: 'Actions for coder' }).click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).agents.find((a: any) => a.name === 'coder').stopped).toBe(false);
    await page.getByRole('button', { name: 'Actions for coder' }).click();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.getByRole('dialog', { name: 'Dismiss coder?' }).getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Actions for coder' })).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).agents.some((a: any) => a.name === 'coder')).toBe(false);
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
