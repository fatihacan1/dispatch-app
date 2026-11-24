// The voice shortcut pressed while another app is in front: a real system-wide key press (F24, which nothing else uses),
// a stand-in microphone that plays a spoken WAV, the real whisper. node e2e/voice-global.cjs
const { _electron: electron } = require('playwright');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const wait = ms => new Promise(r => setTimeout(r, ms));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-voice-')), wav = path.join(home, 'speech.wav');
const ps = s => execFileSync('powershell.exe', ['-NoProfile', '-Command', s], { encoding: 'utf8' });
ps(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, 'Sixteen', 'Mono'); $s.SetOutputToWaveFile('${wav}', $f); $s.Speak('Please open the settings file and read it.'); $s.Dispose()`);
const press = key => ps(`Add-Type -Name K -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);'; [W.K]::keybd_event(${key},0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W.K]::keybd_event(${key},0,2,[UIntPtr]::Zero)`);
const F24 = 0x87, log = (ok, t) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`); if (!ok) process.exitCode = 1; };
(async () => {
  fs.mkdirSync(path.join(home, '.dispatch'), { recursive: true });
  fs.writeFileSync(path.join(home, '.dispatch', 'ui.json'), JSON.stringify({ voiceShortcut: 'F24', voiceLang: 'en', hintSeen: true }));
  const app = await electron.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, path.resolve(__dirname, '../electron/main.cjs'), '--demo'], cwd: home, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, DISPATCH_TEST_VOICE_KEY: '1', VITE_DEV_SERVER_URL: '' } });
  let other;
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    await wait(9500); // the key is registered once the first tab has settled
    log((await page.evaluate(() => window.army.voice.status())).shortcutOk, 'the key is registered system-wide');
    // Another app in front.
    other = spawn('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = 'another app'; $f.TopMost = $true; $f.Add_Shown({ $f.Activate() }); [void]$f.ShowDialog()"], { stdio: 'ignore' });
    await wait(3500);
    await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].blur()); await wait(400);
    log(!(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].isFocused())), 'Dispatch is not in front');
    for (const round of [1, 2]) {
      press(F24);
      const overlay = async () => { for (let i = 0; i < 60; i++) { const w = app.windows().find(x => x.url().includes('#overlay')); if (w && await w.locator('.dictation-capsule.state-recording').count().catch(() => 0)) return w; await wait(200); } return null; };
      log(!!(await overlay()), `press ${round}: the recorder opens and records (the first one too)`);
      log(!(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(w => w.getTitle() !== 'another app' && w.getSize()[0] > 400).isFocused())), `press ${round}: the other app keeps the focus`);
      await wait(7000);
      press(F24);
      let text = ''; for (let i = 0; i < 100; i++) { text = await page.getByRole('textbox', { name: 'Message' }).inputValue(); if (/settings file/i.test(text) && !app.windows().some(x => false)) { await wait(1500); break; } await wait(300); }
      log(/settings file/i.test(text), `press ${round}: the spoken words are in the chat box: "${text.slice(0, 80)}"`);
      await wait(2500); await page.getByRole('textbox', { name: 'Message' }).fill('');
    }
  } catch (e) { log(false, e.stack); }
  finally { other?.kill(); await app.close().catch(() => {}); try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 }); } catch {} }
})();
