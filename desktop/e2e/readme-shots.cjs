// Screenshots for the README, from the dev mock workspace (no personal data).
// Needs a Vite dev server: npx vite --port 5199, then node e2e/readme-shots.cjs <outDir>
const { _electron: electron } = require('@playwright/test');
const path = require('path'), os = require('os'), fs = require('fs');
const out = path.resolve(process.argv[2] || 'readme-shots');
fs.mkdirSync(out, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-shots-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const env = { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, VITE_DEV_SERVER_URL: 'http://localhost:5199' };
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--demo'], cwd: home, env });
  let page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); w.show(); });
  await wait(3000);
  page = app.windows().find(w => w.url().includes('5199')) || page;
  console.log('windows:', app.windows().map(w => w.url()).join(' | '));
  await page.evaluate(() => window.army.devMock());
  await page.reload(); await wait(5000);
  const rail = await page.$$eval('.rail-item, .rail-action', els => els.map(e => e.getAttribute('aria-label') || e.textContent.trim()));
  console.log('rail:', rail.join(' | '));
  const gotIt = page.getByRole('button', { name: 'Got it' }); if (await gotIt.count()) await gotIt.first().click();
  await page.addStyleTag({ content: '.rail-dev{display:none!important}' });
  const tidy = () => page.evaluate(() => { for (const s of document.querySelectorAll('.crumb span')) if (/dispatch-mock/.test(s.textContent)) s.textContent = 'daily-shorts'; });
  const shot = async name => { await wait(1500); await tidy(); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('saved', name); };
  const go = async label => { const b = page.locator(`.rail-item[aria-label="${label}"], .rail-item:has-text("${label}")`).first(); if (await b.count()) { await b.click(); return true; } console.log('no rail item', label); return false; };
  // Tools rows show this computer's install paths: swap them for neutral ones.
  const scrub = () => page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.nodeValue; const v = t.replace(/[A-Z]:\\[^·]*ComfyUI/g, 'C:\\ComfyUI').replace(/C:\\Users\\[^\\]+\\AppData\\Local/g, '%LOCALAPPDATA%').replace(/C:\\Users\\[^\\·]+/g, '~'); if (v !== t) n.nodeValue = v; } });
  const before = {
    templates: async () => { await page.locator('text=studio-lead').first().click(); },
    memory: async () => { await page.locator('text=Video format').first().click(); },
    tools: scrub,
    teams: async () => { await page.getByRole('tab', { name: 'Teams' }).or(page.getByRole('button', { name: 'Teams' })).first().click(); await wait(500); await page.locator('text=Daily studio').first().click().catch(() => {}); },
  };
  for (const [label, name] of (process.argv[3] ? process.argv[3].split(',').map(p => p.split(':')) : [])) { if (await go(label)) { await wait(800); try { await before[name]?.(); } catch (e) { console.log('before', name, e.message); } await shot(name); } }
  if (!process.argv[3]) await shot('current');
  await app.close();
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
})().catch(e => { console.error(e); process.exit(1); });



