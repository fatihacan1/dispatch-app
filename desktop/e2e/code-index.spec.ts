import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs'; import crypto from 'node:crypto';
test('Electron starts a working workspace index in the background', async () => {
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-index-e2e-'));
 fs.writeFileSync(path.join(workspace,'sample.ts'),'export function NeedleFromWorkspace() {}');
 const app=await electron.launch({args:[path.resolve('electron/main.cjs'),'--demo'],cwd:workspace,env:{...process.env,HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace,VITE_DEV_SERVER_URL:''}});
 try {
  await app.firstWindow();
  const dir=path.join(os.tmpdir(),'dispatch-code-index',crypto.createHash('sha256').update(path.resolve(workspace)).digest('hex'));
  await expect.poll(()=>fs.existsSync(dir) ? fs.readdirSync(dir).some(x=>x.startsWith('connection-')) : false).toBe(true);
  const info=path.join(dir,fs.readdirSync(dir).find(x=>x.startsWith('connection-'))!);
  await expect.poll(async()=>{try { const {port,token}=JSON.parse(fs.readFileSync(info,'utf8'));const r=await fetch(`http://127.0.0.1:${port}/search?q=NeedleFromWorkspace`,{headers:{authorization:`Bearer ${token}`}});return (await r.json()).results?.length || 0; }catch{return 0;}},{timeout:15000}).toBe(1);
 } finally { await app.close();fs.rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:300}); }
});
