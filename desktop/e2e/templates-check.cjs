// QA: create a template via the UI, save, verify the .md file on disk.
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const testFs = require('fs');
const workspace = testFs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-qa-'));
process.on('exit', () => testFs.rmSync(workspace, { recursive: true, force: true })); const fs = require('fs');
(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Brain', exact: true }).click();
  await page.getByRole('button', { name: '+ New template' }).click();
  const name = 'qa-reviewer-' + Date.now();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Provider').selectOption('opencode');
  await page.getByLabel('Description').fill('QA created template');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(__dirname, 'screens', 'qa-templates.png') });
  const ws = await page.evaluate(() => window.army.info().then(i => i.workspace));
  const file = path.join(ws, '.dispatch', 'agents', name + '.md');
  const ok = fs.existsSync(file);
  console.log(ok ? 'SAVED ' + file : 'MISSING ' + file);
  if (ok) { console.log(fs.readFileSync(file, 'utf8')); fs.unlinkSync(file); }
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
