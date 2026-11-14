// Language servers for the editor, over stdio JSON-RPC. Go uses gopls: the one on PATH, in GOPATH/bin, or installed
// once with `go install` when Go is there. The renderer talks to it with paths relative to the workspace; this file
// turns them into file:// URIs and back.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { pathToFileURL, fileURLToPath } = require('node:url');

const exe = name => process.platform === 'win32' ? name + '.exe' : name;
const run = (file, args, opts = {}) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 300000, ...opts }, (err, out) => err ? reject(err) : resolve(String(out).trim())));
const which = async name => { try { return (await run(process.platform === 'win32' ? 'where' : 'which', [name], { timeout: 5000 })).split(/\r?\n/)[0] || null; } catch { return null; } };

async function goplsPath() {
  const found = await which('gopls'); if (found) return found;
  const go = await which('go'); if (!go) throw new Error('Go is not installed, so Go suggestions are off.');
  const gopath = (await run(go, ['env', 'GOPATH'])).split(path.delimiter)[0];
  const bin = path.join(gopath, 'bin', exe('gopls'));
  if (!fs.existsSync(bin)) await run(go, ['install', 'golang.org/x/tools/gopls@latest']);
  if (!fs.existsSync(bin)) throw new Error('Could not install gopls.');
  return bin;
}
const SERVERS = { go: { command: goplsPath, args: ['serve'] } };

function create(notify) {
  const servers = new Map(); // `${lang}|${workspace}` -> Promise<server>
  function start(lang, workspace) {
    const key = `${lang}|${workspace}`; if (servers.has(key)) return servers.get(key);
    const spec = SERVERS[lang]; if (!spec) return Promise.reject(new Error(`No language server for ${lang}.`));
    const p = (async () => {
      const child = spawn(await spec.command(), spec.args, { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const pending = new Map(); let next = 1, buf = Buffer.alloc(0);
      const send = msg => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg })); child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body); };
      const toRel = uri => { try { return path.relative(workspace, fileURLToPath(uri)).split(path.sep).join('/'); } catch { return null; } };
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
          else if (msg.method === 'textDocument/publishDiagnostics') { const rel = toRel(msg.params.uri); if (rel) notify({ lang, rel, diagnostics: msg.params.diagnostics }); }
          else if (msg.id !== undefined && msg.method) send({ id: msg.id, result: msg.method === 'workspace/configuration' ? (msg.params?.items || []).map(() => null) : null });
        }
      });
      const request = (method, params) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); send({ id, method, params }); setTimeout(() => { if (pending.delete(id)) reject(new Error('timeout')); }, 20000); });
      child.on('exit', () => { servers.delete(key); for (const { reject } of pending.values()) reject(new Error('Language server stopped.')); });
      await request('initialize', { processId: process.pid, rootUri: pathToFileURL(workspace).href, workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: path.basename(workspace) }],
        capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } }, hover: { contentFormat: ['markdown', 'plaintext'] }, signatureHelp: {}, publishDiagnostics: {}, synchronization: { didSave: true } }, workspace: { configuration: true } } });
      send({ method: 'initialized', params: {} });
      return { child, request, notify: (method, params) => send({ method, params }), uri: rel => pathToFileURL(path.join(workspace, rel)).href };
    })();
    servers.set(key, p); p.catch(() => servers.delete(key));
    return p;
  }
  return {
    async open(lang, workspace, rel, text) { const s = await start(lang, workspace); s.notify('textDocument/didOpen', { textDocument: { uri: s.uri(rel), languageId: lang, version: 1, text } }); return true; },
    async change(lang, workspace, rel, version, text) { const s = await start(lang, workspace); s.notify('textDocument/didChange', { textDocument: { uri: s.uri(rel), version }, contentChanges: [{ text }] }); return true; },
    async close(lang, workspace, rel) { const s = await start(lang, workspace); s.notify('textDocument/didClose', { textDocument: { uri: s.uri(rel) } }); return true; },
    async request(lang, workspace, method, rel, position) { const s = await start(lang, workspace); return s.request(method, { textDocument: { uri: s.uri(rel) }, position }); },
    stopAll() { for (const p of servers.values()) p.then(s => s.child.kill()).catch(() => {}); servers.clear(); },
  };
}

module.exports = { create };
