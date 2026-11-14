// Real Claude: a project already trusted in Dispatch (.dispatch/trust.json) in a folder Claude has not seen. Claude
// asks; Dispatch answers by itself, and the trust dialog must never appear (it used to flash up and vanish).
// The message sent right after start still reaches the boss. Run: node e2e/trust-quiet-real.cjs (after npm run build)
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-trusted-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-trusted-home-'));
  fs.mkdirSync(path.join(workspace, '.dispatch'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dispatch', 'trust.json'), JSON.stringify({ trusted: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_?CODE|^CLAUDECODE|^CLAUDE_PID/.test(k)));
  let app, ok = true;
  try {
    app = await electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: workspace, env: { ...env, DISPATCH_HOME: home, DISPATCH_TEST_HIDDEN: '1', VITE_DEV_SERVER_URL: '' } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.army);
    await page.evaluate(() => { window.__att = []; window.__out = ''; window.army.on('attention', a => window.__att.push(a)); window.army.on('terminal', e => { window.__out += e.data; }); });
    await page.getByLabel('Provider', { exact: true }).selectOption('claude', { timeout: 30000 });
    const models = await page.getByLabel('Model', { exact: true }).locator('option').allTextContents();
    await page.getByLabel('Model', { exact: true }).selectOption(models.find(m => /haiku/i.test(m)) || models[0]);
    await page.getByRole('button', { name: 'Start operation' }).click();
    const box = page.getByLabel('Message', { exact: true });
    await box.fill('Reply with exactly: TRUSTED-OK'); await box.press('Enter');
    let dialogSeen = false;
    const log = path.join(workspace, '.dispatch', 'log.jsonl'); let reply;
    for (let i = 0; i < 240 && !reply; i++) {
      await wait(500);
      if (await page.locator('.trust-dialog').count()) dialogSeen = true;
      const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(s => { try { return JSON.parse(s); } catch { return {}; } }) : [];
      reply = lines.find(m => m.from === 'boss' && m.to === 'you' && /TRUSTED-OK/.test(m.text));
    }
    const asked = /trust this folder/i.test((await page.evaluate(() => window.__out)).replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''));
    const att = await page.evaluate(() => window.__att);
    console.log(`Claude showed its trust menu: ${asked}; attention events: ${JSON.stringify(att)}`);
    if (!reply) throw new Error('the boss never answered');
    if (dialogSeen || att.some(a => a.reason === 'Trust folder')) throw new Error('the trust dialog showed for a trusted project');
    console.log('PASS trusted project: no dialog, the first message reached the boss');
  } catch (e) { ok = false; console.error('FAIL', e.message); }
  finally {
    if (app) { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {}); }
    await wait(1500);
    for (const d of [workspace, home]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  }
  process.exitCode = ok ? 0 : 1;
})();
