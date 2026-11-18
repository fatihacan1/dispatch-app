import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('attachments reach the agent and template deletion uses an in-app dialog', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-attachments-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment contents') });
  await expect(page.getByText('note.txt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message-list .sent-file').filter({ hasText: 'note.txt' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.army.output('boss')), { timeout: 15000 }).toContain('note.txt');
  await page.locator('input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: fs.readFileSync(path.resolve('public/icon-256.png')) });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message-list .sent-image img[alt="pixel.png"]')).toBeVisible();
  const operations = fs.readdirSync(path.join(workspace, '.dispatch', 'operations'), { withFileTypes: true });
  const dir = path.join(workspace, '.dispatch', 'operations', operations.find(x => x.isDirectory())!.name, 'attachments');
  expect(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('note.txt'))!), 'utf8')).toBe('attachment contents');
  await page.evaluate(() => (window as any).army.templates.save({ name: 'delete-test', scope: 'project', provider: 'claude', model: 'default', body: 'test', description: '' }));
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await page.getByRole('button', { name: /delete-test/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete template?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete template', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete template?' })).toHaveCount(0);
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

test('a project boss template can restart the boss in a new chat', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-boss-template-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  const before = await page.evaluate(() => window.army.chats.list('boss'));
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Project lead');
  await page.getByLabel('Template type').selectOption('boss');
  await page.getByLabel('Role prompt').fill('Project-specific instructions');
  await page.getByRole('button', { name: 'Save and reload boss' }).click();
  await expect(page.getByRole('dialog', { name: 'Save and reload boss?' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and reload', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.army.chats.list('boss'))).length).toBe(before.length + 1);
  const list = await page.evaluate(() => window.army.chats.list('boss'));
  expect(list.some((chat: any) => chat.id === before[0].id)).toBeTruthy();
  expect((await page.evaluate(() => window.army.debugAgent('boss'))).prompt).toContain('Project-specific instructions');
  expect(fs.existsSync(path.join(workspace, '.dispatch', 'agents', 'project-lead.md'))).toBeTruthy();
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

test('template search, collapsed groups, and boss visibility persist', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-visibility-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  const builtIn = page.getByRole('button', { name: /^Built-in/ });
  await expect(builtIn).toHaveAttribute('aria-expanded', 'false');
  await builtIn.click();
  await page.getByRole('button', { name: /boss.*Built-in/i }).first().click();
  await expect(page.getByLabel('Template type')).toBeDisabled();
  const coder = page.getByRole('checkbox', { name: 'Show coder (Built-in) to boss' });
  await expect(coder).toBeChecked();
  await page.getByLabel('Show built-in agents in this list').uncheck();
  await expect(coder).toHaveCount(0);
  await page.getByLabel('Show built-in agents in this list').check();
  await expect(coder).toBeChecked();
  await coder.uncheck();
  await page.getByLabel('Search templates').fill('reviewer');
  await expect(page.getByRole('button', { name: /reviewer/i }).first()).toBeVisible();
  await expect(coder).toBeVisible();
  await page.getByLabel('Search templates').clear();
  await expect(coder).not.toBeChecked();
  const bossTemplate = (await page.evaluate(() => window.army.templates.list())).items.find((t: any) => t.extra?.role === 'boss');
  await page.evaluate((template) => window.army.changeBoss(template), bossTemplate);
  const prompt = (await page.evaluate(() => window.army.debugAgent('boss'))).prompt;
  expect(prompt).not.toContain('coder: Implements assigned tasks');
  expect(prompt).toContain('reviewer:');
  await page.reload();
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await page.getByRole('button', { name: /boss.*Built-in/i }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Show coder (Built-in) to boss' })).not.toBeChecked();
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

test('project boss shadows the default boss in the operation picker', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-project-boss-'));
 fs.mkdirSync(path.join(workspace, '.dispatch', 'agents'), { recursive: true });
 fs.writeFileSync(path.join(workspace, '.dispatch', 'agents', 'boss.md'), '---\nname: boss\nprovider: codex\nmodel: default\nrole: boss\n---\nProject boss prompt');
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  const picker = page.getByLabel('Boss template');
  await expect(picker.locator('option', { hasText: 'boss · Project' })).toHaveCount(1, { timeout: 20000 });
  await expect(picker.locator('option', { hasText: 'boss (Default)' })).toHaveCount(0);
  await expect(picker.locator('option:checked')).toHaveText('boss · Project');
  await page.getByRole('button', { name: 'Start operation' }).click();
  expect((await page.evaluate(() => window.army.debugAgent('boss'))).prompt).toContain('Project boss prompt');
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});

test('boss provider plans and notes reach its instructions', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-boss-providers-'));
 const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
 try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Start operation' }).click();
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await page.getByRole('button', { name: /boss.*Built-in/i }).first().click();
  await page.getByText('Providers available to boss').click();
  await page.getByLabel('OpenCode plan').selectOption('free');
  await page.getByLabel('OpenCode note').fill('Prefer for small tasks');
  await page.getByLabel('OpenCode note').blur();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(workspace, '.dispatch', 'boss-providers.json'), 'utf8')).opencode.note).toBe('Prefer for small tasks');
  const boss = (await page.evaluate(() => window.army.templates.list())).items.find((t: any) => t.extra?.role === 'boss');
  await page.evaluate(template => window.army.changeBoss(template), boss);
  const prompt = (await page.evaluate(() => window.army.debugAgent('boss'))).prompt;
  expect(prompt).toContain('OpenCode (opencode) · free · Prefer for small tasks');
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
