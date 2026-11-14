const test = require('node:test');
const assert = require('node:assert');
const { listen, previewFrame } = require('./comfy-live.cjs');

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

test('comfy live: preview frames, both formats', () => {
  const jpg = previewFrame(Buffer.concat([u32(1), u32(1), Buffer.from([0xff, 0xd8, 1])]));
  assert.equal(jpg.mime, 'image/jpeg'); assert.equal(jpg.data.length, 3);
  const meta = Buffer.from(JSON.stringify({ image_type: 'image/png', prompt_id: 'p1' }));
  const png = previewFrame(Buffer.concat([u32(4), u32(meta.length), meta, Buffer.from([0x89, 0x50])]));
  assert.equal(png.mime, 'image/png'); assert.equal(png.promptId, 'p1'); assert.equal(png.data.length, 2);
  assert.equal(previewFrame(Buffer.from([0, 0])), null);
  assert.equal(previewFrame(Buffer.concat([u32(9), u32(0)])), null);
});

test('comfy live: progress, preview and done events for the running prompt', () => {
  let sock;
  class FakeWS { constructor(url) { this.url = url; sock = this; } close() {} }
  const events = [];
  const stop = listen('http://127.0.0.1:8188/', 'abc', e => events.push(e), { WebSocketImpl: FakeWS, previewEveryMs: 0 });
  assert.equal(sock.url, 'ws://127.0.0.1:8188/ws?clientId=abc');
  sock.onmessage({ data: JSON.stringify({ type: 'executing', data: { node: '3', prompt_id: 'p1' } }) });
  sock.onmessage({ data: JSON.stringify({ type: 'progress', data: { value: 5, max: 20, prompt_id: 'p1', node: '3' } }) });
  { const b = Buffer.concat([u32(1), u32(1), Buffer.from([1, 2, 3])]); sock.onmessage({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }); }
  sock.onmessage({ data: JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }) });
  stop();
  assert.deepEqual(events[0], { id: 'p1', node: '3' });
  assert.deepEqual(events[1], { id: 'p1', value: 5, max: 20, node: '3' });
  assert.match(events[2].preview, /^data:image\/jpeg;base64,/);
  assert.deepEqual(events[3], { id: 'p1', done: true });
});
