function parseMessage(text) {
  try { const m = JSON.parse(text); return m && typeof m.id === 'string' && typeof m.from === 'string' && typeof m.to === 'string' && typeof m.text === 'string' ? m : null; } catch { return null; }
}
module.exports = { parseMessage };
