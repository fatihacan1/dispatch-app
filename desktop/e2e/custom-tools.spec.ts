import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// A tool added by hand in Tools: its command runs in a terminal of its own, a question it asks (here a fake
// sign-in) is answered in that terminal, agents get the note and the log path, and "Start with Dispatch" works.
test('custom tools: add, start, answer in its terminal, agents are told, starts with Dispatch', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ctool-'));
  const toolDir = path.join(home, 'my api'); fs.mkdirSync(toolDir);
  fs.writeFileSync(path.join(toolDir, 'server.js'), `process.stdout.write('Sign in first? (y/n) ');
process.stdin.once('data', d => { console.log(String(d).trim() === 'y' ? 'SIGNED-IN, API ready on 3210' : 'skipped'); setInterval(() => {}, 1000); });`);
  const env = { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, DISPATCH_TEST_HIDDEN: '1', DISPATCH_TEST_TOOLS: '1' };
  let app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: home, env });
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Extensions' }).first().click();
    await page.getByRole('button', { name: 'Add a tool' }).click();
    const form = page.locator('.custom-tool-form');
    await expect(page.locator('.local-form-collapse')).toHaveClass(/open/);
    await form.getByLabel('Tool name').fill('Image API');
    await form.getByLabel('Command to run').fill(`node "${path.join(toolDir, 'server.js')}"`);
    await form.getByLabel('Note for the agents').fill('Image API at http://127.0.0.1:3210, read /help first.');
    await form.getByLabel('Start with Dispatch').check();
    await page.screenshot({ path: 'e2e/screens/custom-tool-form.png' });
    await form.getByRole('button', { name: 'Save and start' }).click();
    const row = page.locator('.custom-tool-row[data-tool="image-api"]');
    await expect(row.getByText('Running')).toBeVisible();
    // Its terminal opens below; the question is answered there.
    const term = page.locator('.prov-task .xterm');
    await expect(page.locator('.prov-task-head')).toContainText('Image API · terminal');
    await expect.poll(() => page.evaluate(() => window.army.output('ctool-image-api'))).toContain('Sign in first?');
    await term.click(); await page.keyboard.type('y'); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.army.output('ctool-image-api'))).toContain('SIGNED-IN, API ready');
    await expect.poll(() => fs.readFileSync(path.join(home, '.dispatch', 'tools', 'image-api.log'), 'utf8')).toContain('SIGNED-IN, API ready on 3210');
    await page.screenshot({ path: 'e2e/screens/custom-tool-running.png' });
    // Agents started now are told about it.
    await page.getByRole('button', { name: 'Home' }).first().click().catch(() => {});
    await page.evaluate(() => window.army.start({ name: 'boss', provider: 'claude', model: '', body: '', extra: { role: 'boss' } }));
    const prompt = (await page.evaluate(() => (window as any).army.debugAgent('boss'))).prompt as string;
    expect(prompt).toContain('Image API (Dispatch runs it for the user; its terminal output is in');
    expect(prompt).toContain('image-api.log');
    expect(prompt).toContain('read /help first');
    // Edit keeps the id; Stop ends it.
    await page.getByRole('button', { name: 'Extensions' }).first().click();
    await row.getByRole('button', { name: 'Stop' }).click();
    await expect(row.getByText('Stopped')).toBeVisible();
    await app.close();
    // Start with Dispatch: it is running again after a restart.
    app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: home, env });
    page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => window.army.customTools.list().then(l => l[0]?.running)), { timeout: 20000 }).toBe(true);
    await page.getByRole('button', { name: 'Extensions' }).first().click();
    await page.locator('.custom-tool-row').getByRole('button', { name: 'Remove Image API' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('.custom-tool-row')).toHaveCount(0);
  } finally { await app.close().catch(() => {}); fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
