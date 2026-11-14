// README hero screenshot: the mock workspace with Files open on a source file, the Music scene playing a made-up
// track (title, artist and cover are invented: e2e/fixtures/mock-cover.jpg is generated art), and the team chat.
// Needs a Vite dev server: npx vite --port 5199, then node e2e/readme-hero.cjs <out.png>
const { _electron: electron } = require('@playwright/test');
const path = require('path'), os = require('os'), fs = require('fs');
const out = path.resolve(process.argv[2] || 'readme-hero.png');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-hero-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const PIPELINE = `import { Agent, Step, publish } from "./studio";

// One short a day: the boss hands each step to the agent that owns it.
export const steps: Step[] = [
  { id: "script", owner: "writer", needs: [] },
  { id: "voice", owner: "narrator", needs: ["script"] },
  { id: "edit", owner: "editor", needs: ["voice"] },
  { id: "thumbnail", owner: "designer", needs: ["script"] },
  { id: "upload", owner: "studio-lead", needs: ["edit", "thumbnail"] },
];

export async function runDay(topic: string, team: Map<string, Agent>) {
  const done = new Map<string, string>();
  for (const step of order(steps)) {
    const agent = team.get(step.owner);
    if (!agent) throw new Error(\`No agent for \${step.id}\`);
    const inputs = step.needs.map(id => done.get(id)!);
    done.set(step.id, await agent.run(step.id, { topic, inputs }));
  }
  return publish(done.get("upload")!, { schedule: "18:00", tags: ["shorts", topic] });
}

// Steps in an order where every step comes after what it needs.
function order(list: Step[]): Step[] {
  const seen = new Set<string>(), result: Step[] = [];
  const visit = (s: Step) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    s.needs.forEach(id => visit(list.find(x => x.id === id)!));
    result.push(s);
  };
  list.forEach(visit);
  return result;
}
`;
(async () => {
  // A wider Files panel so the code reads in full.
  fs.mkdirSync(path.join(home, '.dispatch'), { recursive: true });
  fs.writeFileSync(path.join(home, '.dispatch', 'ui.json'), JSON.stringify({ ideWidth: 780, hintSeen: true, scene: 'music' }));
  const version = require('../package.json').version;
  const env = { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home, VITE_DEV_SERVER_URL: 'http://localhost:5199' };
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--demo'], cwd: home, env });
  let page = await app.firstWindow();
  // The app shell is a BaseWindow (tabs are views inside it), so BrowserWindow.getAllWindows() does not list it.
  for (let i = 0; i < 40 && !(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)); i++) await wait(250);
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setSize(1920, 1080); w.center(); w.show(); });
  await wait(3000);
  page = app.windows().find(w => w.url().includes('5199')) || page;
  const ws = await page.evaluate(() => window.army.devMock());
  fs.writeFileSync(path.join(ws, 'src', 'pipeline.ts'), PIPELINE);
  // Now playing: replace the Windows media reader with a made-up track before the Music scene asks for it.
  const cover = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'mock-cover.jpg')).toString('base64');
  const mediaFile = path.join(__dirname, '..', 'electron', 'media.cjs');
  await app.evaluate((_e, [cover, mediaFile]) => {
    const media = process.mainModule.require(mediaFile);
    media.watch = fn => {
      const t0 = Date.now();
      const send = first => fn({ app: 'MSEdge', title: 'Glass Orchard', artist: 'Mira Sol', album: 'Low Tide Hours', status: 'Playing', position: 74 + (Date.now() - t0) / 1000, duration: 236, updated: Date.now(), canNext: true, canPrev: true, ...(first ? { track: true, cover } : {}) });
      send(true); const id = setInterval(() => send(false), 1000); return () => clearInterval(id);
    };
    media.send = async () => true;
  }, [cover, mediaFile]);
  await page.reload(); await wait(5000);
  const gotIt = page.getByRole('button', { name: 'Got it' }); if (await gotIt.count()) await gotIt.first().click();
  await page.addStyleTag({ content: '.rail-dev{display:none!important}' });
  await page.getByRole('button', { name: 'Music', exact: true }).first().click();
  await page.keyboard.press('Control+e'); await wait(2500);
  await page.locator('.ide-tree').getByText('src', { exact: true }).click(); await wait(600);
  await page.locator('.ide-tree').getByText('pipeline.ts', { exact: true }).click(); await wait(3000);
  await page.evaluate(VERSION => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/^dispatch-mock-\w+$/i.test(n.nodeValue.trim())) n.nodeValue = 'daily-shorts'; else if (/^v\d+\.\d+\.\d+$/.test(n.nodeValue.trim())) n.nodeValue = 'v' + VERSION; for (const b of document.querySelectorAll('button')) if (/^v\d+\.\d+\.\d+$/.test(b.textContent.trim())) b.textContent = 'v' + VERSION; }, version);
  await page.evaluate(() => { for (const s of document.querySelectorAll('.crumb span, .ide-root')) if (/dispatch-mock/i.test(s.textContent)) s.textContent = s.classList.contains('ide-root') ? 'DAILY-SHORTS' : 'daily-shorts'; });
  await page.mouse.move(5, 500); await wait(1500);
  await page.screenshot({ path: out });
  console.log('saved', out);
  await app.close();
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
})().catch(e => { console.error(e); process.exit(1); });
