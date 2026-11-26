// What an agent's terminal really shows. The output stream of a TUI is cursor moves and partial redraws: words arrive
// split, old menus linger in it, new ones never appear in one piece. A headless terminal turns it back into the screen,
// so a menu, an idle prompt or a running turn is read from what the user would see. Works with no terminal panel open.
const { Terminal } = require('@xterm/headless');

function create(cols = 100, rows = 30, convertEol = false) {
  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 0, convertEol });
  return {
    write: (data, done) => term.write(data, done),
    resize: (c, r) => { try { if (c > 1 && r > 1) term.resize(c, r); } catch {} },
    size: () => ({ cols: term.cols, rows: term.rows }),
    lines() { const b = term.buffer.active, out = []; for (let i = 0; i < term.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) || ''); return out; },
    dispose: () => { try { term.dispose(); } catch {} },
  };
}

const RULE = /^\s*[─━═]{10,}\s*$/;
const HINT = /↑\/?↓|navigate|esc(?:ape)? to|enter (?:to )?(?:confirm|select|submit)|press enter|tab to|ctrl\+/i;
const unbox = l => l.replace(/^\s*[│┃|╭╰]\s?/, m => ' '.repeat(m.length)).replace(/\s*[│┃|╮╯]\s*$/, '').trimEnd();
const SELECT = /^(\s*)([>❯›▶●])\s+(?=\S)/;
const OPTION = /^\s*(?:[>❯›▶●]\s+)?(\d{1,2})[.)]\s+(\S.*)$/;

// A choice menu that waits for a key at the bottom of the screen:
//   { title, body, question, options: [label], selected, numbered }
// Numbered ("> 1. Yes, allow access  2. …") or agy's trust list ("> Yes, I trust this folder / No, exit"). A list in an
// agent's prose is not one: it has no selector mark, or the CLI's prompt box (two rules) is drawn under it.
function parseMenu(rawLines) {
  const lines = rawLines.map(l => { const t = l.trimEnd(); if (/^\s*[╭╰┌└][─━]+.*[╮╯┐┘]$/.test(t)) return ''; return RULE.test(t) ? t : unbox(t); });
  let end = lines.length - 1; while (end >= 0 && !lines[end].trim()) end--;
  if (end < 1) return null;
  // Bottom up: the last row that carries a selector mark.
  let sel = -1;
  for (let i = end; i >= 0 && end - i < 24; i--) { if (RULE.test(lines[i])) break; if (SELECT.test(lines[i])) { sel = i; break; } }
  if (sel < 0) return null;
  let first, last, options = [], selected = 0;
  const numbered = OPTION.test(lines[sel]);
  if (numbered) {
    const num = i => Number(OPTION.exec(lines[i])?.[1] || 0);
    first = sel;
    // Up to option 1: wrapped lines of an option sit between two numbers.
    for (let i = sel - 1, want = num(sel) - 1; i >= 0 && want > 0; i--) { if (RULE.test(lines[i])) return null; if (num(i) === want) { want--; first = i; } }
    if (num(first) !== 1) return null;
    const rows = []; last = first;
    for (let i = first; i <= end; i++) {
      const line = lines[i];
      if (num(i) === rows.length + 1) { rows.push({ at: i, text: OPTION.exec(line)[2].trim() }); last = i; continue; }
      if (!line.trim()) { if (i > last + 1) break; continue; }
      // The rest of a wrapped label: directly under it. agy wraps at the margin, without any indent.
      if (i === last + 1 && !HINT.test(line) && !RULE.test(line) && num(i) === 0) { rows[rows.length - 1].text += ' ' + line.trim(); last = i; continue; }
      break;
    }
    if (rows.length < 2) return null;
    options = rows.map(r => r.text); selected = Math.max(0, rows.filter(r => r.at <= sel).length - 1);
  } else {
    const indent = SELECT.exec(lines[sel])[0].length;
    const row = i => !!lines[i]?.trim() && !RULE.test(lines[i]) && !HINT.test(lines[i]) && (i === sel || (/^\s*/.exec(lines[i])[0].length === indent && !SELECT.test(lines[i])));
    first = last = sel; while (first > 0 && row(first - 1)) first--; while (last < end && row(last + 1)) last++;
    if (last === first) return null;
    for (let i = first; i <= last; i++) options.push(i === sel ? lines[i].replace(SELECT, '').trim() : lines[i].trim());
    selected = sel - first;
  }
  // Below the options only the key hints; the prompt box under them means the list is old output.
  let below = 0; for (let i = last + 1; i <= end; i++) { if (RULE.test(lines[i]) || /^ *[>❯›] *$/.test(lines[i])) return null; if (lines[i].trim()) below++; }
  if (below > 5) return null;
  const hinted = lines.slice(last + 1, end + 1).some(l => HINT.test(l));
  if (!numbered && !hinted) return null;
  // Above: the question right over the options, the details before it, up to a rule or the top of the block.
  let q = first - 1; while (q >= 0 && !lines[q].trim()) q--;
  if (q < 0) return null;
  let question = '', top = q;
  for (let i = q; i >= 0 && q - i < 8; i--) { if (RULE.test(lines[i])) break; if (/\?\s*$/.test(lines[i])) { question = lines[i].trim(); top = i - 1; break; } }
  if (!question && !hinted) return null;
  const body = [], between = [];
  if (question) for (let i = q; i > top + 1; i--) if (lines[i].trim()) between.unshift(lines[i].trim());
  let title = '', blanks = 0;
  for (let i = top; i >= 0 && body.length < 18; i--) {
    if (RULE.test(lines[i])) {
      let t = i - 1; while (t >= 0 && !lines[t].trim()) t--;
      if (t >= 0 && !RULE.test(lines[t]) && lines[t].trim().length < 60 && !/^[●○•>❯⎿]/.test(lines[t].trim())) title = lines[t].trim();
      break;
    }
    if (!lines[i].trim()) { if (++blanks > 2) break; continue; }
    if (/^\s*[╌┄-]{10,}\s*$/.test(lines[i])) continue; // Claude's thin rules around a command
    blanks = 0; body.unshift(lines[i].trim());
  }
  return { title, body: [...body, ...between].join('\n'), question, options, selected, numbered };
}

// What a menu is about: 'Trust folder', 'Approve command' (a yes / no choice) or 'Question' (any other choice).
function menuKind(menu) {
  if (!menu) return null;
  const all = [menu.question, menu.body, ...menu.options].join(' ').toLowerCase();
  const o = menu.options.map(x => x.toLowerCase());
  if (/trust (?:the (?:files in|contents of) )?this (?:folder|workspace|directory|project)/.test(all) && o.some(x => /trust|yes/.test(x)) && o.some(x => /\bno\b|exit|don.t|quit/.test(x))) return 'Trust folder';
  const yes = o.some(x => /^(?:yes|allow|approve|accept|proceed|run)\b/.test(x)), no = o.some(x => /^(?:no|deny|reject|decline|don.t|cancel|skip)\b/.test(x));
  if (yes && no) return 'Approve command';
  return menu.numbered && menu.question ? 'Question' : null;
}

// Claude out of quota: "What do you want to do?  1. Stop and wait for limit to reset  2. Upgrade your plan".
const isLimitMenu = menu => !!menu && menu.options.some(o => /wait for (?:the |your )?(?:limit|usage|quota)|wait (?:until|for) .*reset/i.test(o));

// Antigravity's screen: its prompt box is two rules with ">" between, its state stands in the footer under them.
//   'loading' no prompt box yet (starting, signing in) · 'menu' · 'busy' "esc to cancel" · 'typing' text in the box · 'idle'
function agyState(lines) {
  if (parseMenu(lines)) return 'menu';
  const l = lines.map(x => x.trimEnd());
  const ruleAbove = i => { let r = i - 1; while (r >= 0 && !RULE.test(l[r])) r--; return r; };
  let b = ruleAbove(l.length), a = ruleAbove(b);
  const foot = b;
  // With commands running in the background agy (1.5.17) lists them under the box, closed by a rule of its own:
  // a server left running made an agent read as still loading, so it showed as idle however hard it worked.
  if (a >= 0 && !/^\s*>/.test(l[a + 1] || '') && b - a < 14) { b = a; a = ruleAbove(b); }
  if (a < 0 || !/^\s*>/.test(l[a + 1] || '')) return 'loading';
  const footer = l.slice(foot + 1).join(' ').toLowerCase();
  if (/esc to (?:cancel|interrupt)/.test(footer)) return 'busy';
  if (/\? for shortcuts/.test(footer)) return 'idle';
  if (l.slice(Math.max(0, a - 3), a).some(x => /^\s*[⠁-⣿]\s/.test(x))) return 'busy';
  return l.slice(a + 1, b).join(' ').replace(/^\s*>/, '').trim() ? 'typing' : 'idle';
}
// The permission mode a CLI shows under its prompt, or '' when it shows none (agy: "auto · Gemini …", Claude: "plan mode on").
function shownMode(provider, lines) {
  const tail = lines.filter(x => x.trim()).slice(-4).join('\n').toLowerCase();
  if (provider === 'antigravity') return /(accept-edits|auto|plan)\s+·/.exec(tail)?.[1] || '';
  if (provider === 'claude') return /bypass permissions on/.test(tail) ? 'bypassPermissions' : /accept edits on/.test(tail) ? 'acceptEdits' : /plan mode on/.test(tail) ? 'plan' : '';
  return '';
}
// Keys that pick option `to` in an open menu.
const menuKeys = (menu, to) => (to > menu.selected ? '\x1b[B' : '\x1b[A').repeat(Math.abs(to - menu.selected)) + '\r';

module.exports = { create, parseMenu, menuKind, menuKeys, isLimitMenu, agyState, shownMode };
