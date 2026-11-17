const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Remote mode: when this Dispatch is connected to another computer, calls go there over HTTP and
// events arrive over Server-Sent Events (see electron/remote.cjs). Otherwise everything is plain IPC.
const target = ipcRenderer.sendSync('remote:target');
const LOCAL = /^(remote:|overlay:|tray:)/;
const LOCAL_EVENTS = new Set(['tabs', 'tab-shown', 'window-fullscreen', 'voice-toggle', 'voice-result', 'voice-live', 'tray-nav', 'pack-open', 'overlay-start', 'overlay-stop']);
const clientId = crypto.randomUUID();
const listeners = new Map(), stateFns = new Set();
let state = target ? 'connecting' : 'local', error = '', base = '', events = null, dialogFn = null, sendChain = Promise.resolve();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
function encode(v) {
  if (v instanceof ArrayBuffer) return { __bin: b64(new Uint8Array(v)), t: 'ab' };
  if (ArrayBuffer.isView(v)) return { __bin: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)), t: 'u8' };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') o[k] = encode(x); return o; }
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') { if (typeof v.__bin === 'string') { const u8 = unb64(v.__bin); return v.t === 'ab' ? u8.buffer : u8; } const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o; }
  return v;
}
const setState = (s, e = '') => { state = s; error = e; const snap = { state, error, target }; for (const fn of stateFns) try { fn(snap); } catch {} };
const url = p => `${base}${p}?token=${encodeURIComponent(target.token)}&client=${clientId}`;
async function post(p, payload) {
  const res = await fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status !== 200 || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
function openEvents() {
  if (events) events.close();
  events = new EventSource(url('/events'));
  events.onopen = () => setState('connected');
  events.onmessage = e => {
    const { channel, value } = JSON.parse(e.data), v = decode(value);
    if (channel === 'remote:dialog') { if (v.client === clientId && dialogFn) dialogFn(v); return; }
    for (const fn of listeners.get(channel) || []) try { fn(v); } catch (err) { console.error(err); }
  };
  // EventSource retries by itself after a drop; a closed source (wrong link) does not.
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) { setState('failed', 'The other computer refused the connection. Its link may have changed.'); return; }
    if (state === 'connected') setState('lost');
  };
}
async function connect() {
  setState('connecting');
  const r = await ipcRenderer.invoke('remote:reach').catch(e => ({ ok: false, error: String(e) }));
  if (!r.ok) return setState('failed', r.error);
  Object.assign(target, r.target);
  base = `http://${target.hosts[0]}:${target.port}`;
  openEvents();
}
if (target) void connect();
const invoke = (channel, ...args) => (!target || LOCAL.test(channel)) ? ipcRenderer.invoke(channel, ...args) : post('/invoke', { channel, args: encode(args) }).then(j => decode(j.value));
// Fire-and-forget calls (terminal keystrokes) stay in order.
const send = (channel, ...args) => { if (!target || LOCAL.test(channel)) return ipcRenderer.send(channel, ...args); sendChain = sendChain.then(() => post('/send', { channel, args: encode(args) })).catch(() => {}); };
const on = (event, fn) => {
  if (!target || LOCAL_EVENTS.has(event)) { const handler = (_event, value) => fn(value); ipcRenderer.on(event, handler); return () => ipcRenderer.removeListener(event, handler); }
  const set = listeners.get(event) || listeners.set(event, new Set()).get(event); set.add(fn); return () => set.delete(fn);
};
const remoteApi = {
  state: () => ({ state, error, target }),
  onState: fn => { stateFns.add(fn); return () => stateFns.delete(fn); },
  retry: () => connect(),
  connect: link => ipcRenderer.invoke('remote:connect', link),
  disconnect: () => ipcRenderer.invoke('remote:disconnect'),
  status: () => ipcRenderer.invoke('remote:status'),
  share: on => ipcRenderer.invoke('remote:share', on),
  newLink: () => ipcRenderer.invoke('remote:new-link'),
  loginItem: on => ipcRenderer.invoke('remote:login-item', on),
  onDialog: fn => { dialogFn = fn; return () => { if (dialogFn === fn) dialogFn = null; }; },
  answerDialog: (id, result) => post('/dialog', { id, result }).catch(() => {}),
  list: dir => invoke('remote-fs:list', dir),
};
contextBridge.exposeInMainWorld('army', {
  info: () => invoke('info'), output: name => invoke('output', name), workspace: target => invoke('workspace', target), operations: { list: () => invoke('operations:list'), resume: id => invoke('operations:resume', id), remove: id => invoke('operations:delete', id) }, start: (template, team) => invoke('start', template, team), resetOperation: () => invoke('operation:reset'), teams: { list: () => invoke('teams:list'), save: t => invoke('teams:save', t), saveCurrent: (name, scope) => invoke('teams:save-current', name, scope), remove: f => invoke('teams:remove', f) }, tasks: { list: () => invoke('tasks:list') }, workflows: { list: () => invoke('workflows:list'), save: w => invoke('workflows:save', w), remove: f => invoke('workflows:remove', f) }, changeBoss: (template, agent) => invoke('boss:change', template, agent), isWorking: name => invoke('agent:working', name), send: (to, text) => invoke('send', to, text), input: (name, data) => send('input', name, data), resize: (name, cols, rows) => send('resize', name, cols, rows),
  bossProviders: { get: () => invoke('boss-providers:get'), save: value => invoke('boss-providers:set', value) },
  memory: { get: () => invoke('memory:get'), settings: patch => invoke('memory:settings', patch), save: (scope, entity, isNew) => invoke('memory:save', scope, entity, isNew), remove: (scope, name) => invoke('memory:delete', scope, name), relation: (scope, relation, remove) => invoke('memory:relation', scope, relation, remove), reveal: scope => invoke('memory:reveal', scope), clearActivity: () => invoke('memory:clear-activity') },
  skills: { list: () => invoke('skills:list'), settings: patch => invoke('skills:settings', patch), board: () => invoke('skills:board'), saveBoard: board => invoke('skills:board-save', board), preview: input => invoke('skills:preview', input), chooseFolder: () => invoke('skills:choose-folder'), install: (id, names, scope) => invoke('skills:install', id, names, scope), discard: id => invoke('skills:discard', id), update: (name, scope) => invoke('skills:update', name, scope), enabled: (name, scope, on) => invoke('skills:enabled', name, scope, on), remove: (name, scope) => invoke('skills:remove', name, scope), reveal: (name, scope) => invoke('skills:reveal', name, scope), read: (name, scope) => invoke('skills:read', name, scope), claude: () => invoke('skills:claude'), claudeRead: id => invoke('skills:claude-read', id), claudeReveal: id => invoke('skills:claude-reveal', id), claudeRemove: id => invoke('skills:claude-remove', id) },
  packs: { inventory: () => invoke('packs:inventory'), export: (selection, meta, target) => invoke('packs:export', selection, meta, target), choose: () => invoke('packs:choose'), open: file => invoke('packs:open', file), pending: () => invoke('packs:pending'), discard: id => invoke('packs:discard', id), reveal: file => invoke('packs:reveal', file), import: (id, choice, newFolder) => invoke('packs:import', id, choice, newFolder) },
  schedules: { list: () => invoke('schedules:list'), status: (id, status) => invoke('schedules:status', id, status), remove: id => invoke('schedules:remove', id), runNow: id => invoke('schedules:run-now', id) },
  // Project tabs live in this window only, never on a remote computer.
  tabs: { list: () => ipcRenderer.invoke('tabs:list'), open: folder => ipcRenderer.invoke('tabs:open', folder), switch: id => ipcRenderer.invoke('tabs:switch', id), step: dir => ipcRenderer.invoke('tabs:step', dir), close: id => ipcRenderer.invoke('tabs:close', id), move: (id, to) => ipcRenderer.invoke('tabs:move', id, to) },
  update: { status: () => invoke('update:status'), check: () => invoke('update:check'), install: () => invoke('update:install') },
  telegram: { status: () => invoke('telegram:status'), setToken: t => invoke('telegram:set-token', t), link: () => invoke('telegram:link'), unlink: () => invoke('telegram:unlink'), disconnect: () => invoke('telegram:disconnect'), test: () => invoke('telegram:test'), botfather: () => invoke('telegram:botfather'), clipboardToken: () => invoke('telegram:clipboard-token'), owner: () => invoke('telegram:owner'), setOwner: name => invoke('telegram:set-owner', name) },
  voice: { status: () => invoke('voice:status'), warm: () => invoke('voice:warm'), transcribe: wav => invoke('voice:transcribe', wav), overlayDone: text => send('overlay:done', text), overlayLive: text => send('overlay:live', text), overlayClose: () => send('overlay:close') },
  ui: { get: () => invoke('ui:get'), set: patch => invoke('ui:set', patch) },
  devMock: () => invoke('dev:mock'), devUnmock: () => invoke('dev:unmock'),
  mcpStatus: () => invoke('mcp:status'),
  tools: { status: () => invoke('tools:status'), start: () => invoke('tools:start'), stop: () => invoke('tools:stop'), choosePath: () => invoke('tools:choose-path'), install: id => invoke('tools:install', id), uninstall: id => invoke('tools:install', id, 'uninstall'), canUninstall: () => invoke('tools:can-uninstall'), unrealDisable: () => invoke('tools:unreal-disable'), file: id => invoke('tools:file', id), reveal: id => invoke('tools:reveal', id), voiceStatus: () => invoke('tools:voice-status'), voiceStart: () => invoke('tools:voice-start'), voiceChoose: () => invoke('tools:voice-choose'), unrealStatus: () => invoke('tools:unreal-status'), blenderStatus: () => invoke('tools:blender-status'), blenderStart: () => invoke('tools:blender-start'), blenderChoose: () => invoke('tools:blender-choose'), unrealChoose: () => invoke('tools:unreal-choose'), unrealEnable: () => invoke('tools:unreal-enable'), unrealOpen: () => invoke('tools:unreal-open') },
  media: { watch: on => invoke('media:watch', !!on), control: cmd => invoke('media:control', cmd) },
  chatImage: { get: file => invoke('chat:image', file), open: file => invoke('chat:open-image', file) },
  outputs: { list: () => invoke('outputs:list'), preview: file => invoke('outputs:preview', file), reveal: file => invoke('outputs:reveal', file) },
  localAI: { list: () => invoke('local-ai:list'), remove: model => invoke('local-ai:remove', model), chooseIcon: () => invoke('local-ai:choose-icon'), get: () => invoke('local-ai:get'), save: config => invoke('local-ai:save', config), check: config => invoke('local-ai:check', config) },
  attachmentPreview: path => invoke('attachments:preview', path),
  // Path of a dropped/picked file on this computer; empty in remote mode (the other computer cannot read it).
  pathFor: file => { if (target) return ''; try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  saveAttachments: files => invoke('attachments:save', files),
  attention: { list: () => invoke('attention:list'), trust: () => invoke('attention:trust') },
  customTools: { list: () => invoke('custom-tools:list'), save: t => invoke('custom-tools:save', t), remove: id => invoke('custom-tools:remove', id), start: id => invoke('custom-tools:start', id), stop: id => invoke('custom-tools:stop', id), chooseFile: () => invoke('custom-tools:choose-file'), chooseFolder: () => invoke('custom-tools:choose-folder') },
  questions: { list: () => invoke('questions:list'), answer: (name, answers) => invoke('question:answer', name, answers) },
  enlist: (name, template, task) => invoke('enlist', name, template, task), debugAgent: name => invoke('debug:agent', name),
  chats: { list: name => invoke('chats:list', name), switch: (name, id) => invoke('chats:switch', name, id) },
  agentAction: (name, action) => invoke('agent:action', name, action),
  setModel: (name, model) => invoke('agent:set-model', name, model),
  gitChanges: () => invoke('git:changes'),
  shells: { choices: () => invoke('terminal:shells'), list: () => invoke('shell:list'), open: () => invoke('shell:open'), close: name => invoke('shell:close', name), rename: (name, title) => invoke('shell:rename', name, title) },
  files: { list: rel => invoke('files:list', rel), read: rel => invoke('files:read', rel), write: (rel, text) => invoke('files:write', rel, text), import: (dir, items) => invoke('files:import', dir, items), head: rel => invoke('files:head', rel), lint: (rel, text) => invoke('files:lint', rel, text), lsp: { open: (lang, rel, text) => invoke('lsp:open', lang, rel, text), change: (lang, rel, version, text) => invoke('lsp:change', lang, rel, version, text), close: (lang, rel) => invoke('lsp:close', lang, rel), request: (lang, method, rel, position) => invoke('lsp:request', lang, method, rel, position) }, all: () => invoke('files:all'), search: (q, opts) => invoke('files:search', q, opts), watch: on => invoke('files:watch', on), reveal: rel => invoke('files:reveal', rel), context: (rel, isDir) => invoke('files:context', rel, isDir), act: (action, rels) => invoke('files:act', action, rels) },
  setEffort: (name, effort) => invoke('agent:set-effort', name, effort),
  setPermission: (name, permission) => invoke('agent:set-permission', name, permission),
  usage: { get: () => invoke('usage:get'), refresh: id => invoke('usage:refresh', id) },
  providers: { list: () => invoke('providers:list'), check: id => invoke('providers:check', id), updateInfo: (id, v) => invoke('providers:update-info', id, v), models: id => invoke('providers:models', id), action: (id, kind) => invoke('providers:action', id, kind), close: name => invoke('providers:close', name) },
  accounts: { list: provider => invoke('accounts:list', provider), add: (provider, label) => invoke('accounts:add', provider, label), activate: (provider, id) => invoke('accounts:activate', provider, id), rename: (provider, id, label) => invoke('accounts:rename', provider, id, label), remove: (provider, id) => invoke('accounts:remove', provider, id) },
  bossSwitch: opts => invoke('boss:switch', opts),
  templates: { getVisibility: () => invoke('templates:visibility:get'), setVisibility: files => invoke('templates:visibility:set', files), list: () => invoke('templates:list'), save: t => invoke('templates:save', t), saveAgent: (agent, name, scope) => invoke('templates:save-agent', agent, name, scope),remove: file => invoke('templates:delete', file), reveal: file => invoke('templates:reveal', file) },
  servers: { list: () => invoke('servers:list'), save: s => invoke('servers:save', s), remove: id => invoke('servers:remove', id), order: ids => invoke('servers:order', ids), test: s => invoke('servers:test', s), connect: id => invoke('servers:connect', id), chooseKey: () => invoke('servers:choose-key'), chooseIcon: () => invoke('servers:choose-icon'), approve: (id, ok) => invoke('servers:approve', id, ok), pending: () => invoke('servers:pending'), log: () => invoke('servers:log') },
  connectors: { catalog: () => invoke('connectors:catalog'), list: () => invoke('connectors:list'), connect: input => invoke('connectors:connect', input), cancel: id => invoke('connectors:cancel', id), remove: id => invoke('connectors:remove', id), check: id => invoke('connectors:check', id) },
  vpns: { list: () => invoke('vpns:list'), save: v => invoke('vpns:save', v), remove: id => invoke('vpns:remove', id), test: (v, host, port) => invoke('vpns:test', v, host, port), chooseConf: () => invoke('vpns:choose-conf') },
  ready: () => invoke('app:ready'),
  remote: remoteApi,
  on
});
