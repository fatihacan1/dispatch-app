import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// The user-reported states of the real CLIs, driven through the real engine with a stand-in CLI (fixtures/fake-cli.cjs).
test.setTimeout(180000);
const only = process.platform !== 'win32';
async function open(kind: 'agy' | 'claude', extra: Record<string, string> = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `dispatch-${kind}-`)), bin = path.join(ws, 'fakebin'), log = path.join(ws, 'fake.log');
  fs.mkdirSync(bin); fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(bin, `${kind}.ps1`), `$env:FAKE_KIND='${kind}'\n$env:FAKE_SESSION=$args[-1]\n& '${process.execPath}' '${path.resolve('e2e/fixtures/fake-cli.cjs')}'\n`);
  // Only the stand-in may be found: the folders of the real CLIs leave the PATH.
  const PATH = [bin, ...(process.env.PATH || '').split(path.delimiter).filter(d => !['agy', 'claude'].some(c => ['.exe', '.cmd', '.ps1'].some(x => fs.existsSync(path.join(d, c + x)))))].join(path.delimiter);
  const env: Record<string, string> = { ...process.env as any, PATH, Path: PATH, HOME: ws, DISPATCH_TEST_HOME: ws, DISPATCH_HOME: ws, VITE_DEV_SERVER_URL: '', FAKE_LOG: log, LOCALAPPDATA: path.join(ws, 'local'), ANTIGRAVITY_APP_DATA_DIR: path.join(ws, '.gemini', 'antigravity-cli'), CLAUDE_CONFIG_DIR: path.join(ws, '.claude'), ...extra };
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs')], cwd: ws, env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as any).army);
  const start = async () => {
    await page.evaluate(p => (window as any).army.start({ name: 'boss', provider: p, model: 'default', body: 'test', extra: { role: 'boss' } }), kind === 'agy' ? 'antigravity' : 'claude');
    await page.reload(); await page.waitForFunction(() => !!document.querySelector('.composer textarea'), null, { timeout: 30000 });
  };
  const said = () => { try { return fs.readFileSync(path.join(ws, '.dispatch', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.from === 'boss' && m.to === 'you').map(m => String(m.text)); } catch { return []; } };
  const fake = () => fs.readFileSync(log, 'utf8');
  const close = async () => { await app.close().catch(() => {}); try { fs.rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 }); } catch {} };
  return { app, page, start, said, fake, close, ws };
}
const working = (page: Page) => page.evaluate(() => (window as any).army.isWorking('boss'));
const attention = (page: Page) => page.evaluate(() => (window as any).army.attention.list().then((a: any) => a.boss || ''));
const type = async (page: Page, text: string) => { await page.getByRole('textbox', { name: 'Message' }).fill(text); await page.keyboard.press('Enter'); };
const shots = path.resolve('..', '.dispatch', 'outputs', 'boss', 'shots');

test('agy: a message waits for a start that hangs, and is not lost or shown as working', async () => {
  test.skip(only);
  const t = await open('agy', { FAKE_LATE: '1' });
  try {
    await t.start();
    await type(t.page, 'CASE-PLAIN');
    await expect(t.page.locator('.trail-title')).toContainText('Starting', { timeout: 8000 });
    expect(await working(t.page)).toBe(false);
    await expect.poll(t.said, { timeout: 60000 }).toContain('PLAIN ANSWER');
    expect(t.fake()).toMatch(/resized after/);
    await expect.poll(() => working(t.page), { timeout: 8000 }).toBe(false);
  } finally { await t.close(); }
});

test('agy: menus are cards in the chat; interim text, stream errors, prose and Stop read right', async () => {
  test.skip(only);
  const t = await open('agy');
  try {
    await t.start();
    // Two menus, one right after the other.
    await type(t.page, 'CASE-MENU');
    const card = t.page.locator('.question-card');
    await expect(card).toContainText('outside workspace', { timeout: 20000 });
    await expect(card).toContainText('Allow access to this file?');
    expect(await attention(t.page)).toBe('Approve command');
    fs.mkdirSync(shots, { recursive: true }); await t.page.waitForTimeout(500); await t.page.screenshot({ path: path.join(shots, 'agy-menu-card.png') });
    await card.getByRole('button', { name: 'No, deny access' }).click();
    await expect(card).toContainText('Allow calling this tool?', { timeout: 15000 });
    await card.getByRole('button', { name: /always allow tool .*long tail of it/ }).click();
    await expect.poll(t.said, { timeout: 20000 }).toContainEqual(expect.stringMatching(/^PICKED No, deny access \+ Yes, and always allow tool/));
    await expect(card).toHaveCount(0);
    expect(await attention(t.page)).toBe('');

    // Says something, goes on working: never "Worked" in between, and the text is not its reply.
    const watch = async (text: string, end: string) => {
      const from = t.said().length; await type(t.page, text);
      await expect.poll(() => working(t.page), { timeout: 15000 }).toBe(true);
      let dips = 0; const until = Date.now() + 30000;
      while (!t.said().slice(from).includes(end) && Date.now() < until) { if (!(await working(t.page)) && !t.said().slice(from).includes(end)) dips++; await t.page.waitForTimeout(80); }
      expect(t.said().slice(from)).toEqual([end]); expect(dips).toBe(0);
      await expect.poll(() => working(t.page), { timeout: 8000 }).toBe(false);
    };
    await watch('CASE-INTERIM', 'REAL FINAL');
    await watch('CASE-ERROR', 'RECOVERED');

    // A menu it only writes about is not a menu.
    let alarms = 0; const from = t.said().length; await type(t.page, 'CASE-PROSE');
    const until = Date.now() + 15000; while (!t.said().slice(from).includes('PROSE DONE') && Date.now() < until) { if (await attention(t.page)) alarms++; await t.page.waitForTimeout(100); }
    await t.page.waitForTimeout(1500); if (await attention(t.page)) alarms++;
    expect(t.said().slice(from)).toEqual(['PROSE DONE']); expect(alarms).toBe(0);

    // Stop: whether agy writes the cancelled step or nothing at all.
    for (const c of ['CASE-FOREVER', 'CASE-CANCELLED']) {
      await type(t.page, c);
      await expect(t.page.getByRole('button', { name: 'Stop current task' })).toBeVisible({ timeout: 15000 });
      await t.page.waitForTimeout(2500);
      await t.page.getByRole('button', { name: 'Stop current task' }).click();
      await expect.poll(() => working(t.page), { timeout: 8000 }).toBe(false);
      await t.page.waitForTimeout(2500);
      expect(await working(t.page)).toBe(false);
      await expect(t.page.locator('.trail.is-live')).toHaveCount(0);
      const before = t.said().length; await type(t.page, 'CASE-PLAIN');
      await expect.poll(() => t.said().slice(before), { timeout: 20000 }).toContain('PLAIN ANSWER');
      await expect.poll(() => working(t.page), { timeout: 8000 }).toBe(false);
    }
  } finally { console.log(t.fake()); await t.close(); }
});

test('claude: a lost turn end and its own Bash menu', async () => {
  test.skip(only);
  const t = await open('claude');
  try {
    await t.start();
    const t0 = Date.now(); await type(t.page, 'CASE-LOST-END');
    await expect.poll(() => working(t.page), { timeout: 20000 }).toBe(true);
    await expect.poll(t.said, { timeout: 60000 }).toContain('THE ANSWER WHOSE END WAS LOST');
    console.log('lost end noticed after', Math.round((Date.now() - t0) / 1000), 's');
    expect(await working(t.page)).toBe(false);
    await expect(t.page.locator('.trail.is-live')).toHaveCount(0);
    // What Claude 2.1.331 hands its status line command, shown as the context ring.
    fs.mkdirSync(path.join(t.ws, '.dispatch', 'status'), { recursive: true });
    fs.copyFileSync(path.resolve('e2e/fixtures/claude-status.json'), path.join(t.ws, '.dispatch', 'status', 'boss.json'));
    await expect(t.page.locator('.ctx-ring')).toHaveText('58%', { timeout: 8000 });
    await t.page.locator('.ctx-ring').click();
    await expect(t.page.locator('.ctx-panel')).toContainText('578,627');
    await expect(t.page.locator('.ctx-panel')).toContainText('5-hour limit');
    await t.page.waitForTimeout(700); await t.page.screenshot({ path: path.join(shots, 'context-claude.png') });
    await t.page.keyboard.press('Escape');
    await type(t.page, 'CASE-BASH');
    const card = t.page.locator('.question-card');
    await expect(card).toContainText('rm -f /d/zz-probe.txt', { timeout: 20000 });
    await expect(card).toContainText('Do you want to proceed?');
    await t.page.waitForTimeout(500); await t.page.screenshot({ path: path.join(shots, 'claude-menu-card.png') });
    await card.getByRole('button', { name: 'No', exact: true }).click();
    await expect.poll(t.said, { timeout: 20000 }).toContain('BASH No');
    await expect(card).toHaveCount(0);
  } finally { console.log(t.fake()); await t.close(); }
});
