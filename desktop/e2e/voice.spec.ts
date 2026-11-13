import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Needs voice typing installed (Tools > Voice typing) and a speech WAV in DISPATCH_TEST_SPEECH (16 kHz mono).
const speech = process.env.DISPATCH_TEST_SPEECH || '';
const installed = fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Dispatch', 'whisper', 'ggml-large-v3-turbo-q5_0.bin'));

test('voice typing streams spoken words into the chat input', async () => {
 test.skip(!installed || !fs.existsSync(speech), 'voice typing not installed or no speech sample');
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-voice-'));
 const app = await electron.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${speech}`, path.resolve('electron/main.cjs'), '--demo'],
  cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace, VITE_DEV_SERVER_URL: '' },
 });
 try {
  const page = await app.firstWindow();  await page.evaluate(() => window.army.ui.set({ voiceLang: 'en' }));
  await page.getByRole('button', { name: 'Start operation' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Note:');
  await page.getByRole('button', { name: 'Voice typing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop voice typing' })).toBeVisible();
  await expect(page.locator('.mic-button .voice-viz')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/^Note: .*settings/i, { timeout: 30000 });
  await page.screenshot({ path: path.join('test-results', 'voice-typing.png') });
  await page.getByRole('button', { name: 'Stop voice typing' }).click();
  // exact: "Stop voice typing" contains "Voice typing".
  await expect(page.getByRole('button', { name: 'Voice typing', exact: true })).toBeVisible({ timeout: 15000 });
  const value = await page.getByRole('textbox', { name: 'Message' }).inputValue();
  expect(value).toMatch(/open the settings file/i);
  await expect(page.locator('.toast')).toHaveCount(0);

  // The shortcut from another app: the black pill appears, records, and the text is sent to the selected agent.
  await page.getByRole('textbox', { name: 'Message' }).fill('');
  await app.evaluate(() => (global as any).__dispatchVoiceKey(true));
  const overlay = await expect.poll(() => app.windows().find(w => w.url().includes('#overlay')), { timeout: 10000 }).toBeTruthy().then(() => app.windows().find(w => w.url().includes('#overlay'))!);
  await expect(overlay.locator('.dictation-capsule canvas')).toBeVisible({ timeout: 10000 });
  await overlay.screenshot({ path: path.join('test-results', 'voice-overlay.png') });
  await page.waitForTimeout(6000);
  await app.evaluate(() => (global as any).__dispatchVoiceKey(true));
  await expect(page.locator('.message.mine').last()).toContainText(/settings file/i, { timeout: 20000 });
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');

  // Settings > Voice: pick a microphone (saved in ui.json) and see its live level.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const mic = page.getByRole('combobox', { name: 'Microphone' });
  // Device names (and ids) stay hidden until the mic was allowed once.
  if (await page.getByRole('button', { name: 'Show names' }).isVisible()) await page.getByRole('button', { name: 'Show names' }).click();
  await expect(mic.locator('option')).not.toHaveCount(1);
  const options = await mic.locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(1);
  await mic.selectOption({ index: 1 });
  await expect.poll(() => page.evaluate(() => window.army.voice.status().then(s => s.mic))).not.toBe('');
  await expect(mic).not.toHaveValue('');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop microphone test' }).locator('canvas')).toBeVisible();
  await page.screenshot({ path: path.join('test-results', 'voice-settings.png') });
  await page.getByRole('button', { name: 'Stop microphone test' }).click();
 } finally { await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
