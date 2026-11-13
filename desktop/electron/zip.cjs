// Minimal ZIP writer/reader (deflate or store, no ZIP64, no encryption) on node:zlib.
// Used for .dispatch packs, so they open in any unzip tool too.
const zlib = require('node:zlib');

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** entries: [{ name: 'a/b.txt', data: Buffer|string }] -> Buffer */
function write(entries) {
  const locals = [], centrals = []; let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw, method = useDeflate ? 8 : 0, crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Buffer -> [{ name, data }]. Rejects unsafe names and archives that unpack to more than maxBytes. */
function read(buf, { maxEntries = 5000, maxBytes = 300 * 1024 * 1024 } = {}) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a Dispatch pack (no ZIP directory found).');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new Error('This pack has too many files.');
  const out = []; let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The pack is damaged.');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (!safeName(name)) throw new Error(`The pack contains an unsafe path: ${name}`);
    total += size; if (total > maxBytes) throw new Error('The pack is too large to open.');
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: Math.max(size, 1) }) : null;
    if (!data) throw new Error(`Unsupported compression in ${name}.`);
    if (crc32(data) !== crc) throw new Error(`The pack is damaged (${name}).`);
    out.push({ name, data });
  }
  return out;
}
const safeName = n => n && !n.startsWith('/') && !/^[A-Za-z]:/.test(n) && !n.split('/').some(s => s === '..' || s === '') && !/[\x00-\x1f<>:"|?*]/.test(n);

module.exports = { write, read, crc32, safeName };
