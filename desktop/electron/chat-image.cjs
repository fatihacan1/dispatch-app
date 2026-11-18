// Media an agent shows in the chat: only real files inside the allowed folders, only common image/video/audio types.
const fs = require('node:fs');
const path = require('node:path');

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4' };
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' };
const MAX = 15 * 1024 * 1024;
const MAX_MEDIA = 500 * 1024 * 1024;
const real = p => { try { return fs.realpathSync.native(p); } catch { return null; } };
const under = (root, file) => { const r = root && real(root); if (!r) return false; const a = file.toLowerCase(), b = r.toLowerCase(); return a === b ? false : a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); };

function mediaKind(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (IMAGE_TYPES[ext]) return 'image';
  if (VIDEO_TYPES[ext]) return 'video';
  if (AUDIO_TYPES[ext]) return 'audio';
  return null;
}
function mediaMime(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  return IMAGE_TYPES[ext] || VIDEO_TYPES[ext] || AUDIO_TYPES[ext] || null;
}

/** Resolved file metadata when `file` is an allowed image, video, or audio under one of `roots`, else null. */
function mediaInfo(file, roots) {
  if (typeof file !== 'string' || !file.trim() || file.length > 2000) return null;
  const full = real(path.resolve(file.trim()));
  const kind = full && mediaKind(full);
  const mime = full && mediaMime(full);
  if (!full || !kind || !mime) return null;
  if (!Array.isArray(roots) || !roots.some(r => under(r, full))) return null;
  const max = kind === 'image' ? MAX : MAX_MEDIA;
  try {
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > max) return null;
    return { path: full, kind, mime, size: st.size };
  } catch { return null; }
}

/** The resolved real path when `file` is an allowed media file under one of `roots`, else null. */
function allowedMedia(file, roots) {
  return mediaInfo(file, roots)?.path || null;
}

/** The resolved real path when `file` is an allowed image under one of `roots`, else null. Symlinks are followed before the check. */
function allowedImage(file, roots) {
  const info = mediaInfo(file, roots);
  return info && info.kind === 'image' ? info.path : null;
}

/** data: URL for an allowed image, or null. */
function imageData(file, roots) {
  const full = allowedImage(file, roots); if (!full) return null;
  try { return `data:${IMAGE_TYPES[path.extname(full).toLowerCase()]};base64,${fs.readFileSync(full).toString('base64')}`; } catch { return null; }
}

/** Parse a single HTTP `Range: bytes=...` header against `size`, returning `{ start, end }` or null. */
function parseRange(header, size) {
  if (typeof header !== 'string' || !Number.isFinite(size) || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start, end;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end >= size) return null;
  return { start, end };
}

module.exports = { allowedImage, allowedMedia, imageData, mediaInfo, mediaKind, mediaMime, parseRange, MAX, MAX_MEDIA };
