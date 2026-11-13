#!/usr/bin/env node
// Dispatch "servers" MCP: lets agents use the SSH servers the user saved in Dispatch.
// It is a thin bridge: every call goes to Dispatch (DISPATCH_SERVERS_URL), which checks the server's
// agent access, asks the user when it is set to "ask", runs ssh/scp and logs the call.
const readline = require('readline');
const URL_ = process.env.DISPATCH_SERVERS_URL || '';
const AGENT = process.env.DISPATCH_AGENT || 'agent';
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

const TOOLS = [
  { name: 'servers_list', description: 'List the SSH servers the user allowed agents to use, with what is on them. Call this before using a server.', inputSchema: { type: 'object', properties: {} } },
  { name: 'server_run', description: 'Run a shell command on one of the user\'s servers over SSH and return its output. Non-interactive: no sudo password prompts, no editors, no pagers (use --no-pager, -y). Servers marked "ask" wait for the user to approve each command, so batch related steps into one command. Never run destructive commands the user did not ask for.', inputSchema: { type: 'object', properties: { server: { type: 'string', description: 'Server name from servers_list' }, command: { type: 'string' }, timeout_s: { type: 'number', description: 'Default 120, max 1800' } }, required: ['server', 'command'] } },
  { name: 'server_upload', description: 'Copy a local file or folder (path on this computer) to a path on the server (scp).', inputSchema: { type: 'object', properties: { server: { type: 'string' }, local_path: { type: 'string' }, remote_path: { type: 'string' } }, required: ['server', 'local_path', 'remote_path'] } },
  { name: 'server_download', description: 'Copy a file or folder from the server to a local path on this computer (scp).', inputSchema: { type: 'object', properties: { server: { type: 'string' }, remote_path: { type: 'string' }, local_path: { type: 'string' } }, required: ['server', 'remote_path', 'local_path'] } },
];

async function call(tool, args) {
  if (!URL_) throw new Error('Dispatch is not running, so servers are not available.');
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, agent: AGENT }), signal: AbortSignal.timeout(40 * 60000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.text;
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dispatch-servers', version: '1.0.0' } } });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    try { const text = await call(params.name, params.arguments || {}); send({ id, result: { content: [{ type: 'text', text }] } }); }
    catch (e) { send({ id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } }); }
    return;
  }
  if (method === 'ping') return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not found' } });
});
