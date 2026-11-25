import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';

const has = (cmd: string, arg: string) => !spawnSync(cmd, [arg], { windowsHide: true, stdio: 'ignore' }).error;
const start = (workspace: string) => electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, DISPATCH_TEST_HIDDEN: '1', VITE_DEV_SERVER_URL: '' } });
function png(w: number, h: number, rgb: number[]) {
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body) >>> 0, body.length + 4); return out; };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array(w).fill(Buffer.from(rgb)))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds: number) {
  const n = 8000 * seconds, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test('Files shows images, video and audio', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-media-'));
  fs.writeFileSync(path.join(ws, 'resim ğ #1.png'), png(1600, 900, [200, 80, 40]));
  fs.writeFileSync(path.join(ws, 'ses.wav'), wav(2));
  fs.writeFileSync(path.join(ws, 'broken.png'), 'not an image');
  fs.writeFileSync(path.join(ws, 'kod.ts'), 'export const a = 1;\n');
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-out-')), 'x.png'); fs.writeFileSync(outside, png(2, 2, [0, 0, 0]));
  const app = await start(ws);
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await page.getByRole('button', { name: 'Show files' }).click();
    const row = (n: string) => page.locator('.ide-row', { hasText: n });
    await row('resim').click();
    const img = page.locator('.ide-media img');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
    await expect(page.locator('.ide-path')).toContainText('1600 × 900');
    expect(await img.evaluate(i => { const r = i.getBoundingClientRect(), p = i.parentElement!.getBoundingClientRect(); return r.width <= p.width && r.height <= p.height; })).toBeTruthy();
    await page.screenshot({ path: path.join('test-results', 'ide-image.png') });
    await img.click(); expect(await img.evaluate(i => Math.round(i.getBoundingClientRect().width))).toBe(1600);
    // Every corner can be reached by scrolling (a centered overflow would cut off the left and top).
    const reach = await page.locator('.ide-media').evaluate(m => { m.scrollTo(0, 0); const i = m.querySelector('img')!.getBoundingClientRect(), r = m.getBoundingClientRect(); return { left: i.left - r.left, top: i.top - r.top, wide: m.scrollWidth >= 1600, tall: m.scrollHeight >= 900 }; });
    expect(reach.left).toBeGreaterThanOrEqual(0); expect(reach.top).toBeGreaterThanOrEqual(0); expect(reach.wide && reach.tall).toBeTruthy();
    await img.click({ position: { x: 20, y: 20 } });
    expect(await img.evaluate(i => Math.round(i.getBoundingClientRect().width))).toBeLessThan(1600);
    // Written again by an agent: the new picture shows.
    fs.writeFileSync(path.join(ws, 'resim ğ #1.png'), png(640, 480, [20, 80, 240]));
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 10000 }).toBe(640);
    await row('ses.wav').click();
    await expect.poll(() => page.locator('.ide-media audio').evaluate((a: HTMLAudioElement) => Math.round(a.duration))).toBe(2);
    // A short clip recorded by the page itself, so the test needs no encoder on the computer.
    const clip = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d')!;
      const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm;codecs=vp8' }), parts: Blob[] = []; rec.ondataavailable = e => parts.push(e.data);
      rec.start(); let n = 0; const t = setInterval(() => { g.fillStyle = `hsl(${n++ * 12} 80% 50%)`; g.fillRect(0, 0, 320, 180); }, 50);
      await new Promise(res => setTimeout(res, 2200)); clearInterval(t);
      await new Promise(res => { rec.onstop = res; rec.stop(); });
      const u8 = new Uint8Array(await new Blob(parts).arrayBuffer()); let out = ''; for (const b of u8) out += String.fromCharCode(b); return btoa(out);
    });
    fs.writeFileSync(path.join(ws, 'film.webm'), Buffer.from(clip, 'base64'));
    await row('film.webm').click();
    const v = page.locator('.ide-media video');
    await expect.poll(() => v.evaluate((x: HTMLVideoElement) => x.videoWidth)).toBe(320);
    await v.evaluate((x: HTMLVideoElement) => { x.muted = true; void x.play(); });
    await expect.poll(() => v.evaluate((x: HTMLVideoElement) => x.currentTime)).toBeGreaterThan(0.5);
    await page.screenshot({ path: path.join('test-results', 'ide-video.png') });
    await row('broken.png').click();
    await expect(page.locator('.ide-media p')).toContainText('cannot be shown');
    await row('kod.ts').click();
    await expect(page.locator('.ide-media')).toHaveCount(0);
    await expect(page.locator('.ide-edit .view-lines')).toContainText('export const a');
    // Nothing outside the open project is served.
    expect(await page.evaluate(p => new Promise(res => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('refused'); i.src = 'dispatch-media://workspace?path=' + encodeURIComponent(p); }), outside)).toBe('refused');
  } finally { await app.close(); }
});

test('Go suggestions open right after the dot', async () => {
  test.skip(!has('gopls', 'version'), 'gopls is not installed'); test.setTimeout(120000);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-go-'));
  fs.mkdirSync(path.join(ws, 'tools', 'health'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tools', 'health', 'main.go'), ['package main', '', 'import (', '\t"net/http"', '\t"os"', '\t"time"', ')', '', 'func main() {', '\tif len(os.Args) != 2 {', '\t\tos.Exit(1)', '\t}', '\tc := http.Client{Timeout: 3 * time.Second}', '\tres, err := c.Get(os.Args[1])', '\tif err != nil {', '\t\tos.Exit(1)', '\t}', '\tdefer res.Body.Close()', '}', ''].join('\n'));
  const app = await start(ws);
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await page.getByRole('button', { name: 'Show files' }).click();
    for (const n of ['tools', 'health', 'main.go']) await page.locator('.ide-row', { hasText: n }).last().click();
    await page.locator('.ide-edit .view-lines').click();
    await page.keyboard.press('Control+Home'); for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.keyboard.type('http.', { delay: 60 });
    const list = page.locator('.suggest-widget.visible .monaco-list-row');
    await expect(list.filter({ hasText: 'CanonicalHeaderKey' }).first()).toBeVisible({ timeout: 40000 });
    await page.screenshot({ path: path.join('test-results', 'ide-go.png') });
    await page.keyboard.type('NewReq', { delay: 60 });
    await expect(list.first()).toContainText('NewRequest');
    await page.keyboard.press('Escape');
    // A package that is not imported yet: picking a name adds the import.
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.press('Delete');
    await page.keyboard.type('strings.Split', { delay: 60 });
    await expect(list.filter({ hasText: 'SplitN' }).first()).toBeVisible({ timeout: 20000 });
    await page.keyboard.press('Enter');
    await expect(page.locator('.ide-edit .view-lines')).toContainText('"strings"');
  } finally { await app.close(); }
});
