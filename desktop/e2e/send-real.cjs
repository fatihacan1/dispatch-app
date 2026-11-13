const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function smoke(provider) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-real-'));
  let app;
  try {
    app = await electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.hide()));
    await page.evaluate(() => { window.smokeOutput = ''; window.army.on('terminal', e => { window.smokeOutput += e.data; }); });
    await page.evaluate(() => { window.__sendOutput = {}; window.__sendExited = {}; window.army.on('exit', name => { window.__sendExited[name] = true; }); window.army.on('terminal', ({name, data}) => { window.__sendOutput[name] = (window.__sendOutput[name] || '') + data; }); });
    const model = process.env[`DISPATCH_${provider.toUpperCase()}_MODEL`] || (provider === 'claude' ? 'sonnet' : 'gpt-6.1-terra');
    const marker = `role-${provider}-${Date.now()}`;
    const template = { name: 'smoke', description: 'Real provider smoke test', scope: 'project', provider, model, body: `For every task, include the exact token ${marker} in your report.` };
    await page.evaluate(t => window.army.templates.save(t), template);
    const saved = await page.evaluate(async () => (await window.army.templates.list()).items.find(t => t.name === 'smoke' && t.scope === 'project'));
    assert(saved, 'saved template missing');
    await page.evaluate(({saved, provider}) => window.army.enlist(provider + '-smoke', saved, ''), {saved, provider});
    const name = provider + '-smoke';
    const debug = await page.evaluate(n => window.army.debugAgent(n), name);
    assert(debug.args.includes(model), 'model missing from launch arguments');
    assert(debug.prompt.includes(marker) && debug.prompt.includes('dispatch send'), 'role or protocol missing');
    await wait(8000);
    const startup = await page.evaluate(n => window.__sendOutput[n] || '', name);
    if (/trust/i.test(startup)) {
      await page.evaluate(n => window.army.input(n, '\x1b[B'), name);
      await wait(300);
      await page.evaluate(n => window.army.input(n, '\r'), name);
      await wait(5000);
    }
    await page.evaluate(n => window.army.send(n, 'Please acknowledge this task.'), name);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await wait(1000);
      if (await page.evaluate(n => window.__sendExited[n], name)) throw new Error('agent exited; terminal tail: ' + await page.evaluate(n => (window.__sendOutput[n] || '').slice(-2500), name));
      const log = path.join(workspace, '.dispatch', 'log.jsonl');
      const messages = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(s => { try { return JSON.parse(s); } catch { return {}; } }) : [];
      if (messages.some(m => m.from === name && (m.to === 'you' || m.to === 'user') && m.text.includes(marker))) {
        console.log(`PASS ${provider}: model ${model}, role token and report received via bus`); return true;
      }
    }
    const output = await page.evaluate(() => window.smokeOutput);
    throw new Error(`no matching bus report; terminal tail: ${output.slice(-2500)}`);
  } catch (e) { console.error(`FAIL ${provider}: ${e.message}`); return false; }
  finally { if (app) await app.close(); try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) { console.error(`Cleanup failed for ${workspace}: ${e.message}`); } }
}
(async () => { let ok = true; for (const provider of ['claude', 'codex']) ok = await smoke(provider) && ok; process.exitCode = ok ? 0 : 1; })().catch(e => { console.error(e); process.exitCode = 1; });
