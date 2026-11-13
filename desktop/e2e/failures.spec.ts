import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const bin = path.resolve('resources/bin', process.platform === 'win32' ? 'dispatch.exe' : 'dispatch');
const cli = (workspace: string, agent: string, args: string[]) => new Promise<{ ok: boolean; out: string }>(resolve =>
  execFile(bin, args, { cwd: workspace, env: { ...process.env, DISPATCH_AGENT: agent, DISPATCH_HOME: path.join(workspace, '.dispatch') } }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout + stderr).trim() })));

test('failed commands are removed and an ask to an unknown agent gets an answer instead of hanging', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-fail-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-failhome-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await expect(page.getByRole('button', { name: /boss/ }).first()).toBeVisible();
    const asked = await cli(workspace, 'boss', ['ask', '--wait', '--to', 'nobody', 'hello']);
    expect(asked.out).toContain('does not exist');
    await cli(workspace, 'boss', ['spawn', '--template', 'no-such-template', '--name', 'w2', '--task', 'x']);
    const orch = path.join(workspace, '.dispatch', 'inbox', 'orchestrator');
    await expect.poll(() => fs.existsSync(orch) ? fs.readdirSync(orch).length : 0).toBe(0);
  } finally { await app.close(); }
});

