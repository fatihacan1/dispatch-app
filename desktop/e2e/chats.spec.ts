import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('new chat clears the whole team: same agents, empty chats, old conversation kept as an operation', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-chats-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: root, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  const send = async (text: string) => { await page.getByLabel('Message', { exact: true }).fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click(); };
  await send('boss original');
  await expect(page.getByText('Received: boss original', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => window.army.send('coder', 'coder original'));
  await expect.poll(() => page.evaluate(() => window.army.output('coder')), { timeout: 15000 }).toContain('coder original');
  const coderBefore = await page.evaluate(() => window.army.chats.list('coder'));
  const bossBefore = await page.evaluate(() => window.army.chats.list('boss'));
  const opDir = path.join(root, '.dispatch', 'operations');
  const firstOperation = fs.readdirSync(opDir).find(f => f.endsWith('.json'))!.replace(/\.json$/, '');

  // One confirm, no choices: the team stays, every chat starts empty.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('All 3 agents stay on the team');
  await page.getByRole('dialog').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('.message-list').getByText('boss original', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^coder · / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^scout · / })).toBeVisible();

  for (const [name, before] of [['boss', bossBefore], ['coder', coderBefore]] as const) {
   const now = await page.evaluate(n => window.army.chats.list(n), name);
   expect(now).toHaveLength(1);
   expect(now[0].id).not.toBe(before[0].id);
   expect(now[0].messages).toHaveLength(0);
  }
  // Fresh terminals: nothing of the old task is left in them, and the boss still knows its team.
  expect(await page.evaluate(() => window.army.output('coder'))).not.toContain('coder original');
  const boss = await page.evaluate(() => (window.army as any).debugAgent('boss'));
  expect(boss.prompt).toContain('coder (');
  expect(boss.prompt).toContain('scout (');
  // The agents answer again after the reset.
  await send('boss again');
  await expect(page.getByText('Received: boss again', { exact: true }).first()).toBeVisible({ timeout: 15000 });

  // The old conversation is a separate, resumable operation.
  const operations = await page.evaluate(() => window.army.operations.list());
  expect(operations).toHaveLength(2);
  const resumed = await page.evaluate(id => window.army.operations.resume(id), firstOperation);
  expect(resumed.messages.some((m: any) => m.text === 'coder original')).toBe(true);
  expect(resumed.messages.some((m: any) => m.text === 'boss again')).toBe(false);
 } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
