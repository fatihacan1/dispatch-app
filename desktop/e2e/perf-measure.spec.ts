import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

async function measureCase(label: string, ui: Record<string, any>, seedOp: boolean) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-perf-'));
  const ddir = path.join(home, '.dispatch');
  fs.mkdirSync(ddir, { recursive: true });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ws-'));
  fs.writeFileSync(path.join(ws, 'README.md'), '# Test\n');
  if (seedOp) {
    const opDir = path.join(ws, '.dispatch', 'operations');
    fs.mkdirSync(opDir, { recursive: true });
    const opId = '11111111-1111-1111-1111-111111111111';
    fs.writeFileSync(path.join(opDir, opId + '.json'), JSON.stringify({
      id: opId,
      name: 'Operation Test',
      created: '2026-11-17T10:00:00.000Z',
      agents: [{ name: 'boss', provider: 'claude', model: 'default', template: { name: 'Boss', provider: 'claude', model: 'default' }, stopped: false }],
      segments: [{ start: 0, end: null }],
    }));
  }
  fs.writeFileSync(path.join(ddir, 'tabs.json'), JSON.stringify({ tabs: [ws], active: ws }));
  fs.writeFileSync(path.join(ddir, 'ui.json'), JSON.stringify(ui));

  const t0 = performance.now();
  const app = await electron.launch({
    args: [path.resolve('electron/main.cjs'), '--demo'],
    cwd: home,
    env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, DISPATCH_TEST_TABS: '1', DISPATCH_TEST_HIDDEN: '1' }
  });
  try {
    const tLaunch = performance.now() - t0;
    const page = await app.firstWindow();
    const tFirstWin = performance.now() - t0;
    await page.waitForLoadState('domcontentloaded');
    const tDom = performance.now() - t0;

    await page.addInitScript(() => {
      (window as any).__perf = { longTasks: [], bootRemovedAt: null, bootDoneAt: null };
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            (window as any).__perf.longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
      let sawBoot = false;
      const mo = new MutationObserver(() => {
        const b = document.getElementById('boot');
        if (b) sawBoot = true;
        if (sawBoot && !b && !(window as any).__perf.bootRemovedAt) {
          (window as any).__perf.bootRemovedAt = Math.round(performance.now());
        } else if (b && b.classList.contains('done') && !(window as any).__perf.bootDoneAt) {
          (window as any).__perf.bootDoneAt = Math.round(performance.now());
        }
      });
      window.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('boot')) sawBoot = true;
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 15000 });
    await page.waitForTimeout(400);

    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        perf: (window as any).__perf,
        nav: n ? { domInteractive: Math.round(n.domInteractive), domComplete: Math.round(n.domComplete), loadEventEnd: Math.round(n.loadEventEnd) } : null,
        hasOfficeCanvas: !!document.querySelector('.office canvas'),
        hasIde: !!document.querySelector('.ide'),
        bootPresent: !!document.getElementById('boot'),
      };
    });
    console.log(`CASE [${label}]:`, JSON.stringify({ launchMs: Math.round(tLaunch), firstWinMs: Math.round(tFirstWin), domLoadedMs: Math.round(tDom), ...nav }));
    expect(nav.bootPresent).toBe(false);
    expect(nav.perf.bootDoneAt).not.toBeNull();
    expect(nav.perf.bootDoneAt).toBeLessThan(15000);
  } finally {
    await app.close();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

test('measure boot cases', async () => {
  await measureCase('home-only', { scene: 'office', ideOpen: true }, false);
  await measureCase('office+ide', { scene: 'office', ideOpen: true }, true);
  await measureCase('office+no-ide', { scene: 'office', ideOpen: false }, true);
  await measureCase('pixel+no-ide', { scene: 'pixel', ideOpen: false }, true);
});
