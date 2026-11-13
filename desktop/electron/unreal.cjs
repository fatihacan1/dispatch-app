// Unreal Engine 5.8+: Epic's experimental "Unreal MCP" plugin runs an HTTP MCP server inside the editor.
// Dispatch finds the engine, turns the plugin and its agent toolsets on in a project, opens the editor and checks the endpoint.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readSettings, writeSettings } = require('./tools.cjs');

const DEFAULT_URL = 'http://127.0.0.1:8000/mcp';
// ModelContextProtocol = the server; the toolsets are what agents can actually call.
const PLUGINS = ['ModelContextProtocol', 'ToolsetRegistry', 'EditorToolset', 'LiveCodingToolset', 'AutomationTestToolset'];

// The launcher list can miss engines (e.g. after a Windows reinstall), so the usual folders are scanned too.
function scannedInstalls() {
  const roots = ['C', 'D', 'E', 'F'].flatMap(d => [`${d}:\\Program Files\\Epic Games`, `${d}:\\Epic Games`]);
  return roots.flatMap(r => { try { return fs.readdirSync(r).filter(n => /^UE_\d/.test(n)).map(n => ({ version: n.slice(3), root: path.join(r, n) })); } catch { return []; } })
    .filter(i => fs.existsSync(editorExe(i.root)));
}
function installs() {
  const seen = new Set();
  return [...launcherInstalls(), ...scannedInstalls()].filter(i => { const k = path.resolve(i.root).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
function launcherInstalls() {
  try {
    const file = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat');
    return JSON.parse(fs.readFileSync(file, 'utf8')).InstallationList
      .filter(i => /^UE_\d/.test(i.AppName) && fs.existsSync(editorExe(i.InstallLocation)))
      .map(i => ({ version: i.AppName.slice(3), root: i.InstallLocation }));
  } catch { return []; }
}
const editorExe = root => path.join(root, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
const hasMcpPlugin = root => fs.existsSync(path.join(root, 'Engine', 'Plugins', 'Experimental', 'ModelContextProtocol', 'ModelContextProtocol.uplugin'));

function config() {
  const s = readSettings().unreal || {};
  const engines = installs().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const engine = engines.find(e => hasMcpPlugin(e.root)) || null;
  return { engines, engine, project: s.project && fs.existsSync(s.project) ? s.project : '', url: s.url || DEFAULT_URL };
}
const url = () => config().url;

function readProject(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function enabledPlugins(file) {
  try { const p = readProject(file); return PLUGINS.filter(n => (p.Plugins || []).some(x => x.Name === n && x.Enabled)); } catch { return []; }
}

// Any HTTP answer from the endpoint means the editor is up with the plugin running.
async function reachable(u) {
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), signal: AbortSignal.timeout(1500) });
    return r.status > 0;
  } catch { return false; }
}

async function status() {
  const c = config();
  const enabled = c.project ? enabledPlugins(c.project) : [];
  return {
    installed: !!c.engine, version: c.engine?.version || '', engines: c.engines.map(e => e.version), url: c.url,
    project: c.project, projectName: c.project ? path.basename(c.project, '.uproject') : '',
    pluginsEnabled: !!c.project && enabled.length === PLUGINS.length && serverAutoStarts(c.project), running: await reachable(c.url),
  };
}

function setProject(file) {
  if (!/\.uproject$/i.test(file) || !fs.existsSync(file)) throw new Error('Choose a .uproject file.');
  readProject(file);
  const s = readSettings(); s.unreal = { ...(s.unreal || {}), project: file }; writeSettings(s);
}

// Adds the plugins to the project (or switches them on). The original file is kept as .uproject.bak.
function enablePlugins() {
  const { project } = config();
  if (!project) throw new Error('Choose a project first.');
  const raw = fs.readFileSync(project, 'utf8');
  const p = JSON.parse(raw);
  p.Plugins = Array.isArray(p.Plugins) ? p.Plugins : [];
  for (const name of PLUGINS) {
    const hit = p.Plugins.find(x => x.Name === name);
    if (hit) hit.Enabled = true; else p.Plugins.push({ Name: name, Enabled: true });
  }
  fs.writeFileSync(project + '.bak', raw);
  fs.writeFileSync(project, JSON.stringify(p, null, '\t') + '\n');
  autoStartServer(project);
  return true;
}

// The plugin does not start its server on its own: without this the endpoint refuses connections even with the editor open.
const SERVER_SECTION = '[/Script/ModelContextProtocolEngine.ModelContextProtocolSettings]';
function autoStartServer(project) {
  const port = Number(new URL(config().url).port) || 8000;
  const file = path.join(path.dirname(project), 'Config', 'DefaultEditorPerProjectUserSettings.ini');
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const body = `${SERVER_SECTION}\nbAutoStartServer=True\nServerPortNumber=${port}\n`;
  const start = text.indexOf(SERVER_SECTION);
  if (start >= 0) {
    const next = text.indexOf('\n[', start + 1);
    text = text.slice(0, start) + body + (next >= 0 ? text.slice(next + 1) : '');
  } else text = (text && !text.endsWith('\n') ? text + '\n' : text) + (text ? '\n' : '') + body;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function serverAutoStarts(project) {
  try { const t = fs.readFileSync(path.join(path.dirname(project), 'Config', 'DefaultEditorPerProjectUserSettings.ini'), 'utf8'); const i = t.indexOf(SERVER_SECTION); return i >= 0 && /bAutoStartServer=True/i.test(t.slice(i, (t.indexOf('\n[', i + 1) + 1 || t.length + 1) - 1)); } catch { return false; }
}

function openEditor() {
  const { engine, project } = config();
  if (!engine) throw new Error('Unreal Engine 5.8 or newer was not found.');
  if (!project) throw new Error('Choose a project first.');
  spawn(editorExe(engine.root), [project], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

module.exports = { DEFAULT_URL, PLUGINS, config, url, status, setProject, enablePlugins, openEditor, editorExe };
