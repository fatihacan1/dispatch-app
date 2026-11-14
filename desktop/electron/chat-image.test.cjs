const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { allowedImage, imageData } = require('./chat-image.cjs');

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
