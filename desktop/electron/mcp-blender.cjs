#!/usr/bin/env node
// Dispatch "blender" MCP: a stdio bridge to the "MCP for Blender" add-on (github.com/ahujasid/blender-mcp),
// which listens on a TCP socket inside Blender (default 9876) and takes {type, params} JSON commands.
// Blender is started automatically (DISPATCH_BLENDER_EXE) when a tool needs it and nothing is listening.
const readline = require('readline');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const PORT = Number(process.env.DISPATCH_BLENDER_PORT) || 9876;
const EXE = process.env.DISPATCH_BLENDER_EXE || '';
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

const TOOLS = [
  { name: 'blender_scene_info', description: 'Objects, materials and settings of the open Blender scene. Call this first.', inputSchema: { type: 'object', properties: {} } },
  { name: 'blender_object_info', description: 'Details of one object: transform, mesh stats, materials, modifiers.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'blender_execute_python', description: 'Run Python (bpy) inside the open Blender and return what it prints. Use it for everything else: import/export (FBX, glTF, OBJ), cleanup, remesh/decimate, UV unwrap, baking, materials and textures, scale and pivot, saving the .blend. Work in small steps and check the result.', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  { name: 'blender_viewport_screenshot', description: 'Image of the current 3D viewport, to check your work visually.', inputSchema: { type: 'object', properties: { max_size: { type: 'number', description: 'Largest side in pixels, default 800' } } } },
];

function command(type, params = {}, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`Blender did not answer within ${timeoutMs / 1000}s.`)); }, timeoutMs);
    sock.on('connect', () => sock.write(JSON.stringify({ type, params })));
    sock.on('data', d => { buf += d.toString('utf8'); try { const j = JSON.parse(buf); clearTimeout(timer); sock.end(); j.status === 'error' ? reject(new Error(j.message || 'Blender error')) : resolve(j.result); } catch {} });
    sock.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
const listening = () => new Promise(r => { const s = net.connect(PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });

let starting = null;
async function ensureBlender() {
  if (await listening()) return;
  if (!EXE || !fs.existsSync(EXE)) throw new Error('Blender is not running and Dispatch does not know where it is installed. Open Tools > Blender in Dispatch.');
  if (!starting) {
    spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
    starting = (async () => { for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 1000)); if (await listening()) return; } throw new Error('Blender started but the MCP add-on did not answer on port ' + PORT + '. Install it from Tools > Blender in Dispatch.'); })().finally(() => { starting = null; });
  }
  await starting;
}

async function call(name, a) {
  await ensureBlender();
  if (name === 'blender_scene_info') return text(await command('get_scene_info'));
  if (name === 'blender_object_info') return text(await command('get_object_info', { name: a.name }));
  if (name === 'blender_execute_python') return text(await command('execute_code', { code: a.code }));
  if (name === 'blender_viewport_screenshot') {
    const file = path.join(os.tmpdir(), `dispatch-blender-${process.pid}-${Date.now()}.png`);
    await command('get_viewport_screenshot', { max_size: a.max_size || 800, filepath: file, format: 'png' });
    const data = fs.readFileSync(file).toString('base64'); fs.rmSync(file, { force: true });
    return [{ type: 'image', data, mimeType: 'image/png' }];
  }
  throw new Error('Unknown tool: ' + name);
}
const text = r => [{ type: 'text', text: typeof r === 'string' ? r : r?.result !== undefined && Object.keys(r).length === 1 ? String(r.result) : JSON.stringify(r, null, 2) }];

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dispatch-blender', version: '1.0.0' } } });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    try { send({ id, result: { content: await call(params.name, params.arguments || {}) } }); }
    catch (e) { send({ id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } }); }
    return;
  }
  if (method === 'ping') return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not found' } });
});
