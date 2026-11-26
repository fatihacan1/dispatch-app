// Language servers for the editor, over stdio JSON-RPC. lsp-servers.cjs knows the servers; this file starts one per
// language and project folder, and speaks with it. The renderer uses paths relative to the workspace; they become
// file:// URIs here and back.
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL, fileURLToPath } = require('node:url');
const catalog = require('./lsp-servers.cjs');

// What the server calls the language of a file.
function languageId(lang, rel) {
  const ext = path.extname(rel).toLowerCase();
  if (lang === 'typescript') return { '.tsx': 'typescriptreact', '.jsx': 'javascriptreact', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript' }[ext] || 'typescript';
  if (lang === 'cpp') return ext === '.c' ? 'c' : 'cpp';
  return lang;
}
// Libraries the server cannot find make every line that uses them look wrong. Then only the missing include is shown,
// as a warning; the errors that follow from it are not.
function calmC(diagnostics) {
  // Trouble inside a library's own header (a compiler feature clang lacks) is not a problem in this file.
  const missing = diagnostics.filter(d => d.code === 'pp_file_not_found' || /file not found/.test(d.message || ''));
  if (!missing.length) return diagnostics.filter(d => !/^In included file:/.test(d.message || ''));
  return missing.map(d => ({ ...d, severity: 2, message: `${String(d.message).split(/[^ -~]/)[0]}. Other errors are hidden until it is found: choose where the project's settings come from above the editor.` }));
}

function create(notify, status = () => {}) {
  const servers = new Map(); // `${lang}|${root}` -> Promise<server>
  const docs = new Map();    // same key -> Map(file -> { version, text }): a restarted server gets its open files back
  const homes = new Map();   // `${lang}|${file}` -> key
  const gen = new Map();     // key -> start number, so a start that was replaced is dropped
  const docsOf = key => docs.get(key) || docs.set(key, new Map()).get(key);
  function place(lang, workspace, rel) {
    if (!Object.hasOwn(catalog.SERVERS, lang)) throw new Error(`No language server for ${lang}.`);
    const file = path.resolve(workspace, rel), r = path.relative(workspace, file);
    if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Path is outside the workspace');
    const root = catalog.rootFor(lang, workspace, file), key = `${lang}|${root}`;
    const uri = pathToFileURL(file).href, before = homes.get(`${lang}|${file}`);
    homes.set(`${lang}|${file}`, key);
    // A project file that appeared (platformio.ini, Cargo.toml) gives an open file another root: it moves to that server.
    const doc = before && before !== key && docsOf(before).get(file);
    if (doc) {
      docsOf(before).delete(file); docsOf(key).set(file, doc);
      servers.get(before)?.then(x => x.notify('textDocument/didClose', { textDocument: { uri } })).catch(() => {});
      servers.get(key)?.then(x => x.notify('textDocument/didOpen', { textDocument: { uri, languageId: languageId(lang, rel), version: doc.version, text: doc.text } })).catch(() => {});
    }
    return { file, root, key, uri };
  }
  function start(lang, workspace, p) {
    const { key, root } = p; if (servers.has(key)) return servers.get(key);
    const mine = (gen.get(key) || 0) + 1; gen.set(key, mine);
    const say = text => status({ lang, root, text });
    const promise = (async () => {
      const [command, args, options = {}] = await catalog.SERVERS[lang](say, { workspace, root });
      if (gen.get(key) !== mine) throw new Error('Replaced.');
      say('');
      const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const pending = new Map(); let next = 1, buf = Buffer.alloc(0);
      const send = msg => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg })); try { child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body); } catch {} };
      const toRel = uri => { try { const r = path.relative(workspace, fileURLToPath(uri)); return r.startsWith('..') || path.isAbsolute(r) ? null : r.split(path.sep).join('/'); } catch { return null; } };
      child.on('error', () => {}); child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const head = buf.indexOf('\r\n\r\n'); if (head < 0) return;
          const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, head).toString())?.[1] || 0);
          if (buf.length < head + 4 + len) return;
          let msg; try { msg = JSON.parse(buf.subarray(head + 4, head + 4 + len).toString()); } catch { msg = null; }
          buf = buf.subarray(head + 4 + len);
          if (!msg) continue;
          if (msg.id !== undefined && pending.has(msg.id) && !msg.method) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
          else if (msg.method === 'textDocument/publishDiagnostics') { const rel = toRel(msg.params.uri); if (rel) notify({ lang, rel, diagnostics: lang === 'cpp' ? calmC(msg.params.diagnostics) : msg.params.diagnostics }); }
          else if (msg.id !== undefined && msg.method) send({ id: msg.id, result: msg.method === 'workspace/configuration' ? (msg.params?.items || []).map(() => null) : msg.method === 'workspace/workspaceFolders' ? [{ uri: pathToFileURL(root).href, name: path.basename(root) }] : msg.method === 'workspace/applyEdit' ? { applied: false } : null });
        }
      });
      const request = (method, params, ms = 20000) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); send({ id, method, params }); setTimeout(() => { if (pending.delete(id)) reject(new Error('timeout')); }, ms); });
      child.on('exit', () => { if (servers.get(key) === promise) servers.delete(key); for (const { reject } of pending.values()) reject(new Error('Language server stopped.')); });
      const dead = new Promise((_, reject) => { child.once('error', reject); child.once('exit', c => reject(new Error(`The language server stopped (${c}).`))); }); dead.catch(() => {});
      await Promise.race([dead, request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, rootPath: root, workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }], initializationOptions: options,
        capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] } } }, hover: { contentFormat: ['markdown', 'plaintext'] }, signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } }, publishDiagnostics: {}, synchronization: { didSave: true } }, workspace: { configuration: true, workspaceFolders: true } } }, 120000)]);
      send({ method: 'initialized', params: {} });
      const s = { child, request, notify: (method, params) => send({ method, params }) };
      for (const [file, d] of docsOf(key)) s.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: languageId(lang, file), version: d.version, text: d.text } });
      return s;
    })();
    servers.set(key, promise); promise.catch(() => { say(''); if (servers.get(key) === promise) servers.delete(key); });
    return promise;
  }
  const drop = key => { gen.set(key, (gen.get(key) || 0) + 1); const p = servers.get(key); servers.delete(key); p?.then(s => s.child.kill()).catch(() => {}); };
  return {
    // The text is remembered first: a server that is still being installed opens the file once it runs.
    async open(lang, workspace, rel, text) {
      const p = place(lang, workspace, rel), running = servers.has(p.key); let ready = false;
      if (running) servers.get(p.key).then(() => { ready = true; }).catch(() => {});
      await null; await null;
      docsOf(p.key).set(p.file, { version: 1, text });
      const s = await start(lang, workspace, p);
      if (ready) s.notify('textDocument/didOpen', { textDocument: { uri: p.uri, languageId: languageId(lang, rel), version: 1, text } });
      return true;
    },
    async change(lang, workspace, rel, version, text) {
      const p = place(lang, workspace, rel), d = docsOf(p.key); if (!d.has(p.file)) return false;
      d.set(p.file, { version, text });
      const s = await start(lang, workspace, p);
      s.notify('textDocument/didChange', { textDocument: { uri: p.uri, version }, contentChanges: [{ text }] }); return true;
    },
    async close(lang, workspace, rel) {
      const file = path.resolve(workspace, rel), key = homes.get(`${lang}|${file}`); if (!key) return true;
      docsOf(key).delete(file); if (!servers.has(key)) return true;
      const s = await servers.get(key).catch(() => null); s?.notify('textDocument/didClose', { textDocument: { uri: pathToFileURL(file).href } }); return true;
    },
    async request(lang, workspace, method, rel, position) { const p = place(lang, workspace, rel); const s = await start(lang, workspace, p); return s.request(method, { textDocument: { uri: p.uri }, position }); },
    async resolve(lang, workspace, rel, item) { const s = await start(lang, workspace, place(lang, workspace, rel)); return s.request('completionItem/resolve', item, 5000); },
    // C and C++: where the project's settings come from, and changing it.
    cOptions(workspace, rel) { const p = place('cpp', workspace, rel); return { ...catalog.cOptions(workspace, p.root), using: catalog.resolveChoice(workspace, p.root) }; },
    async cChoose(workspace, rel, value) {
      const p = place('cpp', workspace, rel);
      if (!catalog.cOptions(workspace, p.root).options.some(o => o.id === value)) throw new Error('Unknown choice.');
      catalog.setChoice(workspace, p.root, value); drop(p.key);
      for (const file of docsOf(p.key).keys()) notify({ lang: 'cpp', rel: path.relative(workspace, file).split(path.sep).join('/'), diagnostics: [] });
      if (value !== 'off') await start('cpp', workspace, p);
      return true;
    },
    stopAll() { for (const key of [...servers.keys()]) drop(key); docs.clear(); },
  };
}

module.exports = { create, calmC, languageId };
