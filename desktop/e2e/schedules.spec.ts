import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const bin = path.resolve('resources/bin', process.platform === 'win32' ? 'dispatch.exe' : 'dispatch');
const cli = (workspace: string, agent: string, args: string[]) => new Promise<{ ok: boolean; out: string }>(resolve =>
  execFile(bin, args, { cwd: workspace, env: { ...process.env, DISPATCH_AGENT: agent, DISPATCH_HOME: path.join(workspace, '.dispatch') } }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout + stderr).trim() })));

test('schedules: boss sets one, plain agents cannot, the title bar shows it; agent files reach Outputs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-sched-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-schedhome-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();

    const denied = await cli(workspace, 'writer', ['schedule', 'list']);
    expect(denied.ok).toBe(false);
    expect(denied.out).toContain('Only the boss and team leads');

    const added = await cli(workspace, 'boss', ['schedule', 'add', '--title', 'Daily video', '--why', 'The user wants one short video every morning', '--task', 'Make and upload today\'s video', '--every', '1d', '--at', '09:00']);
    expect(added.ok).toBe(true);
    expect(added.out).toContain('Saved schedule');
    const listed = await cli(workspace, 'boss', ['schedule', 'list']);
    expect(listed.out).toContain('every day at 09:00');

    const trigger = page.getByRole('button', { name: /1 schedules?/ });
    await expect(trigger).toBeVisible();
    await trigger.hover();
    await expect(page.getByText('The user wants one short video every morning')).toBeVisible();
    await expect(page.getByText(/every day at 09:00 · next/)).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/schedules-card.png' });
    await page.getByRole('button', { name: 'Pause Daily video' }).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(workspace, '.dispatch', 'schedules.json'), 'utf8'))[0].status).toBe('paused');

    // Shared outputs gallery: a file an agent saves under .dispatch/outputs/<agent>/ is logged for the UI.
    const out = path.join(workspace, '.dispatch', 'outputs', 'editor', 'cut.txt');
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, 'final cut');
    await expect.poll(() => { try { return fs.readFileSync(path.join(workspace, '.dispatch', 'outputs.jsonl'), 'utf8'); } catch { return ''; } }, { timeout: 15000 }).toContain('"agent":"editor"');
    const gallery = await cli(workspace, 'writer', ['outputs']);
    expect(gallery.out).toContain('cut.txt');
  } finally {
    await app.close();
    for (const d of [workspace, home]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
