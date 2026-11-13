// JSON wire format for remote mode: binary values travel as { __bin: base64, t: 'ab' | 'u8' }.
// preload.cjs carries a browser copy of the same two functions (sandboxed preloads cannot require files).
function encode(v) {
  if (v instanceof ArrayBuffer) return { __bin: Buffer.from(v).toString('base64'), t: 'ab' };
  if (ArrayBuffer.isView(v)) return { __bin: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64'), t: 'u8' };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object' && !(v instanceof Date)) { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') o[k] = encode(x); return o; }
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (typeof v.__bin === 'string') { const b = Buffer.from(v.__bin, 'base64'); return v.t === 'ab' ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b; }
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o;
  }
  return v;
}
module.exports = { encode, decode };
