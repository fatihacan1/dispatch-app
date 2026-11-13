const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('migrates an existing configuration, updates duplicates, and removes selected model', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-local-config-')); const before=process.env.DISPATCH_HOME; process.env.DISPATCH_HOME=dir;
 try {
  const api=require('./local-ai.cjs'); const root=path.join(dir,'.dispatch'); fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,'local-ai.json'),JSON.stringify({model:'local-qwen',baseURL:'http://127.0.0.1:8080/v1'}));
  assert.equal(api.list().length,1); api.save({model:'local-qwen',baseURL:'http://127.0.0.1:8080/v1',icon:'qwen'});
  assert.equal(api.list().length,1); api.save({model:'local-ornith',baseURL:'http://127.0.0.1:8080/v1'});
  assert.equal(api.read('local-ornith').model,'local-ornith'); assert.equal(api.list().length,2);
  api.remove('local-qwen'); assert.equal(api.read('local-qwen'),null); assert.equal(api.read().model,'local-ornith');
  // Remote provider: HTTPS only, key sealed, kept on re-save, never listed.
  assert.throws(()=>api.save({model:'glm-5.3',baseURL:'http://example.com/v1'}));
  api.setVault({seal:t=>'S:'+t,open:s=>s.slice(2)});
  api.save({model:'glm-5.3',name:'EVREN',baseURL:'https://evren-llmapi.ssyz.org.tr/v1',apiKey:'evren_llm_x'});
  api.save({model:'glm-5.3',name:'EVREN',baseURL:'https://evren-llmapi.ssyz.org.tr/v1'});
  assert.equal(api.apiKey('glm-5.3'),'evren_llm_x'); assert.equal(api.read('glm-5.3').hasKey,true); assert.equal(JSON.stringify(api.list()).includes('evren_llm_x'),false);
  assert.equal(JSON.parse(api.envConfig(api.read('glm-5.3'))).provider['dispatch-local'].options.apiKey,'evren_llm_x');
 } finally { if (before === undefined) delete process.env.DISPATCH_HOME; else process.env.DISPATCH_HOME=before; fs.rmSync(dir,{recursive:true,force:true}); }
});
