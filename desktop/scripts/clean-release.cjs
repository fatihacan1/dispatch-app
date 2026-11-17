// Keeps only the newest release output. Run after electron-builder (npm run dist does it) or by hand: node scripts/clean-release.cjs
// Removes every artifact in release/ whose name carries another version, and old sibling folders like release-0.1.14.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const outDir = path.join(root, 'release');
// Files named after a version: "Dispatch Setup 0.1.18.exe", "Dispatch-0.1.19-portable.exe", "...exe.blockmap", "Dispatch-0.1.19.dmg"
const VERSIONED = /(\d+\.\d+\.\d+)/;

// A file another process holds open (antivirus, Explorer) must not stop the build: report it and go on.
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); console.log('removed', path.relative(root, p)); } catch (e) { console.warn('could not remove', path.relative(root, p), '-', e.code || e.message); } }

function clean() {
  for (const name of fs.readdirSync(root)) {
    if (/^release-.+/.test(name) && fs.statSync(path.join(root, name)).isDirectory()) rm(path.join(root, name));
  }
  if (!fs.existsSync(outDir)) return;
  for (const name of fs.readdirSync(outDir)) {
    const m = name.match(VERSIONED);
    if (m && m[1] !== version) rm(path.join(outDir, name));
  }
}

if (require.main === module) clean();
module.exports = { clean };
