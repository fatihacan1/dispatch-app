// Custom AI providers: any OpenAI-compatible server run through OpenCode. A local server (llama.cpp, LM Studio,
// Ollama) needs only an address; a hosted one (EVREN, OpenRouter, Groq, ...) takes an HTTPS address and an API key.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const iconIds = new Set(require('./local-icons.json').map(icon => icon.id));
const file = () => path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'local-ai.json');
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
// API keys are sealed with the OS keystore (Electron safeStorage); main.cjs sets the vault.
let vault = { seal: () => { throw new Error('This computer cannot store API keys securely.'); }, open: () => '' };
function setVault(v) { vault = v; }
function raw() { try { const data = JSON.parse(fs.readFileSync(file(), 'utf8')); return (Array.isArray(data) ? data : [data]).map(item => ({ ...validate(item), ...(item.key ? { key: String(item.key) } : {}) })); } catch { return []; } }
// What the renderer sees: never the key itself, only whether one is saved.
const strip = ({ key, ...item }) => ({ ...item, hasKey: !!key });
function list() { return raw().map(strip); }
function find(model) { const items = raw(); return model && model !== 'default' ? items.find(item => item.model === model) || null : items[0] || null; }
function read(model) { const item = find(model); return item ? strip(item) : null; }
function apiKey(model) { const item = find(model); if (!item?.key) return ''; try { return vault.open(item.key); } catch { return ''; } }
function write(items) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(items, null, 2)); }
const isLocal = url => LOCAL_HOSTS.includes(new URL(url).hostname);
function validate(config) {
  const url = new URL(String(config.baseURL || '').trim());
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter the server address without credentials or query parameters.');
  if (url.protocol === 'http:' ? !LOCAL_HOSTS.includes(url.hostname) : url.protocol !== 'https:') throw new Error('Use HTTPS for a remote server (plain HTTP only on this computer).');
  const model = String(config.model || '').trim();
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error('Enter a valid model ID.');
  const icon = config.icon || 'default';
  if (typeof icon !== 'string' || (!iconIds.has(icon) && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon)) || icon.length > 1500000) throw new Error('Invalid provider icon.');
  const name = String(config.name || model).trim(); if (!name || name.length > 100 || /[\r\n]/.test(name)) throw new Error('Enter a valid provider name.');
  const limit = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
  const context = limit(config.context, 1024, 10000000), output = limit(config.output, 256, 1000000);
  return { baseURL: url.toString().replace(/\/+$/, ''), model, icon, name, ...(context ? { context } : {}), ...(output ? { output } : {}) };
}
function cleanKey(k) { const key = String(k || '').trim(); if (key.length > 1000 || /[\s]/.test(key)) throw new Error('Enter a valid API key.'); return key; }
// config.apiKey: a new key; empty keeps the saved one; config.clearKey removes it.
function save(config) {
  const value = validate(config); const key = cleanKey(config.apiKey);
  const items = raw(); const index = items.findIndex(item => item.model.toLowerCase() === value.model.toLowerCase() || item.name.toLowerCase() === value.name.toLowerCase());
  const sealed = key ? vault.seal(key) : config.clearKey ? '' : index >= 0 ? items[index].key || '' : '';
  const entry = { ...value, ...(sealed ? { key: sealed } : {}) };
  if (index >= 0) items[index] = entry; else items.push(entry);
  write(items); return strip(entry);
}
function remove(model) { const items = raw(); const next = items.filter(item => item.model !== model); if (next.length === items.length) throw new Error('Provider not found.'); write(next); return next.map(strip); }
function headers(key) { return key ? { Authorization: `Bearer ${key}` } : {}; }
async function check(config) {
  let value; try { value = validate(config); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  const key = cleanKey(config.apiKey) || apiKey(value.model);
  try {
    const response = await fetch(value.baseURL + '/models', { headers: headers(key), signal: AbortSignal.timeout(isLocal(value.baseURL) ? 4000 : 10000) });
    if (!response.ok) {
      let code = ''; try { const body = await response.json(); code = body?.error?.code || ''; } catch {}
      if (response.status === 401) throw new Error(key ? 'The API key was rejected (HTTP 401).' : 'This server needs an API key.');
      if (code === 'terms_not_accepted') throw new Error('Accept the provider\'s terms of use first (on its website), then test again.');
      throw new Error(`Server returned HTTP ${response.status}${code ? ` (${code})` : ''}`);
    }
    const json = await response.json(); const ids = Array.isArray(json.data) ? json.data.filter(x => !x.task || x.task === 'chat').map(x => x.id).filter(Boolean) : [];
    return { ok: true, models: ids, matches: ids.includes(value.model) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
// OpenCode config for one provider. The key goes in the agent's own environment only (OPENCODE_CONFIG_CONTENT).
function envConfig(value, key = apiKey(value.model)) {
  const local = isLocal(value.baseURL);
  const limit = { context: value.context || (local ? 16384 : 131072), output: value.output || (local ? 4096 : 16384) };
  return JSON.stringify({ provider: { 'dispatch-local': { npm: '@ai-sdk/openai-compatible', name: value.name || 'Dispatch Custom AI', options: { baseURL: value.baseURL, ...(key ? { apiKey: key } : {}) }, models: { [value.model]: { name: value.model, limit } } } } });
}
module.exports = { read, list, save, remove, check, envConfig, apiKey, setVault, isLocal };
