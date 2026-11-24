// Real OpenCode against a stand-in model server on this computer: server off, loading, on; the reply in the chat, the
// working state, Ctrl+R, and the same conversation after a restart. Then one short real Claude turn for the context ring.
// node e2e/opencode-real.cjs   (needs npm run build, npm run build:core and opencode; "claude" as argument adds Claude)
const { _electron: electron } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-oc-')), shots = path.resolve(root, '..', '.dispatch', 'outputs', 'boss', 'shots');
const log = (ok, t) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`); if (!ok) process.exitCode = 1; };
const PORT = 18733; let loading = true; const asked = [];
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(loading ? 503 : 200); return res.end('{}'); }
  if (/models/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'tiny' }] })); }
  let b = ''; req.on('data', d => b += d).on('end', async () => {
    const body = JSON.parse(b || '{}'), all = JSON.stringify(body.messages || []), title = /title generator|generate a (?:brief |short )?title/i.test(JSON.stringify(body.messages?.[0] || ''));
    if (!title) asked.push(all);
    const text = title ? 'A title' : /SECOND/.test(all.slice(-900)) ? `Second answer. ${/FIRST/.test(all) ? 'I remember FIRST.' : 'I remember nothing.'}` : 'First answer from the local model.';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = o => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'tiny', ...o })}\n\n`);
    if (!title) await wait(4000);
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5200, completion_tokens: 12, total_tokens: 5212 } });
    res.write('data: [DONE]\n\n'); res.end();
  });
});
(async () => {
  fs.mkdirSync(path.join(home, '.dispatch'), { recursive: true });
  fs.writeFileSync(path.join(home, '.dispatch', 'local-ai.json'), JSON.stringify([{ baseURL: `http://127.0.0.1:${PORT}/v1`, model: 'tiny', icon: 'default', name: 'Tiny' }]));
  const app = await electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: home, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, XDG_DATA_HOME: path.join(home, 'xdg'), VITE_DEV_SERVER_URL: '' } });
  const page = await app.firstWindow();
  const until = async (fn, ms) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await Promise.resolve().then(fn).catch(() => null); if (v) return v; await wait(250); } return v; };
  const lines = () => { try { return fs.readFileSync(path.join(home, '.dispatch', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const said = who => lines().filter(m => m.from === who && m.to === 'you').map(m => m.text);
  const working = () => page.evaluate(() => window.army.isWorking('boss'));
  const pid = () => app.evaluate(() => 0).then(() => page.evaluate(() => window.army.debugAgent('boss')));
  try {
    await page.waitForFunction(() => !!window.army);
    await page.evaluate(() => window.army.start({ name: 'boss', provider: 'local:tiny', model: 'tiny', body: 'You are a test agent.', extra: { role: 'boss' } }));
    await page.reload(); await page.waitForSelector('.composer textarea', { timeout: 30000 });
    await wait(6000);
    log(!(await working()), 'idle OpenCode is not shown as working');
    await page.getByRole('textbox', { name: 'Message' }).fill('FIRST please'); await page.keyboard.press('Enter');
    log(!!(await until(() => said('dispatch').some(t => /is not running at/.test(t)), 10000)), 'server off: says so');
    await wait(1500); log(!(await working()), 'and nothing looks like thinking while it waits');
    log(await page.locator('.trail.is-live').count() === 0, 'no live "Thinking" line in the chat either');
    await new Promise(r => server.listen(PORT, '127.0.0.1', r));
    log(!!(await until(() => said('dispatch').some(t => /still loading/.test(t)), 12000)), 'server loading: says so');
    loading = false;
    log(!!(await until(working, 30000)), 'server up: the waiting message goes in by itself and it works');
    // Ctrl+R in the middle of the turn: the agent must go on.
    const before = (await page.evaluate(() => window.army.output('boss'))).length;
    await page.keyboard.press('Control+r'); await page.waitForSelector('.composer textarea', { timeout: 30000 });
    log((await page.evaluate(() => window.army.output('boss'))).length >= before, 'Ctrl+R keeps the agent running');
    log(!!(await until(() => said('boss').includes('First answer from the local model.'), 40000)), 'the reply is in the chat');
    log(!!(await until(async () => !(await working()), 5000)), 'idle after the reply');
    log(asked.filter(a => /FIRST please/.test(a)).length === 1, `the message went to the model once (${asked.length})`);
    const ctx = await until(() => page.evaluate(() => window.army.context.list()).then(c => c.boss), 6000);
    log(ctx?.window === 16384 && ctx.used > 0, `context: ${JSON.stringify({ used: ctx?.used, window: ctx?.window, percent: ctx?.percent })}`);
    await page.locator('.ctx-ring').click(); await wait(500); fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'context-local.png') }); await page.keyboard.press('Escape');
    await page.evaluate(() => window.army.agentAction('boss', 'restart')); await wait(7000);
    const dbg = await pid(); log(dbg.args.includes('--session'), 'a restart opens the same OpenCode session');
    await page.getByRole('textbox', { name: 'Message' }).fill('SECOND please'); await page.keyboard.press('Enter');
    log(!!(await until(() => said('boss').some(t => /I remember FIRST/.test(t)), 50000)), 'and the conversation goes on');
    log(!!(await until(async () => !(await working()), 6000)), 'idle at the end');
    if (process.argv.includes('claude')) {
      await page.evaluate(() => window.army.enlist('cl', { name: 'cl', provider: 'claude', model: 'haiku', body: 'Test agent.', extra: {} }, ''));
      if (await until(() => page.evaluate(() => window.army.attention.list()).then(a => a.cl === 'Trust folder'), 12000)) { await page.evaluate(() => window.army.attention.trust()); await wait(7000); }
      await page.evaluate(() => window.army.send('cl', 'Reply with exactly: OK'));
      const c = await until(() => page.evaluate(() => window.army.context.list()).then(x => x.cl?.modelName && x.cl.used > 0 && x.cl), 60000);
      log(!!c, `Claude status line: ${JSON.stringify(c)}`);
      await page.reload(); await page.waitForSelector('.composer textarea'); await wait(2500);
      await page.getByRole('button', { name: /^cl / }).first().click(); await wait(800);
      await page.locator('.ctx-ring').click(); await wait(500); await page.screenshot({ path: path.join(shots, 'context-claude.png') });
    }
  } catch (e) { log(false, e.stack); }
  finally { if (process.exitCode) console.log(JSON.stringify(lines().map(m => [m.from, m.to, String(m.text).slice(0, 140)])), (await page.evaluate(() => window.army.output('boss')).catch(() => '')).slice(-600)); await app.close().catch(() => {}); server.close(); server.closeAllConnections?.(); try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch {} }
})();
