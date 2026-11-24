import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('image strip: hover grow, remove, 20-image cap, lightbox, and sent message', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-image-strip-'));
  const app = await electron.launch({
    args: [path.resolve('electron/main.cjs'), '--demo'],
    cwd: workspace,
    env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();

    const buf = fs.readFileSync(path.resolve('public/icon-256.png'));
    const makeFiles = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        name: `${prefix}-${String(i + 1).padStart(2, '0')}.png`,
        mimeType: 'image/png',
        buffer: buf,
      }));

    const fileInput = page.locator('input[type=file]');
    await fileInput.setInputFiles(makeFiles('img', 20));

    const composerCards = page.locator('.composer .img-card');
    await expect(composerCards).toHaveCount(20);

    // Hover the middle of the strip and wait for a card to grow larger than 76 px.
    const strip = page.locator('.composer .img-strip');
    const stripBox = await strip.boundingBox();
    expect(stripBox).not.toBeNull();
    await page.mouse.move(stripBox!.x + stripBox!.width / 2, stripBox!.y + stripBox!.height / 2);

    let grownIdx = -1;
    await expect.poll(async () => {
      const boxes = await composerCards.evaluateAll(els =>
        els.map(el => {
          const r = el.getBoundingClientRect();
          return { width: r.width, height: r.height };
        })
      );
      grownIdx = boxes.findIndex(b => b.width > 76 || b.height > 76);
      return grownIdx;
    }).toBeGreaterThanOrEqual(0);

    fs.mkdirSync(path.resolve('test-results'), { recursive: true });
    await page.screenshot({ path: path.resolve('test-results/strip-composer.png') });

    // Remove the hovered card via its x button (19 left).
    const hoveredCard = composerCards.nth(grownIdx);
    const hoveredBox = await hoveredCard.boundingBox();
    expect(hoveredBox).not.toBeNull();
    await page.mouse.move(hoveredBox!.x + hoveredBox!.width / 2, hoveredBox!.y + hoveredBox!.height / 2);
    await hoveredCard.locator('.img-remove').click();
    await expect(composerCards).toHaveCount(19);

    // Attaching 5 more keeps 20 and shows a toast.
    await fileInput.setInputFiles(makeFiles('extra', 5));
    await expect(composerCards).toHaveCount(20);
    await expect(page.locator('.toast')).toBeVisible();

    // Click a card -> lightbox is visible, ArrowRight changes counter to "2 / 20", Escape closes it.
    await composerCards.first().locator('.img-open').click({ position: { x: 6, y: 20 } });
    const lightbox = page.locator('.lightbox');
    await expect(lightbox).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(lightbox.locator('.lightbox-bar small')).toHaveText('2 / 20');
    await page.screenshot({ path: path.resolve('test-results/strip-lightbox.png') });
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);

    // Send: sent message has .img-card items; click one, lightbox shows.
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const sentCards = page.locator('.message-list .img-card');
    await expect(sentCards).toHaveCount(20);
    await page.screenshot({ path: path.resolve('test-results/strip-sent.png') });
    await sentCards.first().locator('.img-open').click({ position: { x: 6, y: 20 } });
    await expect(lightbox).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
