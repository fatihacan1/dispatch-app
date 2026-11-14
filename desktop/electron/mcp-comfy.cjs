#!/usr/bin/env node
// Dispatch ComfyUI MCP server (stdio, JSON-RPC 2.0, no dependencies).
// Env: COMFY_URL, COMFY_ROOT (install root), DISPATCH_OUTPUTS (jsonl log read by the Dispatch UI), DISPATCH_AGENT.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const URL_ = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const ROOT = process.env.COMFY_ROOT || '';
const APP = ROOT && fs.existsSync(path.join(ROOT, 'ComfyUI', 'main.py')) ? path.join(ROOT, 'ComfyUI') : ROOT;
const AGENT = process.env.DISPATCH_AGENT || 'agent';
const LOG = process.env.DISPATCH_OUTPUTS || '';
const CLIENT = crypto.randomUUID();

function log(event) { if (!LOG) return; try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify({ time: Date.now(), agent: AGENT, tool: 'comfyui', ...event }) + '\n'); } catch {} }
async function api(p, opts = {}) {
  const r = await fetch(URL_ + p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, signal: opts.signal || AbortSignal.timeout(30000) });
  const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`ComfyUI ${p} -> ${r.status}: ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 1500)}`);
  return body;
}
async function running() { try { await api('/system_stats', { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; } }
// Starts ComfyUI on demand (same launcher as the Tools page) and waits until it answers.
let starting = null;
async function need() {
  if (await running()) return;
  if (!starting) starting = (async () => {
    const tools = require('./tools.cjs');
    if (!tools.comfyConfig().layout) throw new Error('ComfyUI is not installed. Ask the user to install it from Dispatch > Tools.');
    tools.comfyStart({ detached: true }); log({ kind: 'job', id: 'start-' + Date.now(), status: 'starting ComfyUI' });
    const end = Date.now() + 180000;
    while (Date.now() < end) { await new Promise(r => setTimeout(r, 2000)); if (await running()) return; }
    throw new Error(`ComfyUI did not start within 3 minutes at ${URL_}.`);
  })().finally(() => { starting = null; });
  return starting;
}
// Agent results live in the workspace (<workspace>/.dispatch/outputs), not in ComfyUI's shared output folder.
const OUTDIR = LOG ? path.join(path.dirname(LOG), 'outputs') : '';
function claim(file) {
  if (!OUTDIR || !fs.existsSync(file)) return file;
  fs.mkdirSync(OUTDIR, { recursive: true });
  const ext = path.extname(file), base = path.basename(file, ext); let target = path.join(OUTDIR, base + ext);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(OUTDIR, `${base}_${i}${ext}`);
  try { fs.renameSync(file, target); } catch { fs.copyFileSync(file, target); try { fs.unlinkSync(file); } catch {} }
  return target;
}

// ── Templates (shipped with ComfyUI as python packages) ─────────────
function templatesDir() {
  const sp = [path.join(ROOT, 'python_embeded', 'Lib', 'site-packages'), path.join(ROOT, 'python_embeded', 'lib', 'site-packages')];
  for (const s of sp) { const d = path.join(s, 'comfyui_workflow_templates_json', 'templates'); if (fs.existsSync(d)) return d; }
  return '';
}
async function templateIndex() {
  const dir = templatesDir();
  if (dir && fs.existsSync(path.join(dir, 'index.mcp.json'))) return JSON.parse(fs.readFileSync(path.join(dir, 'index.mcp.json'), 'utf8'));
  return api('/templates/index.mcp.json');
}
async function templateJson(name) {
  const dir = templatesDir();
  if (dir && fs.existsSync(path.join(dir, name + '.json'))) return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  return api('/templates/' + encodeURIComponent(name) + '.json');
}
function collectModels(graph) {
  const out = new Map();
  const walk = nodes => (nodes || []).forEach(n => (n.properties?.models || []).forEach(m => out.set(m.name, m)));
  walk(graph.nodes); (graph.definitions?.subgraphs || []).forEach(sg => walk(sg.nodes));
  return [...out.values()].map(m => ({ ...m, installed: !!APP && fs.existsSync(path.join(APP, 'models', m.directory || '', m.name)) }));
}

// ── UI workflow -> API prompt (flat graphs) ─────────────────────────
let objectInfo = null;
async function info() { return objectInfo || (objectInfo = await api('/object_info', { signal: AbortSignal.timeout(60000) })); }
const WIDGET = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
async function toApi(graph) {
  const subgraphIds = new Set((graph.definitions?.subgraphs || []).map(s => s.id));
  if ((graph.nodes || []).some(n => subgraphIds.has(n.type))) return { prompt: null, reason: 'This template uses subgraphs; read it with comfy_get_template and build an API prompt from the node definitions (comfy_node_info).' };
  const defs = await info();
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const links = new Map((graph.links || []).map(l => Array.isArray(l) ? [l[0], { from: l[1], slot: l[2] }] : [l.id, { from: l.origin_id, slot: l.origin_slot }]));
  const source = (linkId, seen = 0) => {
    const l = links.get(linkId); if (!l || seen > 50) return null;
    const n = byId.get(l.from); if (!n) return null;
    if (n.type === 'Reroute') return source(n.inputs?.[0]?.link, seen + 1);
    if (n.type === 'PrimitiveNode') return { value: n.widgets_values?.[0] };
    if (n.mode === 4) { const pass = (n.inputs || []).find(i => i.link != null); return pass ? source(pass.link, seen + 1) : null; }
    return { ref: [String(n.id), l.slot] };
  };
  const prompt = {}; const warnings = [];
  for (const n of graph.nodes) {
    if (['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode'].includes(n.type) || n.mode === 2 || n.mode === 4) continue;
    const def = defs[n.type]; if (!def) { warnings.push(`Unknown node type ${n.type} (custom node not installed?)`); continue; }
    const inputs = {};
    const linked = new Map((n.inputs || []).filter(i => i.link != null).map(i => [i.name, source(i.link)]));
    const specs = [...Object.entries(def.input?.required || {}), ...Object.entries(def.input?.optional || {})];
    const values = Array.isArray(n.widgets_values) ? [...n.widgets_values] : [];
    const named = !Array.isArray(n.widgets_values) && n.widgets_values ? n.widgets_values : null;
    for (const [name, spec] of specs) {
      const type = Array.isArray(spec[0]) ? 'COMBO' : spec[0];
      const isWidget = WIDGET.has(type);
      if (isWidget) {
        const v = named ? named[name] : values.shift();
        if ((spec[1]?.control_after_generate || ['seed', 'noise_seed'].includes(name)) && !named && ['fixed', 'increment', 'decrement', 'randomize'].includes(values[0])) values.shift();
        if (!linked.has(name) && v !== undefined) inputs[name] = v;
      }
      const s = linked.get(name);
      if (s) inputs[name] = s.ref ?? s.value;
    }
    prompt[String(n.id)] = { class_type: n.type, inputs, _meta: { title: n.title || n.type } };
  }
  return { prompt, warnings };
}

// ── Outputs ──────────────────────────────────────────────────────────
function outputPath(f) { const base = f.type === 'temp' ? 'temp' : f.type === 'input' ? 'input' : 'output'; return APP ? path.join(APP, base, f.subfolder || '', f.filename) : `${URL_}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${f.type}`; }
async function runPrompt(prompt, wait = true, timeoutSec = 900) {
  await need();
  const { prompt_id, node_errors } = await api('/prompt', { method: 'POST', body: JSON.stringify({ prompt, client_id: CLIENT }) });
  log({ kind: 'job', id: prompt_id, status: 'queued', client: CLIENT }); // client: Dispatch listens as it for live progress
  if (!wait) return { prompt_id, node_errors };
  const end = Date.now() + timeoutSec * 1000;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 1500));
    const h = await api('/history/' + prompt_id);
    const item = h[prompt_id]; if (!item) continue;
    const files = [];
    for (const [node, out] of Object.entries(item.outputs || {})) for (const key of Object.keys(out)) for (const f of (Array.isArray(out[key]) ? out[key] : [])) if (f && f.filename) files.push({ node, kind: key, path: outputPath(f), type: f.type });
    for (const f of files) if (f.type === 'output') f.path = claim(f.path);
    const status = item.status?.status_str || 'success';
    log({ kind: 'job', id: prompt_id, status, files: files.filter(f => f.type !== 'temp').map(f => f.path) });
    return { prompt_id, status, files, messages: (item.status?.messages || []).filter(m => m[0] === 'execution_error').map(m => m[1]) };
  }
  return { prompt_id, status: 'still running', hint: 'Call comfy_job with this prompt_id later.' };
}
async function download(url, directory, name) {
  if (!APP) throw new Error('ComfyUI install folder is unknown; set it in Dispatch > Tools.');
  if (!/^[\w./-]+$/.test(directory) || directory.includes('..')) throw new Error('Invalid model directory.');
  name = name || decodeURIComponent(new URL(url).pathname.split('/').pop());
  if (!/^[\w.+-]+$/.test(name)) throw new Error('Invalid file name.');
  const dir = path.join(APP, 'models', directory); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (fs.existsSync(target)) return { path: target, skipped: 'already installed' };
  const headers = process.env.HF_TOKEN && /huggingface\.co/.test(url) ? { authorization: 'Bearer ' + process.env.HF_TOKEN } : {};
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Download failed: ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0; let bytes = 0, last = 0;
  const id = crypto.randomUUID(); const part = target + '.part'; const out = fs.createWriteStream(part);
  log({ kind: 'download', id, file: target, url, bytes: 0, total, done: false });
  for await (const chunk of r.body) {
    bytes += chunk.length; if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
    if (Date.now() - last > 1000) { last = Date.now(); log({ kind: 'download', id, file: target, bytes, total, done: false }); }
  }
  await new Promise(res => out.end(res)); fs.renameSync(part, target);
  log({ kind: 'download', id, file: target, bytes, total: total || bytes, done: true });
  return { path: target, bytes };
}

// ── Tool table ───────────────────────────────────────────────────────
const S = (props, req = []) => ({ type: 'object', properties: props, required: req });
const TOOLS = {
  comfy_status: { description: 'Is ComfyUI running? GPU, version, queue length. It starts automatically when a tool needs it.', schema: S({}), run: async () => {
    if (!(await running())) return { running: false, url: URL_, hint: 'Call comfy_start, or any tool that needs ComfyUI starts it.' };
    const [s, q] = await Promise.all([api('/system_stats'), api('/queue')]);
    return { running: true, url: URL_, version: s.system?.comfyui_version, devices: s.devices?.map(d => d.name), queue: { running: q.queue_running?.length, pending: q.queue_pending?.length } };
  } },
  comfy_search_templates: { description: 'Search the official ComfyUI workflow templates (image, video, audio/music, 3D, API). Returns name, title, task, inputs/outputs.', schema: S({ query: { type: 'string' }, category: { type: 'string', description: 'Image, Video, Audio, 3D, ...' }, limit: { type: 'number' } }), run: async ({ query = '', category = '', limit = 20 }) => {
    const idx = await templateIndex(); const q = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = idx.flatMap(c => (c.templates || []).map(t => ({ category: c.category, ...t })));
    return all.filter(t => (!category || t.category.toLowerCase().includes(category.toLowerCase())) && q.every(w => JSON.stringify([t.name, t.title, t.task, t.model, t.description]).toLowerCase().includes(w)))
      .sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, limit).map(t => ({ name: t.name, title: t.title, category: t.category, task: t.task, model: t.model, api: /^api_/.test(t.name), io: t.io, description: t.description }));
  } },
  comfy_get_template: { description: 'Load a template: required models (with download URL and whether installed), and an API-format prompt you can edit and pass to comfy_run when the graph is flat.', schema: S({ name: { type: 'string' }, include_raw: { type: 'boolean' } }, ['name']), run: async ({ name, include_raw }) => {
    const g = await templateJson(name); const models = collectModels(g);
    let conv = { prompt: null, reason: 'ComfyUI is not running, so node definitions are unavailable.' };
    try { await need(); conv = await toApi(g); } catch (e) { conv.reason = String(e.message || e); }
    return { name, models, missing_models: models.filter(m => !m.installed).length, api_prompt: conv.prompt, note: conv.reason, warnings: conv.warnings, raw: include_raw ? g : undefined };
  } },
  comfy_download_model: { description: 'Download a model file into ComfyUI/models/<directory>. Progress is shown to the user in Dispatch.', schema: S({ url: { type: 'string' }, directory: { type: 'string', description: 'e.g. checkpoints, loras, vae, text_encoders, diffusion_models' }, name: { type: 'string' } }, ['url', 'directory']), run: ({ url, directory, name }) => download(url, directory, name) },
  comfy_list_models: { description: 'List installed models, optionally for one folder (checkpoints, loras, vae, ...).', schema: S({ folder: { type: 'string' } }), run: async ({ folder }) => {
    if (await running()) return folder ? api('/models/' + encodeURIComponent(folder)) : api('/models');
    if (!APP) throw new Error('ComfyUI folder unknown.');
    const base = path.join(APP, 'models'); const dirs = folder ? [folder] : fs.readdirSync(base);
    return Object.fromEntries(dirs.map(d => { try { return [d, fs.readdirSync(path.join(base, d)).filter(f => !f.startsWith('put_'))]; } catch { return [d, []]; } }));
  } },
  comfy_node_info: { description: 'Input/output definition of node classes (for building API prompts). Pass class names, or a search word.', schema: S({ classes: { type: 'array', items: { type: 'string' } }, search: { type: 'string' } }), run: async ({ classes = [], search = '' }) => {
    await need(); const defs = await info();
    if (classes.length) return Object.fromEntries(classes.map(c => [c, defs[c] ? { input: defs[c].input, output: defs[c].output, output_name: defs[c].output_name, category: defs[c].category } : 'unknown']));
    const s = search.toLowerCase(); return Object.keys(defs).filter(k => k.toLowerCase().includes(s) || String(defs[k].display_name || '').toLowerCase().includes(s)).slice(0, 60);
  } },
  comfy_upload_input: { description: 'Copy a local file (image, audio, video) into ComfyUI/input so a workflow can load it. Returns the name to use in Load* nodes.', schema: S({ path: { type: 'string' } }, ['path']), run: async ({ path: p }) => {
    if (!APP) throw new Error('ComfyUI folder unknown.'); const name = path.basename(p); fs.copyFileSync(p, path.join(APP, 'input', name)); return { name };
  } },
  comfy_run: { description: 'Queue an API-format prompt and (by default) wait for the result. Returns output file paths (images, video, audio, 3D).', schema: S({ prompt: { type: 'object' }, wait: { type: 'boolean' }, timeout_sec: { type: 'number' } }, ['prompt']), run: ({ prompt, wait = true, timeout_sec = 900 }) => runPrompt(prompt, wait, timeout_sec) },
  comfy_job: { description: 'Status and outputs of a queued prompt.', schema: S({ prompt_id: { type: 'string' } }, ['prompt_id']), run: async ({ prompt_id }) => { const h = await api('/history/' + prompt_id); return h[prompt_id] ? { done: true, status: h[prompt_id].status, outputs: h[prompt_id].outputs } : { done: false }; } },
  comfy_start: { description: 'Start ComfyUI and wait until it is ready (up to 3 minutes).', schema: S({}), run: async () => { await need(); return { running: true, url: URL_ }; } },
  comfy_stop: { description: 'Stop ComfyUI to free GPU memory when media work is finished and nothing is queued.', schema: S({}), run: async () => { require('./tools.cjs').comfyStop(); return { stopped: true }; } },
  comfy_interrupt: { description: 'Stop the job ComfyUI is currently running.', schema: S({}), run: async () => { await api('/interrupt', { method: 'POST', body: '{}' }); return { ok: true }; } },
};

// ── JSON-RPC over stdio ─────────────────────────────────────────────
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
async function handle(m) {
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dispatch-comfyui', version: '1.0.0' } } });
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) } });
  if (m.method === 'tools/call') {
    const t = TOOLS[m.params?.name];
    try { if (!t) throw new Error('Unknown tool'); const r = await t.run(m.params.arguments || {}); send({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 1) }] } }); }
    catch (e) { send({ id: m.id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } }); }
    return;
  }
  if (m.method === 'ping') return send({ id: m.id, result: {} });
  if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
}
let buf = '';
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { void handle(JSON.parse(line)); } catch {} } } });
module.exports = { toApi, collectModels };
