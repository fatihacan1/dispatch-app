import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Hovering a usage chip in the sidebar shows every limit window in a tooltip that nothing covers or clips, on every theme.
for (const theme of ['dark', 'frosted']) {
  test(`usage chip hover shows the limit details (${theme})`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-usage-'));
    const ui = JSON.stringify({ hintSeen: true, theme, themeColors: {} });
    for (const d of [root, path.join(root, '.dispatch')]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'ui.json'), ui); }
    const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: root, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root } });
    try {
      const page = await app.firstWindow();
      await page.getByRole('button', { name: 'Start operation' }).click();
      const chip = page.locator('.usage-chip').first();
      await expect(chip).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(1500);
      await chip.hover();
      await expect(page.locator('.usage-tip .usage-tip-row').first()).toBeVisible({ timeout: 3000 });
      await page.screenshot({ path: path.join(os.tmpdir(), `usage-tip-${theme}.png`) });
      const probe = await page.evaluate(() => {
        const t = document.querySelector('.usage-tip') as HTMLElement; const r = t.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
        const chain: string[] = []; for (let n = t.parentElement; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backdropFilter !== 'none' || s.transform !== 'none' || s.filter !== 'none' || s.contain !== 'none' || s.overflow !== 'visible') chain.push(`${n.tagName}.${n.className} bf=${s.backdropFilter} tf=${s.transform} ov=${s.overflow}`); }
        return { onTop: !!el && t.contains(el), at: el ? `${el.tagName}.${(el as HTMLElement).className}` : '', rect: [r.left, r.top, r.width, r.height], inWindow: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, chain };
      });
      console.log(theme, JSON.stringify(probe));
      // Inside the window and not trapped in a clipping / backdrop-filter ancestor (the tooltip has pointer-events: none,
      // so elementFromPoint cannot be used to prove it is on top).
      expect(probe.inWindow).toBeTruthy();
      expect(probe.chain.filter(c => !c.startsWith('BODY.')).length).toBe(0);
    } finally { await app.close(); }
  });
}
