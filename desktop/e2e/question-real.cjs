// Real Claude, real window: a new project's trust question survives a message sent right away, a question the boss
// asks (AskUserQuestion) is answered from the chat card, and a usage reading in one tab reaches the other tab.
// Needs a signed-in Claude Code and a build (npm run build). Run: node e2e/question-real.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(what, fn, ms) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await wait(500); } throw new Error(`timed out: ${what}`); }
(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-question-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-question-b-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-question-home-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_?CODE|^CLAUDECODE|^CLAUDE_PID/.test(k)));
  let app, ok = true;
  const step = s => console.log('…', s);
  try {
    app = await electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: workspace, env: { ...env, DISPATCH_HOME: home, DISPATCH_TEST_HIDDEN: '1', VITE_DEV_SERVER_URL: '' } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.army);
    await page.evaluate(() => { window.__exited = {}; window.army.on('exit', n => { window.__exited[n] = true; }); });
    step('start the boss on Claude (haiku) and write to it at once, in a folder Claude has never seen');
    await page.getByLabel('Provider', { exact: true }).selectOption('claude', { timeout: 30000 });
    const models = await page.getByLabel('Model', { exact: true }).locator('option').allTextContents();
    await page.getByLabel('Model', { exact: true }).selectOption(models.find(m => /haiku/i.test(m)) || models[0]);
    await page.getByRole('button', { name: 'Start operation' }).click();
    const prompt = 'Do not read any files or run commands. Immediately call the AskUserQuestion tool with exactly two questions: first "Pick a color" (header Color, single choice) with options Red, Green, Blue; second "Pick toppings" (header Toppings, multiSelect true) with options Cheese, Olives, Ham. After the answers, reply with one line: ANSWERS= followed by what the tool returned.';
    const box = page.getByLabel('Message', { exact: true });
    await box.fill(prompt); await box.press('Enter');
    step('the trust question shows and stays (it used to vanish: the message\'s Enter picked "No, exit")');
    await until('trust prompt', async () => (await page.evaluate(() => window.army.attention.list())).boss === 'Trust folder', 30000);
    await wait(5000);
    if ((await page.evaluate(() => window.army.attention.list())).boss !== 'Trust folder') throw new Error('trust prompt went away by itself');
    if (await page.evaluate(() => window.__exited.boss)) throw new Error('boss exited at the trust prompt');
    await page.evaluate(() => window.army.attention.trust());
    await until('trust answered', async () => !(await page.evaluate(() => window.army.attention.list())).boss, 20000);
    console.log('PASS trust: shown, kept, answered; the boss is still running');
    step('the message waiting behind the trust question goes out, and the boss asks');
    const q = await until('question in chat', async () => (await page.evaluate(() => window.army.questions.list())).boss, 150000);
    if (q.questions.length !== 2) throw new Error('expected two questions, got ' + JSON.stringify(q));
    await until('attention says Question', async () => (await page.evaluate(() => window.army.attention.list())).boss === 'Question', 10000);
    step('the card is in the boss chat');
    // The trust dialog went away with the answer; close any leftover dialog so the chat can be clicked.
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('tab', { name: 'Chat' }).click().catch(() => {});
    const card = page.locator('.question-card');
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.getByRole('radio', { name: /Blue/ }).click();
    await card.getByRole('checkbox', { name: /Cheese/ }).click();
    await card.getByRole('checkbox', { name: /Ham/ }).click();
    await card.getByRole('button', { name: 'Send answer' }).click();
    await card.waitFor({ state: 'detached', timeout: 20000 });
    const log = path.join(workspace, '.dispatch', 'log.jsonl');
    const reply = await until('boss reply with the answers', async () => {
      if (await page.evaluate(() => window.__exited.boss)) throw new Error('boss exited');
      const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(s => { try { return JSON.parse(s); } catch { return {}; } }) : [];
      return lines.find(m => m.from === 'boss' && m.to === 'you' && /ANSWERS/.test(m.text))?.text;
    }, 120000);
    if (!/Blue/.test(reply) || !/Cheese/.test(reply) || !/Ham/.test(reply) || /Olives|Red|Green/.test(reply)) throw new Error('wrong answers reached Claude: ' + reply);
    console.log('PASS question: answered from the chat card →', reply.trim());
    const att = (await page.evaluate(() => window.army.attention.list())).boss;
    if (att) throw new Error('attention still set after answering: ' + att);
    step('a usage reading made in one tab reaches the other tab');
    const opened = app.waitForEvent('window');
    await page.evaluate(f => window.army.tabs.open(f), second);
    const page2 = await opened; await page2.waitForFunction(() => !!window.army);
    await page2.evaluate(() => { window.__usage = null; window.army.on('usage:update', u => { window.__usage = u; }); });
    const fresh = await page.evaluate(() => window.army.usage.refresh('claude'));
    const got = await until('usage update in the other tab', () => page2.evaluate(() => window.__usage), 10000);
    if (JSON.stringify(got.claude) !== JSON.stringify(fresh.claude)) throw new Error('the other tab got different numbers');
    console.log('PASS usage: tab 2 got the reading tab 1 made', got.claude.error ? `(${got.claude.error})` : got.claude.windows.map(w => `${w.label} ${w.usedPercent}%`).join(', '));
  } catch (e) { ok = false; console.error('FAIL', e.message); }
  finally {
    if (app) { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); }
    await wait(1500);
    for (const d of [workspace, second, home]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  }
  process.exitCode = ok ? 0 : 1;
})();
