import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Two Dispatch instances on one machine: A shares, B connects and works on A's files.
const launch = (home: string) => electron.launch({ args: [path.resolve('electron/main.cjs')], cwd: home, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, VITE_DEV_SERVER_URL: '' } });

test('connect to another Dispatch, pick its folders, survive it going away', async () => {
  test.setTimeout(120_000);
  const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-remote-a-'));
  const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-remote-b-'));
  fs.writeFileSync(path.join(homeA, 'hello-from-a.txt'), 'hi');
  fs.mkdirSync(path.join(homeA, 'project-on-a'));
  const a = await launch(homeA);
  let b = await launch(homeB);
  try {
    const pa = await a.firstWindow();
    await pa.waitForFunction(() => !!(window as any).army);
    const st = await pa.evaluate(() => (window as any).army.remote.share(true));
    expect(st.link).toMatch(/^dispatch:\/\//);
    const link = st.link.replace(/dispatch:\/\/[^:]+:/, 'dispatch://127.0.0.1:');

    let pb = await b.firstWindow();
    await pb.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await pb.getByLabel('Link').fill(link);
    await pb.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(pb.getByRole('button', { name: /^Connected to / })).toBeVisible({ timeout: 15_000 });
    const files = await pb.evaluate(() => (window as any).army.files.list(''));
    expect(JSON.stringify(files)).toContain('hello-from-a.txt');

    // Opening a folder on B shows A's disk.
    const chosen = pb.evaluate(() => (window as any).army.workspace());
    const picker = pb.getByRole('dialog');
    await expect(picker.getByText('project-on-a')).toBeVisible();
    await picker.getByRole('option', { name: 'project-on-a' }).click();
    await picker.getByRole('button', { name: 'Open project-on-a' }).click();
    expect(path.resolve(await chosen)).toBe(path.resolve(homeA, 'project-on-a'));
    await pb.screenshot({ path: path.join(os.tmpdir(), 'remote-connected.png') });

    // A goes away: B says so; B restarted while A is off offers retry or local.
    await a.close();
    await expect(pb.getByText(/Lost the connection/)).toBeVisible({ timeout: 15_000 });
    await b.close();
    b = await launch(homeB);
    pb = await b.firstWindow();
    await expect(pb.getByRole('heading', { name: /Could not connect/ })).toBeVisible({ timeout: 20_000 });
    await pb.screenshot({ path: path.join(os.tmpdir(), 'remote-failed.png') });
    await pb.getByRole('button', { name: 'Use this computer' }).click();
    await expect(pb.getByRole('button', { name: 'Settings', exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(await pb.evaluate(() => (window as any).army.remote.state().state)).toBe('local');
  } finally {
    await a.close().catch(() => {});
    await b.close().catch(() => {});
  }
});
