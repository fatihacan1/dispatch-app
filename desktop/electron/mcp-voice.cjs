#!/usr/bin/env node
// Dispatch bridge to VoiceStudio's MCP server (Streamable HTTP at <url>/mcp/).
// Why a bridge: VoiceStudio is started on demand, and generated audio is saved into the
// workspace (<workspace>/.dispatch/outputs) and logged so it shows under Outputs.
// Env: VOICE_URL, DISPATCH_OUTPUTS, DISPATCH_AGENT, OMNIVOICE_API_KEY (optional).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.env.VOICE_URL || 'http://127.0.0.1:3900').replace(/\/$/, '');
const MCP = BASE + '/mcp/';
const AGENT = process.env.DISPATCH_AGENT || 'agent';
const LOG = process.env.DISPATCH_OUTPUTS || '';
const OUTDIR = LOG ? path.join(path.dirname(LOG), 'outputs') : '';
let session = '', ready = null, nextId = 1;

const log = e => { if (!LOG) return; try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ time: Date.now(), agent: AGENT, tool: 'voicestudio', ...e }) + '\n'); } catch {} };
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
async function up() { try { const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) }); return r.status < 500; } catch { return false; } }

async function post(body) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-OmniVoice-Client-Id': 'dispatch' };
  if (session) headers['mcp-session-id'] = session;
  if (process.env.OMNIVOICE_API_KEY) headers.authorization = 'Bearer ' + process.env.OMNIVOICE_API_KEY;
  const r = await fetch(MCP, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60000) });
  session = r.headers.get('mcp-session-id') || session;
  if (r.status === 202 || body.id === undefined) return null;
  const text = await r.text();
  if (!r.ok) throw new Error(`VoiceStudio ${r.status}: ${text.slice(0, 400)}`);
  if (!/event-stream/.test(r.headers.get('content-type') || '')) return JSON.parse(text);
  const msgs = text.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => { try { return JSON.parse(l.slice(5)); } catch { return null; } });
  return msgs.find(m => m && m.id === body.id) || msgs.filter(Boolean).pop();
}

// Start VoiceStudio if needed (its CLI starts the app/backend), then open an upstream session.
function connect() {
  if (!ready) ready = (async () => {
    if (!(await up())) {
      const tools = require('./tools.cjs');
      tools.voiceStart();
      log({ kind: 'job', id: 'voice-start-' + Date.now(), status: 'starting VoiceStudio' });
      const end = Date.now() + 180000;
      while (!(await up())) { if (Date.now() > end) throw new Error(`VoiceStudio did not start within 3 minutes at ${BASE}. Ask the user to open it.`); await new Promise(r => setTimeout(r, 2000)); }
    }
    const init = await post({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dispatch', version: '1.0.0' } } });
    if (init?.error) throw new Error(init.error.message);
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  })().catch(e => { ready = null; throw e; });
  return ready;
}

function save(buf, ext) {
  if (!OUTDIR) return '';
  fs.mkdirSync(OUTDIR, { recursive: true });
  const file = path.join(OUTDIR, `voice_${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomBytes(2).toString('hex')}.${ext}`);
  fs.writeFileSync(file, buf); log({ kind: 'file', file, size: buf.length }); return file;
}
// Base64 audio is saved to a file and replaced by its path, so the agent's context stays small.
async function capture(result) {
  for (const item of result?.content || []) {
    if (item.type === 'audio' && item.data) { item.type = 'text'; item.text = 'Saved audio: ' + save(Buffer.from(item.data, 'base64'), (item.mimeType || 'audio/wav').split('/')[1] || 'wav'); delete item.data; continue; }
    if (item.type !== 'text') continue;
    let obj; try { obj = JSON.parse(item.text); } catch { continue; }
    let changed = false;
    if (obj.wav_base64) { obj.saved_path = save(Buffer.from(obj.wav_base64, 'base64'), 'wav'); delete obj.wav_base64; changed = true; }
    else if (obj.output_path && fs.existsSync(obj.output_path)) { const st = fs.statSync(obj.output_path); log({ kind: 'file', file: obj.output_path, size: st.size }); }
    else if (obj.audio_url) { try { const r = await fetch(new URL(obj.audio_url, BASE)); if (r.ok) { obj.saved_path = save(Buffer.from(await r.arrayBuffer()), path.extname(obj.audio_url).slice(1) || 'wav'); changed = true; } } catch {} }
    if (changed) item.text = JSON.stringify(obj);
  }
  return result;
}

async function handle(m) {
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dispatch-voicestudio', version: '1.0.0' } } });
  if (m.id === undefined) return; // client notifications stay local
  try {
    await connect();
    const id = nextId++;
    const r = await post({ ...m, id });
    if (!r) return send({ id: m.id, result: {} });
    if (r.error) return send({ id: m.id, error: r.error });
    send({ id: m.id, result: m.method === 'tools/call' ? await capture(r.result) : r.result });
  } catch (e) { send({ id: m.id, error: { code: -32000, message: String(e.message || e) } }); }
}

let buf = '';
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { void handle(JSON.parse(line)); } catch {} } } });
module.exports = { capture };
