const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { allowedImage, allowedMedia, imageData, mediaInfo, parseRange } = require('./chat-image.cjs');

test('chat images: only allowed folders, image types and real files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-image-'));
  try {
    const root = path.join(dir, '.dispatch'); fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
    const png = path.join(root, 'outputs', 'shot one.png'); fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const txt = path.join(root, 'outputs', 'note.txt'); fs.writeFileSync(txt, 'x');
    const outside = path.join(dir, 'secret.png'); fs.writeFileSync(outside, 'x');
    assert.ok(allowedImage(png, [root]));
    assert.match(imageData(png, [root]), /^data:image\/png;base64,/);
    assert.equal(allowedImage(txt, [root]), null);
    assert.equal(allowedImage(outside, [root]), null);
    assert.equal(allowedImage(path.join(root, 'outputs', '..', '..', 'secret.png'), [root]), null);
    assert.equal(allowedImage(path.join(root, 'outputs', 'missing.png'), [root]), null);
    assert.equal(allowedImage('', [root]), null);
    assert.equal(allowedImage(png, []), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('chat media: allows video and audio extensions inside allowed folders only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-media-'));
  try {
    const root = path.join(dir, '.dispatch');
    const out = path.join(root, 'outputs', 'media');
    fs.mkdirSync(out, { recursive: true });
    for (const ext of ['.mp4', '.webm', '.mov', '.m4v']) {
      const f = path.join(out, `clip${ext}`);
      fs.writeFileSync(f, Buffer.from('video'));
      const info = mediaInfo(f, [root]);
      assert.equal(info?.kind, 'video');
      assert.ok(allowedMedia(f, [root]));
      assert.equal(allowedImage(f, [root]), null);
    }
    for (const ext of ['.mp3', '.wav', '.ogg', '.m4a', '.flac']) {
      const f = path.join(out, `track${ext}`);
      fs.writeFileSync(f, Buffer.from('audio'));
      const info = mediaInfo(f, [root]);
      assert.equal(info?.kind, 'audio');
      assert.ok(allowedMedia(f, [root]));
      assert.equal(allowedImage(f, [root]), null);
    }
    const outside = path.join(dir, 'secret.mp4');
    fs.writeFileSync(outside, Buffer.from('nope'));
    assert.equal(allowedMedia(outside, [root]), null);
    assert.equal(allowedMedia(path.join(out, '..', '..', '..', 'secret.mp4'), [root]), null);
    const exe = path.join(out, 'run.exe');
    fs.writeFileSync(exe, 'x');
    assert.equal(allowedMedia(exe, [root]), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('parseRange handles open, bounded, suffix, and invalid byte ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=0-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseRange('bytes=-2000', 1000), { start: 0, end: 999 });
  assert.equal(parseRange('bytes=1000-1001', 1000), null);
  assert.equal(parseRange('bytes=200-100', 1000), null);
  assert.equal(parseRange('bytes=-0', 1000), null);
  assert.equal(parseRange('items=0-10', 1000), null);
  assert.equal(parseRange('bytes=0-10', 0), null);
});
