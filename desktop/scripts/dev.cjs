const { spawn } = require('node:child_process');
const path = require('node:path');
const vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['exec', 'vite', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', shell: process.platform === 'win32' });
let electron;
const timer = setInterval(async () => { try { await fetch('http://127.0.0.1:5173'); clearInterval(timer); electron = spawn(require('electron'), ['.', ...process.argv.slice(2)], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' } }); electron.on('exit', code => { vite.kill(); process.exit(code ?? 0); }); } catch {} }, 300);
process.on('SIGINT', () => { vite.kill(); electron?.kill(); process.exit(); });
