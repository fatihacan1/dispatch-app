// Images an agent shows in the chat with ![alt](path): only real files inside the allowed folders, only common image types.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX = 15 * 1024 * 1024;
const real = p => { try { return fs.realpathSync.native(p); } catch { return null; } };
const under = (root, file) => { const r = root && real(root); if (!r) return false; const a = file.toLowerCase(), b = r.toLowerCase(); return a === b ? false : a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };

/** The resolved real path when `file` is an allowed image under one of `roots`, else null. Symlinks are followed before the check. */
function allowedImage(file, roots) {
  if (typeof file !== 'string' || !file.trim() || file.length > 2000) return null;
  const full = real(path.resolve(file.trim()));
  if (!full || !TYPES[path.extname(full).toLowerCase()]) return null;
  if (!roots.some(r => under(r, full))) return null;
  try { const st = fs.statSync(full); if (!st.isFile() || st.size > MAX) return null; } catch { return null; }
  return full;
}
/** data: URL for an allowed image, or null. */
function imageData(file, roots) {
  const full = allowedImage(file, roots); if (!full) return null;
  try { return `data:${TYPES[path.extname(full).toLowerCase()]};base64,${fs.readFileSync(full).toString('base64')}`; } catch { return null; }
}
module.exports = { allowedImage, imageData, MAX };
