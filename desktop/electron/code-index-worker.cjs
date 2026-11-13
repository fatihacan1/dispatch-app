const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { Parser, Language } = require('web-tree-sitter');
const chokidar = require('chokidar');
const ignore = require('ignore');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const root = workerData.root, dir = workerData.dir, token = workerData.token;
const extensions = { '.ts':'typescript', '.tsx':'tsx', '.js':'javascript', '.jsx':'javascript', '.cjs':'javascript', '.mjs':'javascript', '.go':'go', '.py':'python', '.rs':'rust', '.java':'java', '.c':'c', '.h':'c', '.cpp':'cpp', '.cc':'cpp', '.hpp':'cpp', '.cs':'c_sharp' };
const skipped = new Set(['.git','.dispatch','.myarmy','node_modules','vendor','dist','build','coverage','.next','.venv','venv','target','__pycache__']);
const types = { function_declaration:'function', function_definition:'function', method_definition:'method', method_declaration:'method', fn_item:'function', class_declaration:'class', class_definition:'class', struct_item:'class', type_spec:'type', interface_declaration:'interface', trait_item:'interface', type_alias_declaration:'type', arrow_function:'function' };
fs.mkdirSync(dir,{recursive:true});
const db = new DatabaseSync(path.join(dir,'symbols.sqlite'));
db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS symbols(path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, signature TEXT NOT NULL); CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name); CREATE INDEX IF NOT EXISTS symbols_path ON symbols(path);');
const parsers = new Map(), timers = new Map(), seen = new Set(), revisions = new Map(), jobs = new Set(), ignoreCache = new Map();
let closed=false, watcher, rescanTimer, scanning=false;
function ignored(relative) {
 const parts=relative.split('/'); if(parts.some(x=>skipped.has(x))) return true;
 let current=root;
 for(let i=0;i<parts.length;i++) {
  const ignoreFile=path.join(current,'.gitignore');
  if (!ignoreCache.has(ignoreFile)) { try { ignoreCache.set(ignoreFile, ignore().add(fs.readFileSync(ignoreFile,'utf8'))); } catch { ignoreCache.set(ignoreFile,null); } }
  const rules=ignoreCache.get(ignoreFile), sub=parts.slice(i).join('/'); if(rules && sub && rules.ignores(sub)) return true;
  current=path.join(current,parts[i]);
 }
 return false;
}
function remove(relative) { db.exec('BEGIN'); try { db.prepare('DELETE FROM symbols WHERE path=?').run(relative); db.prepare('DELETE FROM files WHERE path=?').run(relative); db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');throw e;} }
async function processFile(file, revision) {
 if(closed) return; const rel=path.relative(root,file).split(path.sep).join('/');
 if(!rel || rel.startsWith('../')) return; if(ignored(rel)) { remove(rel); return; }
 const lang=extensions[path.extname(file).toLowerCase()]; if(!lang) return;
 try {
  const info=await fs.promises.lstat(file); if(!info.isFile() || info.size>1024*1024) { remove(rel); return; }
  const content=await fs.promises.readFile(file,'utf8'); if(content.includes('\0')) { remove(rel); return; }
  const hash=crypto.createHash('sha256').update(content).digest('hex'); if(db.prepare('SELECT hash FROM files WHERE path=?').get(rel)?.hash===hash) return;
  let parser=parsers.get(lang); if(!parser) { const grammar=await Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`)); parser=new Parser();parser.setLanguage(grammar);parsers.set(lang,parser); }
  const tree=parser.parse(content); const symbols=[];
  function walk(node,parent='') {
   let kind=types[node.type], nameNode=node.childForFieldName('name');
   if(node.type==='arrow_function') { const n=node.parent; if(n?.type==='variable_declarator') nameNode=n.childForFieldName('name'); else kind=null; }
   const name=nameNode?.text; let scope=parent;
   if(kind && name && name.length<200) { const body=node.childForFieldName('body'); let signature=content.slice(node.startIndex,body?.startIndex ?? Math.min(node.endIndex,node.startIndex+240)).replace(/\s+/g,' ').trim().slice(0,240); symbols.push([rel,name,kind,node.startPosition.row+1,node.endPosition.row+1,signature]); if(kind==='class'||kind==='interface'||kind==='type') scope=name; }
   for(const child of node.namedChildren) walk(child,scope);
  }
  walk(tree.rootNode); tree.delete();
  if (closed || revisions.get(file) !== revision) return;
  db.exec('BEGIN');try{db.prepare('DELETE FROM symbols WHERE path=?').run(rel); const insert=db.prepare('INSERT INTO symbols(path,name,kind,start_line,end_line,signature) VALUES(?,?,?,?,?,?)');for(const symbol of symbols) insert.run(...symbol);db.prepare('INSERT OR REPLACE INTO files(path,hash) VALUES(?,?)').run(rel,hash);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 } catch(e) { if(e.code==='ENOENT') remove(rel); else parentPort.postMessage({type:'error',message:`${rel}: ${e.message}`}); }
}
function schedule(file) { const revision=(revisions.get(file)||0)+1;revisions.set(file,revision);clearTimeout(timers.get(file));timers.set(file,setTimeout(()=>{timers.delete(file);const job=processFile(file,revision);jobs.add(job);job.finally(()=>jobs.delete(job));},300)); }
(async()=>{
 await Parser.init();
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end('{}');return;}
  const url=new URL(req.url,'http://localhost');if(req.method!=='GET'||url.pathname!=='/search'){res.writeHead(404);res.end('{}');return;}
  const q=(url.searchParams.get('q')||'').trim().slice(0,100);if(!q){res.writeHead(400);res.end(JSON.stringify({error:'query required'}));return;}
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';const rows=db.prepare("SELECT path,name,kind,start_line,end_line,signature FROM symbols WHERE name LIKE ? ESCAPE '\\' ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 ELSE 1 END, path, start_line LIMIT 30").all(pattern,q);
  res.end(JSON.stringify({results:rows}));
 });
 server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(workerData.info,JSON.stringify({port:server.address().port,token}),{mode:0o600});parentPort.postMessage({type:'ready',dir});});
 async function scan() {
  if(closed || scanning) return; scanning=true;
  if(watcher) await watcher.close(); seen.clear(); let initial=true;
  watcher=chokidar.watch(root,{ignoreInitial:false,followSymlinks:false,ignored:(p,stats)=>{const rel=path.relative(root,p).split(path.sep).join('/');return !!rel && (rel.split('/').some(x=>skipped.has(x)) || (!!stats?.isDirectory() && ignored(rel+'/')));},awaitWriteFinish:{stabilityThreshold:200,pollInterval:100}});
  const rescan=()=>{ignoreCache.clear();clearTimeout(rescanTimer);rescanTimer=setTimeout(()=>void scan(),500);};
  watcher.on('add',file=>{if(path.basename(file)==='.gitignore' && !initial){rescan();return;}const rel=path.relative(root,file).split(path.sep).join('/');if(extensions[path.extname(file).toLowerCase()]&&!ignored(rel)){seen.add(rel);schedule(file);}}).on('change',file=>{if(path.basename(file)==='.gitignore')rescan();else schedule(file);}).on('unlink',file=>{if(path.basename(file)==='.gitignore'){rescan();return;}revisions.set(file,(revisions.get(file)||0)+1);clearTimeout(timers.get(file));timers.delete(file);remove(path.relative(root,file).split(path.sep).join('/'));}).on('ready',()=>{for(const row of db.prepare('SELECT path FROM files').all()) if(!seen.has(row.path)) remove(row.path);initial=false;scanning=false;parentPort.postMessage({type:'indexed'});});
 }
 await scan();
 parentPort.on('message',async msg=>{if(msg==='close'){closed=true;clearTimeout(rescanTimer);for(const t of timers.values())clearTimeout(t);await watcher.close();await Promise.allSettled([...jobs]);server.close();try{fs.unlinkSync(workerData.info)}catch{};for(const p of parsers.values())p.delete();db.close();parentPort.close();}});
})().catch(e=>parentPort.postMessage({type:'error',message:e.message}));
