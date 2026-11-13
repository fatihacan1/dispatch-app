const { spawn } = require('node:child_process');
const path = require('node:path');
function createDemoTerminal(name, workspace, bin) {
 const child = spawn(process.execPath, [path.join(__dirname, 'fake.cjs'), name, bin], { cwd: workspace, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DISPATCH_AGENT: name, MYARMY_AGENT: name, DISPATCH_HOME: path.join(workspace, '.dispatch'), MYARMY_HOME: path.join(workspace, '.dispatch') }, stdio: ['pipe', 'pipe', 'pipe'] });
 return { onData(fn) { child.stdout.on('data', d => fn(d.toString())); child.stderr.on('data', d => fn(d.toString())); }, onExit(fn) { child.on('exit', fn); }, write(data) { child.stdin.write(data.replace(/\r/g, '\n').replace(/\x1b\[20[01]~/g, '')); }, resize() {}, kill() { child.kill(); } };
}
module.exports = { createDemoTerminal };
