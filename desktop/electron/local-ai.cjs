const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const iconIds = new Set(require('./local-icons.json').map(icon => icon.id));
const file = () => path.join(process.env.DISPATCH_HOME || os.homedir(), '.dispatch', 'local-ai.json');
function list() { try { const data = JSON.parse(fs.readFileSync(file(), 'utf8')); return (Array.isArray(data) ? data : [data]).map(validate); } catch { return []; } }
function read(model) { const items = list(); return model && model !== 'default' ? items.find(item => item.model === model) || null : items[0] || null; }
function write(items) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(items, null, 2)); }
function validate(config) {
  const url = new URL(String(config.baseURL || '').trim());
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Use a local HTTP address without credentials.');
  const model = String(config.model || '').trim();
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error('Enter a valid model ID.');
  const icon = config.icon || 'default';
  if (typeof icon !== 'string' || (!iconIds.has(icon) && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon)) || icon.length > 1500000) throw new Error('Invalid local icon.');
  const name = String(config.name || model).trim(); if (!name || name.length > 100 || /[\r\n]/.test(name)) throw new Error('Enter a valid provider name.');
  return { baseURL: url.toString().replace(/\/+$/, ''), model, icon, name }; 
}
function save(config) { const value = validate(config); const items = list(); const index = items.findIndex(item => item.model.toLowerCase() === value.model.toLowerCase() || item.name.toLowerCase() === value.name.toLowerCase()); if (index >= 0) items[index] = value; else items.push(value); write(items); return value; }
function remove(model) { const items = list(); const next = items.filter(item => item.model !== model); if (next.length === items.length) throw new Error('Local model not found.'); write(next); return next; }
async function check(config) {
  const value = validate(config);
  try { const response = await fetch(value.baseURL + '/models', { signal: AbortSignal.timeout(4000) }); if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`); const json = await response.json(); const ids = Array.isArray(json.data) ? json.data.map(x => x.id).filter(Boolean) : []; return { ok: true, models: ids, matches: ids.includes(value.model) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}
function envConfig(value) { return JSON.stringify({ provider: { 'dispatch-local': { npm: '@ai-sdk/openai-compatible', name: 'Dispatch Local AI', options: { baseURL: value.baseURL }, models: { [value.model]: { name: value.model, limit: { context: 16384, output: 4096 } } } } } }); }
module.exports = { read, list, save, remove, check, envConfig };
