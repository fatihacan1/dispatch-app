const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fake Bot API: getUpdates hands out the queued updates once, every call is recorded.
function fakeApi(updates) {
  const calls = [];
  global.fetch = async (url, init) => {
    const method = url.split('/').pop(); const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    let result = true;
    if (method === 'getUpdates') { result = updates.splice(0); if (!result.length) await new Promise(r => setTimeout(r, 50)); }
    if (method === 'sendMessage') result = { message_id: 77 };
    return { status: 200, json: async () => ({ ok: true, result }) };
  };
  return calls;
}
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('timed out'); };

test('buttons, button taps and the / menu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-'));
  fs.writeFileSync(path.join(dir, 'telegram.json'), JSON.stringify({ token: '123456:' + 'a'.repeat(35), bot: { username: 'b' }, chatId: 5 }));
  const calls = fakeApi([
    { update_id: 1, callback_query: { id: 'q1', data: 'ap:ab:y', message: { message_id: 9, chat: { id: 5 } } } },
    { update_id: 2, callback_query: { id: 'q2', data: 'x', message: { message_id: 9, chat: { id: 6 } } } },
    { update_id: 3, message: { message_id: 3, chat: { id: 5 }, text: '/projects' } },
  ]);
  const taps = [];
  const tg = require('./telegram.cjs').create({
    dir, commands: [['projects', 'Open projects']],
    onMessage: async () => {},
    onCommand: async cmd => (cmd === 'projects' ? { text: 'Pick', buttons: [[{ text: 'app', data: 'use:1' }]] } : null),
    onButton: async data => { taps.push(data); return { toast: 'Approved', text: 'done' }; },
  });
  tg.start();
  await until(() => calls.some(c => c.method === 'sendMessage'));
  tg.stop();
  assert.deepEqual(taps, ['ap:ab:y']); // the tap from another chat never reaches the app
  assert.deepEqual(calls.find(c => c.method === 'setMyCommands').body.commands, [{ command: 'projects', description: 'Open projects' }]);
  assert.equal(calls.find(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'q1').body.text, 'Approved');
  assert.equal(calls.find(c => c.method === 'editMessageText').body.text, 'done');
  assert.deepEqual(calls.find(c => c.method === 'sendMessage').body.reply_markup.inline_keyboard, [[{ text: 'app', callback_data: 'use:1' }]]);
  assert.deepEqual(calls.find(c => c.method === 'getUpdates').body.allowed_updates, ['message', 'callback_query']);
});
