// Real Antigravity CLI, a few short turns on a cheap model: trust, approval card, Stop, live permission mode, resume.
// node e2e/agy-real.cjs   (needs npm run build and a signed-in agy)
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-agy-real-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-agy-outside-'));
fs.writeFileSync(path.join(outside, 'note.txt'), 'the word is plum');
const shots = path.join(root, 'test-results'); fs.mkdirSync(shots, { recursive: true });
// A copy of this computer's agy settings without its "skip permissions", so the approval menus show.
const real = path.join(os.homedir(), '.gemini', 'antigravity-cli'), profile = path.join(workspace, '.gemini', 'antigravity-cli');
fs.mkdirSync(profile, { recursive: true });
for (const n of ['installation_id', 'jetski_state.pbtxt']) try { fs.copyFileSync(path.join(real, n), path.join(profile, n)); } catch {}
fs.cpSync(path.join(real, 'cache'), path.join(profile, 'cache'), { recursive: true });
const settings = JSON.parse(fs.readFileSync(path.join(real, 'settings.json'), 'utf8'));
for (const k of ['dangerouslySkipPermissions', 'allowNonWorkspaceAccess', 'permissions', 'mode']) delete settings[k];
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
const launch = () => electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, ANTIGRAVITY_APP_DATA_DIR: profile, VITE_DEV_SERVER_URL: '', DISPATCH_TEST_AGY: JSON.stringify({ allowNonWorkspaceAccess: false, toolPermission: 'request-review' }) } });
const log = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); if (!ok) process.exitCode = 1; };
(async () => {
  let app = await launch(), page = await app.firstWindow();
  const until = async (fn, ms, step = 400) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn().catch(() => null); if (v) return v; await wait(step); } return v; };
  const reason = () => page.evaluate(() => window.army.attention.list()).then(a => a.boss || '');
  const working = () => page.evaluate(() => window.army.isWorking('boss'));
  const question = () => page.evaluate(() => window.army.questions.list()).then(q => q.boss);
  const replies = () => fs.existsSync(path.join(workspace, '.dispatch', 'log.jsonl')) ? fs.readFileSync(path.join(workspace, '.dispatch', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.from === 'boss' && m.to === 'you') : [];
  const tail = () => page.evaluate(() => window.army.output('boss')).then(o => o.slice(-1500));
  try {
    const t0 = Date.now();
    await page.evaluate(() => window.army.start({ name: 'boss', provider: 'antigravity', model: 'gemini-4-hydrogen-low', permission: 'accept-edits', extra: { role: 'boss' }, body: 'You are a test agent. Answer in one short sentence.' }));
    // Sent while it still starts: must wait, not get lost, and not read as working.
    await page.evaluate(() => window.army.send('boss', 'Reply with exactly: ALPHA'));
    log(!(await working()), 'not working while it starts');
    const trust = await until(async () => (await reason()) === 'Trust folder', 30000); log(!!trust, `trust question noticed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await page.evaluate(() => window.army.attention.trust());
    log(!!(await until(async () => !(await reason()), 15000)), 'trust answered');
    log(!!(await until(async () => replies().some(m => /ALPHA/.test(m.text)), 90000)), 'queued message answered without opening the terminal');
    log(!!(await until(async () => !(await working()), 8000)), 'idle after the reply');
    // Approval card
    await page.evaluate(f => window.army.send('boss', `Read the file ${f} with your file reading tool and reply with the last word in it, in capitals.`), path.join(outside, 'note.txt'));
    const q = await until(async () => { const x = await question(); return x?.kind === 'menu' ? x : null; }, 60000);
    if (q) log(true, `approval menu in the chat: ${q ? JSON.stringify({ t: q.title, m: q.message, q: q.question, o: q.options }) : ''}`); else console.log('SKIP approval menu: this agy does not ask');
    if (q) {
      await page.reload(); await wait(4000); await page.screenshot({ path: path.join(shots, 'agy-menu.png') });
      await page.evaluate(l => window.army.questions.answer('boss', { label: l }), q.options[0]);
      // More than one may come (file access, then the tool).
      log(!!(await until(async () => { const x = await question(); if (x?.kind === 'menu') await page.evaluate(l => window.army.questions.answer('boss', { label: l }), x.options[0]).catch(() => {}); return replies().some(m => /PLUM/.test(m.text)); }, 60000, 1200)), 'answered from the chat and went on');
    }
    await until(async () => !(await working()), 8000);
    // Stop
    await page.evaluate(() => window.army.send('boss', 'Count from 1 to 400 in words, one per line. Do not use any tool.'));
    await until(working, 20000); await wait(5000);
    await page.evaluate(() => window.army.interrupt('boss'));
    log(!!(await until(async () => !(await working()), 8000)), 'Stop ends the turn');
    await wait(2500); log(!(await working()), 'and it stays ended');
    const before = replies().length;
    await page.evaluate(() => window.army.send('boss', 'Reply with exactly: BRAVO'));
    log(!!(await until(async () => replies().slice(before).some(m => /BRAVO/.test(m.text)), 60000)), 'next message after Stop works and shows in the chat');
    await until(async () => !(await working()), 8000);
    const r = await page.evaluate(() => window.army.setPermission('boss', 'plan')); log(r.mode === 'applied', `permission mode switched live: ${r.mode}`);
    const r2 = await page.evaluate(() => window.army.setPermission('boss', 'bypass')); log(r2.mode === 'restarted', `bypass restarts in the same conversation: ${r2.mode}`);
    const c = replies().length;
    await page.evaluate(() => window.army.send('boss', 'What were the two code words (NATO letters) I asked you to reply with? Answer with both.'));
    log(!!(await until(async () => replies().slice(c).some(m => /ALPHA/i.test(m.text) && /BRAVO/i.test(m.text)), 90000)), 'remembers the conversation after the restart');
    await page.screenshot({ path: path.join(shots, 'agy-chat.png') });
  } catch (e) { log(false, e.stack); }
  finally {
    if (process.exitCode) console.log('terminal tail:', JSON.stringify(await tail().catch(() => '')), JSON.stringify(replies().map(m => m.text.slice(0, 200))));
    await app.close().catch(() => {}); await wait(1500);
    for (const d of [workspace, outside]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 }); } catch {}
  }
})();
