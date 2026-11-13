const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const createRemote = require('./remote.cjs');

function fakeElectron() {
  const handles = new Map(), ons = new Map();
  const ipcMain = { handle: (c, fn) => handles.set(c, fn), on: (c, fn) => ons.set(c, fn) };
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: ['LOCAL'] }), showSaveDialog: async () => ({ canceled: true }) };
  const sent = [];
  const win = { webContents: { send: (c, v) => sent.push([c, v]) } };
  const electron = { powerSaveBlocker: { start: () => 1, stop: () => {} }, app: { getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: () => {} } };
  return { ipcMain, dialog, win, electron, handles, ons, sent };
}
const req = (port, method, p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'Content-Type': 'text/plain' } }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(c).toString() || '{}') })); });
  r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
});

test('remote: invoke, send, events, binary and dialog bridge over HTTP', async () => {
  const f = fakeElectron();
  const remote = createRemote(f.ipcMain, f.dialog);
  let typed = '';
  f.ipcMain.handle('echo', (_e, a, b) => ({ a, size: b.byteLength, isAb: b instanceof ArrayBuffer }));
  f.ipcMain.handle('fail', () => { throw new Error('nope'); });
  f.ipcMain.handle('pick', async () => (await f.dialog.showOpenDialog({}, { title: 'Pick', properties: ['openDirectory'] })).filePaths[0]);
  f.ipcMain.on('input', (_e, name, data) => { typed += name + data; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
  fs.writeFileSync(path.join(dir, 'remote.json'), JSON.stringify({ port: 7491 }));
  remote.attach(f.win, dir, f.electron);
  const st = await f.handles.get('remote:share')({}, true);
  assert.ok(st.share && st.link.startsWith('dispatch://'));
  const token = st.link.match(/\/([a-f0-9]+)\?/)[1];
  const q = `?token=${token}&client=c1`;
  try {
    assert.equal((await req(7491, 'GET', '/ping?token=bad')).status, 401);
    assert.equal((await req(7491, 'GET', '/ping' + q)).json.ok, true);
    const echo = await req(7491, 'POST', '/invoke' + q, { channel: 'echo', args: ['hi', { __bin: Buffer.from('abc').toString('base64'), t: 'ab' }] });
    assert.deepEqual(echo.json.value, { a: 'hi', size: 3, isAb: true });
    assert.equal((await req(7491, 'POST', '/invoke' + q, { channel: 'fail', args: [] })).json.error, 'nope');
    assert.equal((await req(7491, 'POST', '/invoke' + q, { channel: 'remote:share', args: [false] })).status, 403);
    await req(7491, 'POST', '/send' + q, { channel: 'input', args: ['boss', 'x'] });
    assert.equal(typed, 'bossx');
    // Events and the dialog bridge share the SSE stream.
    const lines = [];
    const sse = await new Promise(resolve => http.get({ host: '127.0.0.1', port: 7491, path: '/events' + q }, res => { res.on('data', d => lines.push(...String(d).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6))))); resolve(res); }));
    await new Promise(r => setTimeout(r, 50));
    f.win.webContents.send('message', { text: 'yo' });
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(lines.find(l => l.channel === 'message').value, { text: 'yo' });
    assert.deepEqual(f.sent.at(-1), ['message', { text: 'yo' }]);
    const picked = req(7491, 'POST', '/invoke' + q, { channel: 'pick', args: [] });
    let ask; for (let i = 0; i < 40 && !ask; i++) { await new Promise(r => setTimeout(r, 25)); ask = lines.find(l => l.channel === 'remote:dialog'); }
    assert.equal(ask.value.client, 'c1');
    assert.equal(ask.value.options.title, 'Pick');
    await req(7491, 'POST', '/dialog' + q, { id: ask.value.id, result: { canceled: false, filePaths: ['/Users/me/proj'] } });
    assert.equal((await picked).json.value, '/Users/me/proj');
    // A local (non-remote) call still opens the real dialog.
    assert.equal(await f.handles.get('pick')(), 'LOCAL');
    const listing = await req(7491, 'POST', '/invoke' + q, { channel: 'remote-fs:list', args: [dir] });
    assert.ok(listing.json.value.entries.some(e => e.name === 'remote.json'));
    sse.destroy();
  } finally { remote.stop(); }
});

test('remote: parses share links', () => {
  const { parseLink } = createRemote({ handle() {}, on() {} }, {})._test;
  assert.deepEqual(parseLink('dispatch://192.168.1.5:7420/abc123?name=Mac&alt=Mac.local'), { hosts: ['192.168.1.5', 'Mac.local'], port: 7420, token: 'abc123', name: 'Mac' });
  assert.throws(() => parseLink('http://x'));
});
