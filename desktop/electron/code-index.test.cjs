const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
test('workspace symbols track edits, deletes and offline changes', { timeout: 30000 }, async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-index-test-')); const cache=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-cache-test-')); const info=path.join(cache,'connection.json'); let worker;
 async function start(){worker=new Worker(path.join(__dirname,'code-index-worker.cjs'),{workerData:{root,dir:cache,info,token:'test-token'}});await new Promise((resolve,reject)=>{worker.on('message',m=>{if(m.type==='ready')resolve();if(m.type==='error')reject(Error(m.message));});worker.on('error',reject);});}
 async function query(q){const {port,token}=JSON.parse(fs.readFileSync(info));const r=await fetch(`http://127.0.0.1:${port}/search?q=${q}`,{headers:{authorization:`Bearer ${token}`}});return (await r.json()).results;}
 async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw Error('index did not converge');}
 try {
  fs.writeFileSync(path.join(root,'.gitignore'),'ignored.ts\n'); fs.writeFileSync(path.join(root,'ignored.ts'),'function Hidden() {}');fs.writeFileSync(path.join(root,'app.ts'),'export function Original() {}');
  await start();await until(async()=> (await query('Original')).length===1);assert.equal((await query('Hidden')).length,0);
  const exe=path.join(__dirname,'..','resources','bin',process.platform==='win32'?'dispatch.exe':'dispatch');
  const output=execFileSync(exe,['index','search','Original'],{env:{...process.env,DISPATCH_INDEX_INFO:info},encoding:'utf8'});assert.equal(JSON.parse(output).results[0].name,'Original');
  fs.writeFileSync(path.join(root,'.gitignore'),'');await until(async()=> (await query('Hidden')).length===1);
  fs.writeFileSync(path.join(root,'.gitignore'),'ignored.ts\n');await until(async()=> (await query('Hidden')).length===0);
  fs.writeFileSync(path.join(root,'app.ts'),'export function Updated() {}');await until(async()=> (await query('Updated')).length===1);assert.equal((await query('Original')).length,0);
  fs.unlinkSync(path.join(root,'app.ts'));await until(async()=> (await query('Updated')).length===0);
  worker.postMessage('close');await new Promise(r=>worker.once('exit',r));fs.writeFileSync(path.join(root,'offline.py'),'def Offline():\n  pass\n');await start();await until(async()=> (await query('Offline')).length===1);
 } finally { if(worker){worker.postMessage('close');await new Promise(r=>worker.once('exit',r));}fs.rmSync(root,{recursive:true,force:true});fs.rmSync(cache,{recursive:true,force:true}); }
});
