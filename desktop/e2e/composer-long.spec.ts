import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// A long message stays readable while it is typed: the line with the caret is in view, and the layer that colors links
// wraps exactly like the text box under it (before, its lines drifted away from the caret once a scrollbar appeared).
for (const link of [false, true]) test(`a long message keeps the caret in view (${link ? 'with' : 'without'} a link)`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-long-'));
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: root, env: { ...process.env, HOME: root, DISPATCH_TEST_HOME: root, DISPATCH_HOME: root, DISPATCH_TEST_HIDDEN: '1', VITE_DEV_SERVER_URL: '' } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.click();
    if (link) await box.pressSequentially('https://example.com/a/rather/long/path?with=query ');
    const words = 'uzun bir mesaj yaziyorum ki satirlar tasip asagi dogru insin ';
    const probe = () => page.evaluate(() => {
      const ta = document.querySelector('.composer textarea') as HTMLTextAreaElement, input = document.querySelector('.composer-input') as HTMLElement, mirror = document.querySelector('.composer-mirror') as HTMLElement | null;
      const lh = parseFloat(getComputedStyle(ta).lineHeight);
      // Bottom of the last text line (the caret is at the end) and the visible area of the message box, in page pixels.
      const last = ta.getBoundingClientRect().top - ta.scrollTop + ta.scrollHeight - parseFloat(getComputedStyle(ta).paddingBottom);
      const view = input.getBoundingClientRect();
      return { lines: Math.round((ta.scrollHeight - 8) / lh), hidden: Math.round(last - view.bottom), wraps: mirror ? [ta.clientWidth, mirror.clientWidth] : null, heights: mirror ? [ta.scrollHeight, mirror.scrollHeight] : null, drift: mirror ? Math.round((mirror.getBoundingClientRect().top - mirror.scrollTop) - (ta.getBoundingClientRect().top - ta.scrollTop)) : 0 };
    });
    for (let i = 0; i < 26; i++) {
      await box.pressSequentially(words);
      if (i % 5 === 4 || i === 25) {
        const p = await probe(); console.log(link, i, JSON.stringify(p));
        expect(p.hidden).toBeLessThanOrEqual(1);
        if (p.wraps) { expect(p.wraps[0]).toBe(p.wraps[1]); expect(Math.abs(p.drift)).toBeLessThanOrEqual(1); expect(Math.abs(p.heights![0] - p.heights![1])).toBeLessThanOrEqual(1); }
      }
    }
    // Back to the top with the keyboard, then a new line in the middle: still in view.
    await page.keyboard.press('Control+Home');
    await expect.poll(() => page.evaluate(() => { const i = document.querySelector('.composer-input')!, t = document.querySelector('.composer textarea')!; return Math.round(t.getBoundingClientRect().top - t.scrollTop - i.getBoundingClientRect().top); })).toBeGreaterThanOrEqual(-5);
    await page.keyboard.press('Control+End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('son satir');
    expect((await probe()).hidden).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join('test-results', `composer-long-${link ? 'link' : 'plain'}.png`) });
  } finally { await app.close(); }
});
