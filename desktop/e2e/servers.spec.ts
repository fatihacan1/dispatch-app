import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

test('add a server, see it in the rail, approve an agent command', async () => {
  test.setTimeout(90_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-servers-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs')], cwd: home, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, VITE_DEV_SERVER_URL: '' } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Servers', exact: true }).click();
    await page.getByRole('button', { name: 'Add server' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Name').fill('Box');
    await form.getByLabel('Host').fill('127.0.0.1');
    await form.getByLabel('Port').fill('1');
    await form.getByLabel('User').fill('me');
    await form.getByRole('radio', { name: 'Ask me' }).click();
    await page.screenshot({ path: path.join(os.tmpdir(), 'servers-form.png') });
    await form.getByRole('button', { name: 'Add server' }).click();
    await expect(page.getByRole('button', { name: 'Open Box' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Box' })).toBeVisible();

    // The agents' MCP bridge: listing works, a command on an "ask" server waits for the user.
    const url = fs.readFileSync(path.join(home, 'servers-bridge-url'), 'utf8');
    const mcp = spawn(process.execPath, [path.resolve('electron/mcp-servers.cjs')], { env: { ...process.env, DISPATCH_SERVERS_URL: url, DISPATCH_AGENT: 'scout' } });
    let out = ''; mcp.stdout.on('data', d => { out += d; });
    const rpc = (id: number, method: string, params: any) => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    rpc(1, 'tools/call', { name: 'servers_list', arguments: {} });
    await expect.poll(() => out).toContain('Box (me@127.0.0.1:1)');
    rpc(2, 'tools/call', { name: 'server_run', arguments: { server: 'box', command: 'uptime' } });
    const approval = page.getByRole('dialog', { name: 'scout wants to use Box' });
    await expect(approval).toBeVisible();
    await expect(approval.getByText('uptime')).toBeVisible();
    await page.screenshot({ path: path.join(os.tmpdir(), 'servers-approve.png') });
    await approval.getByRole('button', { name: 'Allow' }).click();
    await expect.poll(() => out, { timeout: 20_000 }).toContain('"id":2');
    expect(out).toContain('exit code');
    await expect(page.locator('.server-call')).toHaveCount(1);
    mcp.kill();
    await page.screenshot({ path: path.join(os.tmpdir(), 'servers-page.png') });
  } finally { await app.close(); }
});
