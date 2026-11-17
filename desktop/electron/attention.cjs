// Only answer a complete, known workspace trust menu. Never infer an answer
// from generic mentions of trust or from command-approval screens.
function normalize(text) {
  return text.replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\s+/g, ' ').toLowerCase();
}
// Only the CLIs' own approval menus: a question plus numbered Yes / No choices. Ordinary text that mentions
// permissions or asks "do you want to run the tests?" is not one; matching it held the agent's queue and flooded its
// lead with "paused, waiting to approve" notices (96 in 5 s on 2026-11-17).
//   Claude: "Do you want to proceed? ❯ 1. Yes  2. Yes, and don't ask again …  3. No, and tell Claude what to do differently (esc)",
//           also "Do you want to make this edit to x?", "Do you want to create x?", "Do you want to allow Claude to fetch …?"
//   Codex:  "Would you like to run the following command? › 1. Yes, proceed (y) … 3. No, and tell Codex what to do differently (esc)"
//   Gemini / Antigravity: "Allow execution of: 'npm'? ● 1. Yes, allow once 2. Yes, allow always … 3. No, suggest changes (esc)"
function approvalPrompt(t) {
  const asks = /(?:do you want to|would you like to) (?:proceed|run|make|create|allow|apply|delete|overwrite|execute|write|edit)[^?]{0,200}\?|allow (?:execution|this|command|tool)[^?]{0,200}\?|apply this change\?/.exec(t);
  if (!asks) return false;
  const rest = t.slice(asks.index, asks.index + 1200);
  return /\b1\.\s*yes\b/.test(rest) && /\b[2-4]\.\s*no\b|\bno,? (?:and )?(?:tell|suggest)|\bno \((?:esc|n)\)/.test(rest);
}
// What a terminal chunk says once spinner glyphs and elapsed timers are gone. A stalled CLI redraws
// "✻ Thinking… (22m 3s · esc to interrupt)" for ever: the same key again and again. Streamed tokens, tool output or a
// new line give a key not seen before, which is real progress.
function progressKey(data) {
  return normalize(String(data || '')).replace(/[⠀-⣿✢-✽·…●◐-◓∙*•]/g, '').replace(/\b\d+h\b|\b\d+m\b|\b\d+(?:\.\d+)?s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
// Once an agent has worked (hadTurn), its own replies and command output often mention "not signed in"
// or "run /login". After the first turn, only a provider's real logged-out TUI screen counts as Sign in.
function signInPrompt(t, { provider, hadTurn } = {}) {
  if (!hadTurn) {
    return /select login method|sign[ -]?in with|(?:sign|log)[ -]?in to continue|please (?:sign|log)[ -]?in|not (?:logged|signed) in|waiting for authentication|authentication required|run \/login|notlogin/.test(t);
  }
  if (provider === 'claude') {
    return /invalid api key\s*(?:·|\W)*\s*(?:please )?run \/login/.test(t)
      || (/select login method/.test(t) && /1\.\s*claude account/.test(t));
  }
  if (provider === 'codex') {
    return (/sign in with chatgpt/.test(t) && /(?:device code|api key|1\.\s*sign in)/.test(t))
      || /please run ['"`]?codex login['"`]?/.test(t);
  }
  return false;
}
function attentionFrom(text, opts) {
  // agy 1.5.10 greets with "You are currently not signed in. Signing in..." and then signs in by itself. A real
  // logout makes it quit with "not logged into Antigravity" (engine onExit), so this greeting is never a login screen.
  const t = normalize(text).replace(/you are currently not signed in/g, '');
  // The CLIs' trust questions only: "trust" and "folder" anywhere (an agent working on this very code) held its queue.
  if (/trust (?:the files in )?this (?:folder|workspace|directory|project)\?|yes, i trust this folder|accessing\s*workspace.*safety\s*check/.test(t)) return 'Trust folder';
  // Claude's AskUserQuestion menu (and its "review your answers" step): the agent waits for a choice.
  if ((/chat about this/.test(t) && /enter to select/.test(t) && /arrow keys to navigate/.test(t)) || /ready to submit your answers\?/.test(t)) return 'Question';
  // A real login screen, not an agent that merely writes about logins while it works on auth code.
  if (signInPrompt(t, opts)) return 'Sign in';
  if (approvalPrompt(t)) return 'Approve command';
  if (/(?:rate limit|usage limit|quota).{0,80}(?:reached|exceeded|exhausted|try again)|(?:reached|exceeded|exhausted).{0,80}(?:rate limit|usage limit|quota)|too many requests|(?:hit|reached) your (?:usage|rate) limit/.test(t)) return 'Limit reached';
  // "error:" in an agent's output is ordinary work (a failing test, a compiler message), not a reason to stop it.
  return null;
}
// Prompts that wait for a key: nothing may be pasted into them. Anything else is only shown to the user.
const BLOCKING = ['Trust folder', 'Sign in', 'Approve command', 'Question'];
// If the CLI is clearly back at its prompt or working, a stale attention must not hold the queue forever.
function shouldClearAttention(attention, { turn, hasSteps, codexState } = {}) {
  // Only a Sign in can be proven stale by the transcript. Claude and agy write the tool step BEFORE they show the
  // approval or question menu, so clearing those here would type queued messages into the menu (approve or reject
  // a command by accident). Trust folder stays with the screen logic.
  // A finished turn (back at the prompt) means no menu is open any more, whatever was detected.
  if (!attention) return false;
  if (turn === false || codexState === 'idle' || codexState === 'done') return true;
  if (attention !== 'Sign in') return false;
  return turn === true || !!hasSteps || codexState === 'working';
}
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
// What an approval menu asks, readable on a phone: the tool line and command before the question, plus the question.
// Case and symbols kept (normalize() lowercases); box-drawing frames and menu rows dropped.
function approvalSummary(text) {
  const t = String(text || '').replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/[─-╿▀-▟]/g, ' ').replace(/\s+/g, ' ');
  const re = /(?:do you want to|would you like to) (?:proceed|run|make|create|allow|apply|delete|overwrite|execute|write|edit)[^?]{0,200}\?|allow (?:execution|this|command|tool)[^?]{0,200}\?|apply this change\?/gi;
  let m, last = null; while ((m = re.exec(t))) last = m;
  if (!last) return '';
  // Only the stretch after the previous menu or prompt marker, so an old screen does not leak in.
  const before = t.slice(Math.max(0, last.index - 300), last.index).split(/[❯›●]|\(esc\)/).pop().trim();
  return `${before}${before ? '\n' : ''}${last[0].trim()}`.slice(-400);
}
module.exports = { approvalPrompt, approvalSummary, progressKey, attentionFrom, shouldClearAttention, trustAnswer, nudgeAnswer, BLOCKING, normalize };
