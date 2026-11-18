// Dispatch-managed MCP presets. Selection is stored in each agent template.
const path = require('path');
// builtin: an MCP server shipped with Dispatch, run with Electron's own Node (no PATH lookup).
const PRESETS = Object.freeze({ rustxng: { name: 'RustXNG', command: 'rustxng', args: ['mcp'] }, ddgs: { name: 'DDGS', command: 'ddgs', args: ['mcp'] }, comfyui: { name: 'ComfyUI', builtin: path.join(__dirname, 'mcp-comfy.cjs'), args: [] }, voicestudio: { name: 'VoiceStudio', builtin: path.join(__dirname, 'mcp-voice.cjs'), args: [] }, memory: { name: 'Memory', builtin: path.join(__dirname, 'mcp-memory.cjs'), args: [], bossOnly: true }, unreal: { name: 'Unreal', remote: true }, blender: { name: 'Blender', builtin: path.join(__dirname, 'mcp-blender.cjs'), args: [] }, servers: { name: 'Servers', builtin: path.join(__dirname, 'mcp-servers.cjs'), args: [], auto: true } });
const SUPPORTED = ['claude', 'codex', 'opencode', 'local', 'antigravity', 'gemini'];
let builtinEnv = () => ({});
function setBuiltinEnv(fn) { builtinEnv = fn; }
// remote: an HTTP MCP server Dispatch does not start (Unreal's runs inside the editor).
let remoteUrl = id => id === 'unreal' ? 'http://127.0.0.1:8000/mcp' : '';
function setRemoteUrl(fn) { remoteUrl = fn; }
function selected(template) {
  const ids = String(template.extra?.dispatch_mcp || '').split(',').map(s => s.trim()).filter(Boolean);
  // Boss-only presets (memory) are never taken from a template, so no other agent can enable them.
  for (const id of ids) if (!PRESETS[id] || PRESETS[id].bossOnly || PRESETS[id].auto) throw new Error(`Unknown Dispatch MCP: ${id}`);
  return [...new Set(ids)];
}
// options.memory: true only when main.cjs starts the agent named "boss" and a memory scope is on.
function configure(provider, template, resolve, localConfig, options = {}) {
  const ids = selected(template);
  if (options.memory && SUPPORTED.includes(provider)) ids.push('memory');
  // Servers: added for every agent while at least one saved server allows agent access.
  if (options.servers && SUPPORTED.includes(provider)) ids.push('servers');
  if (ids.length && !SUPPORTED.includes(provider)) throw new Error(`Dispatch MCP is not yet supported for ${provider}.`);
  const servers = {};
  for (const id of ids) {
    const preset = PRESETS[id];
    if (preset.remote) { servers[`dispatch_${id}`] = { url: remoteUrl(id) }; continue; }
    if (preset.builtin) { servers[`dispatch_${id}`] = { command: process.execPath, args: [preset.builtin], env: { ELECTRON_RUN_AS_NODE: '1', ...(options.builtinEnv || builtinEnv)(id, options) } }; continue; }
    let spec; try { spec = resolve(preset.command); } catch { throw new Error(`${preset.name} MCP is not installed or not in PATH.`); }
    servers[`dispatch_${id}`] = { command: spec.file, args: [...spec.args, ...preset.args] };
  }
  // Connectors (MCP page): every agent on a supported CLI gets them; other CLIs simply go without.
  const connected = [];
  if (SUPPORTED.includes(provider)) for (const c of options.connectors || []) {
    if (c.url) servers[`mcp_${c.id}`] = { url: c.url };
    else { try { const spec = resolve(c.command); servers[`mcp_${c.id}`] = { command: spec.file, args: [...spec.args, ...c.args] }; } catch { continue; } }
    connected.push(c.name);
  }
  const args = [];
  const config = localConfig ? JSON.parse(localConfig) : {};
  const hasServers = Object.keys(servers).length > 0;
  if (provider === 'claude' && hasServers) args.push('--mcp-config', JSON.stringify({ mcpServers: Object.fromEntries(Object.entries(servers).map(([id, s]) => [id, s.url ? { type: 'http', url: s.url } : s])) }));
  if (provider === 'codex') for (const [id, server] of Object.entries(servers)) if (server.url) args.push('-c', `mcp_servers.${id}={url=${JSON.stringify(server.url)}}`); else args.push('-c', `mcp_servers.${id}={command=${JSON.stringify(server.command)},args=[${server.args.map(x => JSON.stringify(x)).join(',')}]${server.env ? ',env={' + Object.entries(server.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',') + '}' : ''}}`);
  if (provider === 'opencode' || provider === 'local') {
    if (hasServers) config.mcp = Object.fromEntries(Object.entries(servers).map(([id, server]) => [id, server.url ? { type: 'remote', url: server.url, enabled: true } : { type: 'local', command: [server.command, ...server.args], enabled: true, ...(server.env ? { environment: server.env } : {}) }]));
  }
  const antigravityConfig = provider === 'antigravity' && hasServers ? { mcpServers: Object.fromEntries(Object.entries(servers).map(([id, s]) => [id, s.url ? { url: s.url } : s])) } : null;
  const geminiConfig = provider === 'gemini' && hasServers ? { mcpServers: Object.fromEntries(Object.entries(servers).map(([id, s]) => [id, s.url ? { httpUrl: s.url } : s])) } : null;
  return { args, env: Object.keys(config).length ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } : {}, ids, connected, antigravityConfig, geminiConfig };
}
module.exports = { PRESETS, selected, configure, setBuiltinEnv, setRemoteUrl };
