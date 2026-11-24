import { test, expect, _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const bin = path.resolve('resources/bin', process.platform === 'win32' ? 'dispatch.exe' : 'dispatch');

function sendStdin(workspace: string, args: string[], input: string) {
  return new Promise<{ ok: boolean; out: string }>(resolve => {
    const child = execFile(
      bin,
      args,
      { cwd: workspace, env: { ...process.env, DISPATCH_HOME: path.join(workspace, '.dispatch') } },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout + stderr).trim() }),
    );
    child.stdin!.end(input);
  });
}

test('boss markdown renders nested lists, file links, quote, and code fence', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-chat-format-'));
  const app = await electron.launch({
    args: [path.resolve('electron/main.cjs'), '--demo'],
    cwd: workspace,
    env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await expect(page.locator('button.agent').filter({ hasText: /boss/i })).toBeVisible();

    const md = [
      '## Review notes',
      '',
      '1. **[studio-taste/](file:///D:/Fatih/Kodlar/dispatch-studio/studio-taste) layout pass**',
      '- Tighten vertical rhythm',
      '- Keep card padding even',
      '2. **[studio-taste/](file:///D:/Fatih/Kodlar/dispatch-studio/studio-taste) motion pass**',
      '- Use 30 fps cap when focused',
      '- Pause when window is hidden',
      '- Clamp delta time to 0.1s',
      '3. **[studio-taste/](file:///D:/Fatih/Kodlar/dispatch-studio/studio-taste) polish pass**',
      '- Verify file link buttons',
      '- Check code block contrast',
      '',
      '> Keep the diff minimal and easy to review.',
      '',
      '```ts',
      'const fps = 30;',
      '```',
    ].join('\n');

    const res = await sendStdin(workspace, ['send', '--from', 'boss', '--to', 'you', '--stdin'], md);
    expect(res.ok, res.out).toBe(true);

    const ol = page.locator('.message-list ol');
    await expect(ol).toHaveCount(1, { timeout: 15000 });
    await expect(ol.locator('> li')).toHaveCount(3);
    await expect(ol.locator('> li > ul')).toHaveCount(3);
    await expect(page.locator('.message-list .md-file').first()).toBeVisible();

    const shotsDir = path.resolve('..', '.dispatch', 'outputs', 'boss', 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    // A long reply takes the full bubble width (860 px, or all there is).
    await sendStdin(workspace, ['send', '--from', 'boss', '--to', 'you', '--stdin'], 'A long sentence that has to wrap over several lines. '.repeat(12));
    await expect(page.locator('.msg-bubble').last()).toContainText('long sentence');
    const [bubble, room] = await page.locator('.msg-bubble').last().evaluate(b => [b.getBoundingClientRect().width, b.parentElement!.getBoundingClientRect().width]);
    console.log('bubble', Math.round(bubble), 'of', Math.round(room));
    expect(bubble).toBeGreaterThan(Math.min(860, room - 140) - 2);
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Hide office' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shotsDir, 'chat-format.png') });
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
