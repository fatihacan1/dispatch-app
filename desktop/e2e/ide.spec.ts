import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

test('files panel opens, edits, saves, reloads from disk and shows a diff', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ide-'));
 fs.mkdirSync(path.join(workspace, 'src'));
 fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const a = 1;\n');
 fs.writeFileSync(path.join(workspace, 'README.md'), '# hi\n');
 execFileSync('git', ['init', '-q'], { cwd: workspace });
 execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: workspace });
 execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: workspace });
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(page.locator('.workbench.ide-open')).toBeVisible();
  await page.locator('.ide-row', { hasText: 'src' }).click();
  await page.locator('.ide-row', { hasText: 'app.ts' }).click();
  await expect(page.locator('.ide-editor .monaco-editor .view-lines')).toContainText('export const a = 1;');
  await page.locator('.ide-editor .monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// edited');
  await expect(page.locator('.ide-dirty')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ide-dirty')).toHaveCount(0);
  expect(fs.readFileSync(path.join(workspace, 'src', 'app.ts'), 'utf8')).toContain('// edited');
  // An agent changes the file on disk: a clean tab follows.
  fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const a = 2;\n');
  await expect(page.locator('.ide-editor .monaco-editor .view-lines')).toContainText('export const a = 2;', { timeout: 10000 });
  await page.getByRole('button', { name: 'Toggle diff' }).click();
  await expect(page.locator('.ide-diff')).toBeVisible();
  await expect(page.locator('.ide-diff')).toContainText('export const a = 1;');
  await page.screenshot({ path: path.join('test-results', 'ide-panel.png') });
  // Back to the editor: the diff goes away and the editor is usable again.
  await page.getByRole('button', { name: 'Toggle diff' }).click();
  await expect(page.locator('.ide-diff')).toBeHidden();
  await expect(page.locator('.ide-edit .view-lines')).toBeVisible();
  await page.locator('.ide-edit .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// back');
  await expect(page.locator('.ide-edit .view-lines')).toContainText('// back');
  // Terminals tab next to Outputs: agents' CLIs plus a new PowerShell in this folder.
  await page.getByRole('tab', { name: /Terminals/ }).click();
  await expect(page.getByRole('button', { name: 'Open boss terminal' })).toBeVisible();
  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click();
  await expect(page.locator('.term-pane')).toBeVisible();
  // The terminal draws with WebGL, so its text is read from the shell's output instead of the DOM.
  const shellText = () => page.evaluate(async () => { const list = await (window as any).army.shells.list(); return list.length ? (window as any).army.output(list[list.length - 1].name) : ''; });
  await expect.poll(shellText, { timeout: 20000 }).toContain('PS ');
  await page.locator('.term-body .xterm').click();
  await page.keyboard.type('echo dispatch-$((6*7))');
  await page.keyboard.press('Enter');
  await expect.poll(shellText, { timeout: 15000 }).toContain('dispatch-42');
  await expect.poll(shellText).toContain(path.basename(workspace));
  await page.screenshot({ path: path.join('test-results', 'ide-terminal.png') });
  await page.getByRole('button', { name: 'Hide files' }).click();
  await expect(page.locator('.workbench.ide-open')).toHaveCount(0);
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
