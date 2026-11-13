const { _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const testFs = require('fs');
const workspace = testFs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-qa-'));
process.on('exit', () => testFs.rmSync(workspace, { recursive: true, force: true }));
(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' } });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  await page.waitForTimeout(1500);
  const start = page.getByRole('button', { name: /START OPERATION/i });
  if (await start.count()) { await start.first().click(); await page.waitForTimeout(1500); }
  await page.locator('.rail-action').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(__dirname, 'screens', 'qa-enlist.png') });
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
