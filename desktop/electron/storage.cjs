const fs = require('node:fs');
const path = require('node:path');
function migrate(base) {
  const oldPath = path.join(base, '.myarmy'), newPath = path.join(base, '.dispatch');
  if (fs.existsSync(oldPath) && fs.existsSync(newPath)) throw new Error(`Both ${oldPath} and ${newPath} exist; resolve them before starting Dispatch.`);
  if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
  return newPath;
}
module.exports = { migrate };
