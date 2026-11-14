// Only answer a complete, known workspace trust menu. Never infer an answer
// from generic mentions of trust or from command-approval screens.
function normalize(text) {
  return text.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\s+/g, ' ').toLowerCase();
}
function attentionFrom(text) {
  const t = normalize(text);
  if ((/trust/.test(t) && /folder|workspace|directory/.test(t)) || /accessing\s*workspace.*safety\s*check/.test(t)) return 'Trust folder';
  // Claude's AskUserQuestion menu (and its "review your answers" step): the agent waits for a choice.
  if ((/chat about this/.test(t) && /enter to select/.test(t) && /arrow keys to navigate/.test(t)) || /ready to submit your answers\?/.test(t)) return 'Question';
  // A real login screen, not an agent that merely writes about logins while it works on auth code.
  if (/select login method|sign[ -]?in with|(?:sign|log)[ -]?in to continue|please (?:sign|log)[ -]?in|not (?:logged|signed) in|waiting for authentication|authentication required|run \/login|notlogin/.test(t)) return 'Sign in';
  if (/(?:approve|allow|permission).{0,120}(?:command|tool|execute|run|access).{0,80}\?/.test(t) || /(?:do you want to|would you like to).{0,100}(?:run|execute|allow).{0,80}\?/.test(t)) return 'Approve command';
  if (/(?:rate limit|usage limit|quota).{0,80}(?:reached|exceeded|exhausted|try again)|(?:reached|exceeded|exhausted).{0,80}(?:rate limit|usage limit|quota)|too many requests|(?:hit|reached) your (?:usage|rate) limit/.test(t)) return 'Limit reached';
  // "error:" in an agent's output is ordinary work (a failing test, a compiler message), not a reason to stop it.
  return null;
}
// Prompts that wait for a key: nothing may be pasted into them. Anything else is only shown to the user.
const BLOCKING = ['Trust folder', 'Sign in', 'Approve command', 'Question'];
// Codex offers a cheaper model when the limit is near and waits for a choice; Enter would switch the model.
// Answer "2. Keep current model" (Down, Enter) so the agent goes on with the model the user chose.
function nudgeAnswer(provider, text) {
  const t = normalize(text);
  if (provider === 'codex' && t.includes('approaching rate limits') && /1\.\s*switch to/.test(t) && /2\.\s*keep current model/.test(t)) return '\x1b[B\r';
  return null;
}
function trustAnswer(provider, text) {
  const t = normalize(text);
  if (['claude', 'antigravity'].includes(provider) && t.includes('yes, i trust this folder') && t.includes('no, exit')) return provider === 'claude' ? '\x1b[B\r' : '\r';
  if (provider === 'codex' && t.includes('trust this folder?') && /1\.\s*trust and continue/.test(t) && /2\.\s*(?:quit|back to agent command center|keep current directory)/.test(t)) return '\r';
  if (provider === 'qoder' && t.includes('do you trust the files in this folder?') && /1\.\s*trust folder/.test(t) && /2\.\s*don.t trust and exit/.test(t)) return '\r';
  if (provider === 'gemini' && t.includes('do you trust the files in this folder?') && /1\.\s*trust folder/.test(t) && /2\.\s*trust parent folder/.test(t) && /3\.\s*don.t trust/.test(t)) return '\r';
  return null;
}
module.exports = { attentionFrom, trustAnswer, nudgeAnswer, BLOCKING, normalize };
