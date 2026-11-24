// How smooth is moving the window with five projects open and 15 busy agents?
//   node e2e/drag-measure.cjs [<desktop folder of the version to measure>] [scene]
// Moves the window 60 times a second for 6 s and reports how late the main process is, the frames of the page in front,
// and the CPU of each process. "scene" also loads the 3D scene where it needs a click.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..')), withScene = process.argv.includes('scene');
const wait = ms => new Promise(r => setTimeout(r, ms));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-drag-')), bin = path.join(home, 'fakebin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'load.cjs'), `
const S='⣾⣽⣻⢿⡿⣟⣯⣷';let i=0,on=false;try{process.stdin.setRawMode(true)}catch{}process.stdin.resume();
const R='─'.repeat(90);const idle=()=>process.stdout.write('\\x1b[2J\\x1b[Hready\\r\\n\\r\\n'+R+'\\r\\n>\\r\\n'+R+'\\r\\n? for shortcuts      auto · Gemini');setTimeout(idle,1500);
process.stdin.on('data',d=>{if(on||!/\\r$/.test(String(d)))return;on=true;
setInterval(()=>{i++;const L=[];for(let k=0;k<22;k++)L.push('\\x1b[38;5;'+(30+(k+i)%200)+'m● line '+(i+k)+' src/module/file-'+((i*7+k)%97)+'.ts changed and checked again '+Math.random().toString(36).slice(2)+'\\x1b[0m\\x1b[K');
process.stdout.write('\\x1b[H'+L.join('\\r\\n')+'\\r\\n'+S[i%8]+'  Generating...\\x1b[K\\r\\n'+R+'\\r\\n> \\x1b[K\\r\\n'+R+'\\r\\nesc to cancel      auto · Gemini');},40);});`);
fs.writeFileSync(path.join(bin, 'agy.ps1'), `& '${process.execPath}' '${path.join(bin, 'load.cjs')}'\n`);
const PATH = [bin, ...process.env.PATH.split(path.delimiter).filter(d => !['.exe', '.cmd', '.ps1'].some(x => fs.existsSync(path.join(d, 'agy' + x))))].join(path.delimiter);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : null; };
(async () => {
  const dirs = [0, 1, 2, 3, 4].map(i => { const d = path.join(home, `project-${i}`); fs.mkdirSync(d); return d; });
  const app = await electron.launch({ args: [path.join(root, 'electron/main.cjs')], cwd: dirs[0], env: { ...process.env, PATH, Path: PATH, LOCALAPPDATA: path.join(home, 'local'), HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, ANTIGRAVITY_APP_DATA_DIR: path.join(home, 'agy'), VITE_DEV_SERVER_URL: '' } });
  try {
    const first = await app.firstWindow(); await first.waitForFunction(() => !!window.army);
    const pages = [first]; await wait(1500);
    for (const d of dirs.slice(1)) { const opened = app.waitForEvent('window'); await first.evaluate(f => window.army.tabs.open(f), d); pages.push(await opened); await wait(2500); }
    const tpl = { name: 'boss', provider: 'antigravity', model: 'default', body: 'x', extra: { role: 'boss' } };
    for (const p of pages) {
      await p.waitForFunction(() => !!window.army);
      await p.evaluate(t => window.army.start(t), tpl);
      for (const n of ['w1', 'w2']) await p.evaluate(([n, t]) => window.army.enlist(n, { ...t, name: n, extra: {} }, ''), [n, tpl]);
    }
    // Each page shows its running operation (a reload resumes it), then every agent gets work.
    for (const p of pages) { await p.reload(); await p.waitForFunction(() => !!document.querySelector('.composer textarea'), null, { timeout: 60000, polling: 500 }); }
    await wait(6000);
    for (const p of pages) for (const n of ['boss', 'w1', 'w2']) await p.evaluate(n => window.army.send(n, 'work'), n);
    const front = pages.at(-1);
    if (withScene) { await front.locator('.office-load').click().catch(() => {}); }
    await wait(12000);
    const sample = ms => front.evaluate(ms => new Promise(done => { const f = []; let last = performance.now(); const end = last + ms; const step = t => { const now = performance.now(); f.push(now - last); last = now; now < end ? requestAnimationFrame(step) : done(f); }; requestAnimationFrame(step); }), ms);
    const main = ms => app.evaluate(async ({ BaseWindow, app }, ms) => {
      // The main process is kept awake (setImmediate), so every gap is work that blocks it, not Windows' 15 ms timer.
      const { performance } = process.mainModule.require('node:perf_hooks');
      const win = BaseWindow.getAllWindows()[0], [x, y] = win.getPosition();
      app.getAppMetrics(); const t0 = performance.now(), gaps = [], calls = []; let last = t0, next = t0, i = 0;
      await new Promise(done => { const tick = () => {
        const now = performance.now(); gaps.push(now - last);
        if (now >= next) { next = now + 16; i++; win.setPosition(Math.round(x + Math.sin(i / 20) * 160), Math.round(y + Math.abs(Math.sin(i / 33)) * 60)); calls.push(performance.now() - now); }
        last = performance.now(); last - t0 < ms ? setImmediate(tick) : done();
      }; tick(); });
      win.setPosition(x, y);
      const blocked = gaps.filter(g => g > 2), lag = { blockedPercent: +(blocked.reduce((a, b) => a + b, 0) / ms * 100).toFixed(1), over8ms: gaps.filter(g => g > 8).length, over16ms: gaps.filter(g => g > 16).length, max: +gaps.reduce((a, b) => Math.max(a, b), 0).toFixed(1) };
      const cpu = {}; for (const m of app.getAppMetrics()) cpu[m.type] = +((cpu[m.type] || 0) + m.cpu.percentCPUUsage).toFixed(1);
      return { calls, lag, cpu, size: win.getSize() };
    }, ms);
    const still = await sample(3000);
    const [m, frames] = await Promise.all([main(6000), sample(6000)]);
    const out = { version: root, scene: withScene, setPositionMs: { p95: pct(m.calls, .95), max: pct(m.calls, 1) }, working: await front.evaluate(() => window.army.tabs.list().then(t => t.tabs.map(x => x.working))), mainBlocked: m.lag, pageFrameMs: { p50: pct(frames, .5), p95: pct(frames, .95), max: pct(frames, 1) }, pageFrameStillMs: { p50: pct(still, .5), p95: pct(still, .95) }, cpuPercent: m.cpu };
    console.log(JSON.stringify(out, null, 1));
  } catch (e) { console.error(e.stack); process.exitCode = 1; }
  finally { await app.close().catch(() => {}); try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch {} }
})();
