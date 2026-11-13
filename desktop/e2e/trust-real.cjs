const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
 let failed = false;
 for (const provider of ['claude', 'codex']) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-trust-real-'));
  let app;
  try {
   app = await electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
   const page = await app.firstWindow();
   await page.evaluate(p => window.army.start(p), provider);
   let reason;
   for (let i = 0; i < 30; i++) { await wait(500); reason = (await page.evaluate(() => window.army.attention.list())).boss; if (reason) break; }
   if (reason !== 'Trust folder') throw new Error(`expected trust prompt, got ${reason || 'none'}; terminal: ${(await page.evaluate(() => window.army.output('boss'))).slice(-1000)}`);
   await page.evaluate(() => window.army.attention.trust());
   for (let i = 0; i < 20; i++) { await wait(500); if (!(await page.evaluate(() => window.army.attention.list())).boss) break; }
   if ((await page.evaluate(() => window.army.attention.list())).boss) throw new Error('trust prompt not resolved');
   console.log(`PASS ${provider}: trust detected and resolved`);
  } catch (e) { failed = true; console.error(`FAIL ${provider}: ${e.message}`); }
  finally { if (app) await app.close(); try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {} }
 }
 process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
