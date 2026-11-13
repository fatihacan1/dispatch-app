import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('memory: settings, entries, boss index and activity', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-memory-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-memhome-'));
  // An entry the boss wrote earlier, plus its activity line.
  const project = path.join(workspace, '.dispatch', 'memory'); fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'project.jsonl'), JSON.stringify({ type: 'entity', name: 'build-system', entityType: 'decision', observations: ['Use pnpm for every install', 'npm broke the lockfile'], summary: 'pnpm workspaces, not npm', updatedAt: '2026-11-10T10:00:00.000Z' }) + '\n');
  fs.writeFileSync(path.join(workspace, '.dispatch', 'memory-log.jsonl'), JSON.stringify({ t: '2026-11-10T10:00:00.000Z', by: 'boss', tool: 'memory_search', scope: 'all', detail: 'pnpm', ok: true, tokens: 42, results: 1 }) + '\n');
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Only the boss uses memory.')).toBeVisible();
    await expect(page.getByText(/1 project and 0 global entries/)).toBeVisible();
    await page.getByText('Only the boss uses memory.').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screens/memory-settings.png' });
    await page.getByRole('button', { name: 'Open memory' }).click();

    await page.getByRole('button', { name: /build-system/ }).click();
    await expect(page.getByLabel(/^Facts/)).toHaveValue('Use pnpm for every install\nnpm broke the lockfile');
    await page.getByLabel(/^Facts/).fill('Use pnpm for every install\nCI runs pnpm -r test');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => fs.readFileSync(path.join(project, 'project.jsonl'), 'utf8')).toContain('CI runs pnpm -r test');

    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByLabel('Name').fill('release');
    await page.getByLabel('Type').fill('convention');
    await page.getByLabel(/^Summary/).fill('Tags trigger releases');
    await page.getByLabel(/^Facts/).fill('Push a v* tag to release');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('button', { name: /release/ })).toBeVisible();
    await page.getByLabel('Relation', { exact: true }).fill('used by');
    await page.getByLabel('Related entry').selectOption('build-system');
    await page.getByRole('button', { name: 'Link' }).click();
    await expect(page.getByText('used by')).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/memory-entries.png' });

    await page.getByRole('tab', { name: 'Boss index' }).click();
    await expect(page.locator('.mem-index')).toContainText('build-system [decision]: pnpm workspaces, not npm');
    await expect(page.locator('.mem-index')).not.toContainText('CI runs pnpm');
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('cell', { name: 'Searched' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '~42 tokens' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Created' })).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/memory-activity.png' });

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Project memory').uncheck();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(workspace, '.dispatch', 'memory-project.json'), 'utf8')).projectEnabled).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
