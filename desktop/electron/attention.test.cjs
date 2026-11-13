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
 assert.equal(attentionFrom('Approve this command?'), 'Approve command');
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
