import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('switching an agent model persists in the operation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-model-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await expect(page.getByLabel('Agent model')).toBeVisible();
    await page.evaluate(() => (window as any).army.setModel('boss', 'sonnet'));
    const dir = path.join(workspace, '.dispatch', 'operations');
    const file = path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.json'))!);
    const boss = JSON.parse(fs.readFileSync(file, 'utf8')).agents.find((a: any) => a.name === 'boss');
    expect(boss.model).toBe('sonnet');
    expect(boss.template.model).toBe('sonnet');
  } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
