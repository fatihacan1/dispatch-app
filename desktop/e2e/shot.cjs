const { _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const testFs = require('fs');
const workspace = testFs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-qa-'));
process.on('exit', () => testFs.rmSync(workspace, { recursive: true, force: true }));
const fs = require('fs');
(async () => {
 const out = process.argv[2] || 'e2e/screens'; fs.mkdirSync(out,{recursive:true}); const logs=[];
 for (const size of [{width:1600,height:1000},{width:1280,height:800},{width:1000,height:700}]) {
  const app=await electron.launch({args:[path.join(__dirname,'..'),'--demo'],cwd:workspace,env:{...process.env,HOME:workspace,DISPATCH_TEST_HOME: workspace, DISPATCH_HOME:workspace,VITE_DEV_SERVER_URL:''}}); const page=await app.firstWindow();
  page.on('console',m=>{if(m.type()==='error') logs.push(`${size.width}x${size.height} console: ${m.text()}`)}); page.on('pageerror',e=>logs.push(`pageerror: ${e.stack || e.message}`));
  const shot=async name=>{await page.waitForTimeout(300); if(await page.evaluate(()=>document.scrollingElement.scrollHeight>innerHeight)) throw new Error(`Page overflow: ${name}`); await page.screenshot({path:path.join(out,`${size.width}x${size.height}-${name}.png`)});};
  try { await page.setViewportSize(size); await page.waitForTimeout(600); await shot('home'); await page.getByRole('button',{name:'Start operation'}).click(); await page.waitForTimeout(1000); await shot('main-chat'); await page.getByRole('tab',{name:'Terminal',exact:true}).click(); await shot('main-terminal'); await page.getByRole('button',{name:'Overview',exact:true}).click(); await shot('overview'); await page.getByRole('tab',{name:'Messages',exact:true}).click(); await shot('comms'); for(const [label,name] of [['Brain','templates'],['Providers','providers'],['Settings','settings']]) {await page.getByRole('button',{name:label,exact:true}).click(); await shot(name);} } finally {await app.close()}
 } fs.writeFileSync(path.join(out,'console.log'),logs.join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});
