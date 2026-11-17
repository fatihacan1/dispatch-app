const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attentionFrom, trustAnswer, nudgeAnswer } = require('./attention.cjs');
test('observed workspace menus require the complete provider-specific choices', () => {
 const q = 'Do you trust the files in this folder? > 1. Trust folder 2. Don\'t trust and exit';
 const g = 'Do you trust the files in this folder? ? 1. Trust folder (project) 2. Trust parent folder (Temp) 3. Don\'t trust';
 for (const [provider, screen] of [['qoder',q], ['gemini',g]]) { assert.equal(attentionFrom(screen), 'Trust folder'); assert.equal(trustAnswer(provider, screen), '\r'); assert.equal(trustAnswer(provider, screen.slice(0, 50)), null); }
 assert.equal(trustAnswer('codex', 'Trust this folder? 1. Trust and continue 2. Back to Agent Command Center'), '\r');
 assert.equal(trustAnswer('codex', q), null);
 assert.equal(trustAnswer('opencode', g), null);
 assert.equal(trustAnswer('gemini', 'Trust folder? Approve command?'), null);
});
test('sign in and approval remain distinguishable', () => {
 assert.equal(attentionFrom('Waiting for authentication...'), 'Sign in');
 assert.equal(attentionFrom('Sign in to continue'), 'Sign in');
 // agy's startup greeting, followed by its own automatic sign-in, is not a login screen.
 assert.equal(attentionFrom(' Welcome to the Antigravity CLI. You are currently not signed in.\n\n ⣷  Signing in...'), null);
 assert.equal(attentionFrom('Error: not signed in'), 'Sign in');
 assert.equal(attentionFrom('Bash command npm test Do you want to proceed? ❯ 1. Yes 2. Yes, and don\'t ask again for npm test commands 3. No, and tell Claude what to do differently (esc)'), 'Approve command');
});

test('identifies exhausted limits without flagging ordinary usage', () => {
 assert.equal(attentionFrom('Error: usage limit reached, try again later'), 'Limit reached');
 assert.equal(attentionFrom('Rate limit exceeded'), 'Limit reached');
 assert.equal(attentionFrom('Usage limit: 40% remaining'), null);
});

test('ordinary agent output is not a prompt', () => {
 assert.equal(attentionFrom('error: expected 3 arguments, fatal: not a git repository'), null);
 assert.equal(attentionFrom('Reviewing the login flow and the mailbox OAuth token refresh in account settings'), null);
 assert.equal(attentionFrom('Select login method: 1. Claude account with subscription'), 'Sign in');
});
test('codex model nudge keeps the current model', () => {
 const screen = 'Approaching rate limits Switch to gpt-6-luna for lower credit usage? > 1. Switch to gpt-6-luna 2. Keep current model 3. Keep current model (never show again)';
 assert.equal(nudgeAnswer('codex', screen), '\x1b[B\r');
 assert.equal(nudgeAnswer('claude', screen), null);
 assert.equal(nudgeAnswer('codex', 'Approaching rate limits'), null);
});
test('claude question menu and its review step wait for the user; they block pasting', () => {
 const { BLOCKING } = require('./attention.cjs');
 const menu = '\x1b[12;1HPick a color\r\n\u276f 1. Red\x1b[16;3H2.\x1b[1CGreen 3. Blue 4.\x1b[1CType\x1b[1Csomething.\r\n5.\x1b[1CChat\x1b[1Cabout\x1b[1Cthis Enter to select \u00b7 Tab/Arrow keys to navigate \u00b7 Esc to cancel';
 assert.equal(attentionFrom(menu), 'Question');
 assert.equal(attentionFrom('Review your answers \u25cf Pick a color \u2192 Blue Ready to submit your answers? \u276f 1. Submit answers 2. Cancel'), 'Question');
 assert.equal(attentionFrom('I will chat about this later and type something in the docs.'), null);
 assert.ok(BLOCKING.includes('Question'));
});
test('claude trust menu (No, exit first): Down then Enter trusts', () => {
 const screen = 'Accessing workspace: C:\\proj Quick safety check: Is this a project you created or one you trust? \u276f No, exit Yes, I trust this folder Enter to confirm';
 assert.equal(attentionFrom(screen), 'Trust folder');
 assert.equal(trustAnswer('claude', screen), '\x1b[B\r');
});
test('approval: only the CLIs\' real approval menus', () => {
 const { approvalPrompt, normalize } = require('./attention.cjs');
 const real = [
  // Claude Code (with the cursor moves its TUI draws between words)
  'Bash command\r\n  npm run build\r\n\x1b[2CBuild\x1b[1Cthe\x1b[1Capp\r\nDo you want to proceed?\r\n\u276f 1. Yes\r\n  2. Yes, and don\'t ask again for npm run build commands in D:\\proj\r\n  3. No, and tell Claude what to do differently (esc)',
  'Edit file src/a.ts Do you want to make this edit to a.ts? \u276f 1. Yes 2. Yes, allow all edits during this session (shift+tab) 3. No, and tell Claude what to do differently (esc)',
  'Create file notes.md Do you want to create notes.md? \u276f 1. Yes 2. Yes, allow all edits during this session (shift+tab) 3. No, and tell Claude what to do differently (esc)',
  'Fetch https://example.com Do you want to allow Claude to fetch this content? \u276f 1. Yes 2. Yes, and don\'t ask again for example.com 3. No, and tell Claude what to do differently (esc)',
  // Codex
  'Would you like to run the following command? $ npm test \u203a 1. Yes, proceed (y) 2. Yes, and don\'t ask again for this command (p) 3. No, and tell Codex what to do differently (esc)',
  'Would you like to make the following edits? \u203a 1. Yes, proceed (y) 2. No, and tell Codex what to do differently (esc)',
  // Gemini CLI / Antigravity
  'Allow execution of: \'npm\'? \u25cf 1. Yes, allow once 2. Yes, allow always ... 3. No, suggest changes (esc)',
 ];
 for (const screen of real) { assert.equal(attentionFrom(screen), 'Approve command', screen.slice(0, 60)); assert.equal(approvalPrompt(normalize(screen)), true); }
 const ordinary = [
  'Approve this command?',
  'The permission mode lets the tool run commands without asking for approval. Do you want me to run the tests?',
  'I added --dangerously-skip-permissions so agents never ask to approve a command. Would you like to run it now?',
  'attention.cjs: if (/(?:approve|allow|permission).{0,120}(?:command|tool)/.test(t)) return \'Approve command\';',
  'Do you want to proceed? I can also refactor the parser.',
  '## Options\n1. Yes, ship it\n2. Wait for review\nWhich one?',
 ];
 for (const text of ordinary) assert.equal(attentionFrom(text), null, text.slice(0, 60));
});
test('trust: only the CLIs\' trust questions, not text about trusting folders', () => {
 assert.equal(attentionFrom('The Trust folder dialog shows when the workspace is new; the folder is trusted in .dispatch/trust.json.'), null);
 assert.equal(attentionFrom('Trust this folder? 1. Trust and continue 2. Quit'), 'Trust folder');
});
test('after a turn, only the CLI\'s own logged-out screen triggers Sign in and stale attention clears when working or at prompt', () => {
 const { BLOCKING, shouldClearAttention } = require('./attention.cjs');
 for (const provider of ['claude', 'codex', 'antigravity', 'gemini']) {
  assert.equal(attentionFrom('The account is not signed in. Please run /login or waiting for authentication.', { provider, hadTurn: true }), null);
  assert.equal(attentionFrom('Error: not logged in. Sign in to continue.', { provider, hadTurn: true }), null);
 }
 // False Sign in text after a turn does not block delivery of queued user messages.
 const queue = ['user message'];
 const detected = attentionFrom('Boss reply: account is not signed in', { provider: 'claude', hadTurn: true });
 const blocked = BLOCKING.includes(detected);
 assert.equal(blocked, false);
 if (!blocked && queue.length) queue.shift();
 assert.equal(queue.length, 0);

 assert.equal(attentionFrom('Invalid API key · Please run /login', { provider: 'claude', hadTurn: true }), 'Sign in');
 assert.equal(attentionFrom('Select login method:\n❯ 1. Claude account with subscription\n  2. Anthropic Console account', { provider: 'claude', hadTurn: true }), 'Sign in');
 assert.equal(attentionFrom('Sign in with ChatGPT\n1. Sign in with ChatGPT\n2. Provide your own OpenAI API key', { provider: 'codex', hadTurn: true }), 'Sign in');

 assert.equal(shouldClearAttention('Sign in', { turn: false }), true);
 assert.equal(shouldClearAttention('Sign in', { turn: true }), true);
 assert.equal(shouldClearAttention('Sign in', { hasSteps: true }), true);
 assert.equal(shouldClearAttention('Sign in', { codexState: 'idle' }), true);
 assert.equal(shouldClearAttention('Approve command', { hasSteps: true }), false);
 assert.equal(shouldClearAttention('Approve command', { turn: false }), true);
 assert.equal(shouldClearAttention('Question', { turn: true }), false);
 // The tool step is written before the approval menu shows: it must not clear the approval.
 assert.equal(shouldClearAttention('Approve command', { turn: true }), false);
 assert.equal(shouldClearAttention('Approve command', { codexState: 'working' }), false);
 assert.equal(shouldClearAttention('Trust folder', { hasSteps: true }), false);
 assert.equal(shouldClearAttention('Question', { turn: false }), true);
});
test('progress key ignores spinner redraws and elapsed timers, but sees tokens and new text', () => {
 const { progressKey } = require('./attention.cjs');
 const a = progressKey('\x1b[2K\x1b[1G\u273b Thinking\u2026 (21m 58s \u00b7 \u2193 1.2k tokens \u00b7 esc to interrupt)');
 const b = progressKey('\x1b[2K\x1b[1G\u2736 Thinking\u2026 (22m 3s \u00b7 \u2193 1.2k tokens \u00b7 esc to interrupt)');
 assert.equal(a, b);
 assert.notEqual(progressKey('\u2736 Thinking\u2026 (22m 4s \u00b7 \u2193 1.3k tokens)'), progressKey('\u2736 Thinking\u2026 (22m 5s \u00b7 \u2193 1.2k tokens)'));
 assert.equal(progressKey('\x1b[?25l\x1b[2;3H\u280b'), '');
 assert.ok(progressKey('Read 3 files'));
});
