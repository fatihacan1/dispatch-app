// Language servers the editor can start: where each one is found, how it is installed once when it is missing, and which
// folder it works in. C and C++ also need the compiler's include folders and flags; those come from the project itself
// (PlatformIO, compile_commands.json), see cSetup.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const WIN = process.platform === 'win32';
const exe = name => WIN ? name + '.exe' : name;
const home = () => process.env.DISPATCH_TEST_LSP || path.join(process.env.DISPATCH_TEST_HOME || os.homedir(), '.dispatch');
const run = (file, args, opts = {}) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 600000, maxBuffer: 64 << 20, ...opts }, (err, out, errOut) => err ? reject(new Error(String(errOut || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400))) : resolve(String(out).trim())));
const which = async name => { try { return (await run(WIN ? 'where' : 'which', [name], { timeout: 5000 })).split(/\r?\n/)[0] || null; } catch { return null; } };
const exists = f => { try { return fs.existsSync(f); } catch { return false; } };
function findFile(dir, name) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of list) if (e.isFile() && e.name === name) return path.join(dir, e.name);
  for (const e of list) if (e.isDirectory()) { const hit = findFile(path.join(dir, e.name), name); if (hit) return hit; }
  return null;
}

async function gopls(say) {
  const found = await which('gopls'); if (found) return [found, ['serve']];
  const go = await which('go'); if (!go) throw new Error('Go is not installed.');
  const bin = path.join((await run(go, ['env', 'GOPATH'])).split(path.delimiter)[0], 'bin', exe('gopls'));
  if (!exists(bin)) { say('Installing gopls…'); await run(go, ['install', 'golang.org/x/tools/gopls@latest']); }
  if (!exists(bin)) throw new Error('Could not install gopls.');
  return [bin, ['serve']];
}

async function rust(say) {
  const found = await which('rust-analyzer');
  // rustup leaves a stub on PATH that only works once its component is there.
  if (found) { try { await run(found, ['--version'], { timeout: 20000 }); return [found, []]; } catch {} }
  const rustup = await which('rustup'); if (!rustup) throw new Error('Rust (rustup) is not installed.');
  say('Installing rust-analyzer…');
  await run(rustup, ['component', 'add', 'rust-analyzer']);
  return [await run(rustup, ['which', 'rust-analyzer']), []];
}

// One pinned release, so every computer gets the same tested server.
const CLANGD = '23.1.0';
async function clangdPath(say) {
  const found = await which('clangd'); if (found) return found;
  const dir = path.join(home(), 'lsp', `clangd-${CLANGD}`), have = findFile(dir, exe('clangd')); if (have) return have;
  if (process.arch !== 'x64' && process.platform !== 'darwin') throw new Error('Install clangd: there is no ready build for this computer.');
  say('Downloading clangd…');
  const os_ = WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const res = await fetch(`https://github.com/clangd/clangd/releases/download/${CLANGD}/clangd-${os_}-${CLANGD}.zip`, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`Could not download clangd (${res.status}).`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-clangd-'));
  try {
    const zip = path.join(work, 'clangd.zip'); fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const out = path.join(work, 'out'); fs.mkdirSync(out);
    if (process.platform === 'linux') await run('unzip', ['-q', zip, '-d', out]); else await run(WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', out]);
    fs.cpSync(out, dir, { recursive: true });
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  const bin = findFile(dir, exe('clangd')); if (!bin) throw new Error('The clangd download had no program in it.');
  if (!WIN) fs.chmodSync(bin, 0o755);
  return bin;
}

const TSLS = 'typescript-language-server@5.1.3', TS = 'typescript@5.9.3';
async function typescript(say) {
  const node = await which('node'); if (!node) throw new Error('Node.js is not installed.');
  const dir = path.join(home(), 'lsp', 'typescript'), cli = path.join(dir, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
  if (!exists(cli)) {
    say('Installing the TypeScript server…');
    fs.mkdirSync(dir, { recursive: true });
    const npmCli = path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const args = ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--prefix', dir, TSLS, TS];
    if (exists(npmCli)) await run(node, [npmCli, ...args]); else await run('npm', args, { shell: WIN });
  }
  if (!exists(cli)) throw new Error('Could not install the TypeScript server.');
  return [node, [cli, '--stdio'], { tsserver: { fallbackPath: path.join(dir, 'node_modules', 'typescript', 'lib') } }];
}

async function csharp(say) {
  const found = await which('csharp-ls'); if (found) return [found, []];
  const dotnet = await which('dotnet'); if (!dotnet) throw new Error('The .NET SDK is not installed.');
  const dir = path.join(home(), 'lsp', 'csharp'), bin = path.join(dir, exe('csharp-ls'));
  if (!exists(bin)) {
    const major = Math.max(0, ...(await run(dotnet, ['--list-sdks'])).split('\n').map(l => parseInt(l, 10) || 0));
    if (major < 8) throw new Error('C# suggestions need the .NET 8 SDK or newer.');
    say('Installing the C# server…');
    // Each version is built for one .NET.
    const tries = major >= 10 ? [null, '0.20.0', '0.16.0'] : major === 9 ? ['0.20.0', '0.18.0', '0.16.0'] : ['0.15.0', '0.14.0'];
    let last; for (const v of tries) { try { await run(dotnet, ['tool', 'install', 'csharp-ls', '--tool-path', dir, ...(v ? ['--version', v] : [])]); await run(bin, ['--version'], { timeout: 30000 }); last = null; break; } catch (e) { last = e; try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } }
    if (last) throw new Error('Could not install the C# server: ' + last.message);
  }
  return [bin, []];
}

// The nearest folder above a file, inside the workspace, that holds one of these.
function nearest(workspace, file, test) {
  const top = path.resolve(workspace);
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    let names = []; try { names = fs.readdirSync(dir); } catch {}
    if (names.some(test)) return dir;
    if (path.relative(top, dir) === '' || path.dirname(dir) === dir || path.relative(top, dir).startsWith('..')) return null;
  }
}
const ROOTS = {
  rust: n => n === 'Cargo.toml',
  csharp: n => /\.(sln|slnx|csproj)$/i.test(n),
  cpp: n => ['platformio.ini', 'compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt'].includes(n),
};
function rootFor(lang, workspace, file) {
  if (lang === 'cpp') {
    // PlatformIO wins over the CMakeLists.txt some frameworks keep in src/.
    for (const t of [n => n === 'platformio.ini', n => n === 'compile_commands.json', ROOTS.cpp]) { const d = nearest(workspace, file, t); if (d) return d; }
    return workspace;
  }
  if (lang === 'csharp') return nearest(workspace, file, n => /\.slnx?$/i.test(n)) || nearest(workspace, file, ROOTS.csharp) || workspace;
  return (ROOTS[lang] && nearest(workspace, file, ROOTS[lang])) || workspace;
}

// ── C and C++ ──
// Which source of include folders and flags to use. 'auto' is PlatformIO, then compile_commands.json, then plain clangd.
// The choice of a project is kept in its .dispatch folder.
const choiceFile = ws => path.join(ws, '.dispatch', 'intellisense.json');
const choices = ws => { try { return JSON.parse(fs.readFileSync(choiceFile(ws), 'utf8')).cpp || {}; } catch { return {}; } };
const choiceKey = (ws, root) => path.relative(ws, root).split(path.sep).join('/') || '.';
const choiceOf = (ws, root) => choices(ws)[choiceKey(ws, root)] || 'auto';
function setChoice(ws, root, value) {
  const all = { ...choices(ws) }; if (value === 'auto') delete all[choiceKey(ws, root)]; else all[choiceKey(ws, root)] = value;
  fs.mkdirSync(path.dirname(choiceFile(ws)), { recursive: true }); fs.writeFileSync(choiceFile(ws), JSON.stringify({ cpp: all }, null, 2));
}
function pioEnvs(root) {
  let text; try { text = fs.readFileSync(path.join(root, 'platformio.ini'), 'utf8'); } catch { return []; }
  return [...text.matchAll(/^\[env:([^\]\r\n]+)\]/gm)].map(m => m[1].trim());
}
function pioDefault(root) {
  const envs = pioEnvs(root); let text = ''; try { text = fs.readFileSync(path.join(root, 'platformio.ini'), 'utf8'); } catch {}
  const d = /^\s*default_envs\s*=\s*([^\s,;]+)/m.exec(text)?.[1];
  return envs.includes(d) ? d : envs[0];
}
function databases(root) {
  const out = [], look = (dir, rel, depth) => {
    if (exists(path.join(dir, 'compile_commands.json'))) out.push(rel || '.');
    if (!depth) return;
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    for (const e of list) if (e.isDirectory() && (depth === 2 ? /^(build|out|cmake-build|debug|release|bin)/i.test(e.name) : true) && !/^(\.git|node_modules|CMakeFiles|_deps)$/.test(e.name)) look(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, depth - 1);
  };
  look(root, '', 2); return out.slice(0, 8);
}
function cOptions(ws, root) {
  const value = choiceOf(ws, root), options = [{ id: 'auto', label: 'Automatic' }];
  for (const e of pioEnvs(root)) options.push({ id: 'pio:' + e, label: `PlatformIO: ${e}` });
  for (const d of databases(root)) options.push({ id: 'db:' + d, label: d === '.' ? 'compile_commands.json' : `${d}/compile_commands.json` });
  options.push({ id: 'plain', label: 'No project settings' }, { id: 'off', label: 'Off' });
  return { value: options.some(o => o.id === value) ? value : 'auto', options };
}
function resolveChoice(ws, root) {
  const v = cOptions(ws, root).value; if (v !== 'auto') return v;
  if (pioEnvs(root).length) return 'pio:' + pioDefault(root);
  const db = databases(root)[0]; return db ? 'db:' + db : 'plain';
}

async function pioPath() {
  const name = exe('pio'), inHome = path.join(os.homedir(), '.platformio', 'penv', WIN ? 'Scripts' : 'bin', name);
  return exists(inHome) ? inHome : await which('pio');
}
// clang has no Xtensa in its ready builds: a 32-bit x86 has the same type sizes, and the chip's own macros are added.
function targetOf(cc) {
  const n = path.basename(cc || '').toLowerCase();
  if (/xtensa/.test(n)) return ['--target=i386-unknown-none-elf'];
  if (/riscv/.test(n)) return ['--target=riscv32-unknown-elf'];
  if (/^arm-none-eabi/.test(n)) return ['--target=arm-none-eabi'];
  if (/^avr/.test(n)) return ['--target=avr'];
  return [];
}
// The compiler's @file arguments, opened up.
function expand(flags, cwd) {
  return (flags || []).flatMap(f => { if (!f.startsWith('@')) return [f]; try { return fs.readFileSync(path.resolve(cwd, f.slice(1).replace(/^"|"$/g, '')), 'utf8').match(/"[^"]*"|\S+/g) || []; } catch { return []; } });
}
// Only what clang understands and what changes how the code reads. -Werror and GCC's machine switches are left out.
const keepFlag = f => /^-std=/.test(f) || /^-D/.test(f) || /^-U/.test(f) || /^-f(no-)?(exceptions|rtti|short-enums|permissive)$/.test(f) || /^-mmcu=|^-mcpu=|^-mthumb$|^-mfloat-abi=|^-mfpu=/.test(f);
const SOURCES = /\.(c|cc|cpp|cxx|ino|s)$/i;
function sources(root) {
  const out = [], walk = (dir, depth) => {
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= 3000) return;
      if (e.isDirectory()) { if (depth && !/^(\.git|\.pio|\.cache|node_modules|build|\.dispatch)$/.test(e.name)) walk(path.join(dir, e.name), depth - 1); }
      else if (SOURCES.test(e.name) && !/\.s$/i.test(e.name)) out.push(path.join(dir, e.name));
    }
  };
  walk(root, 6); return out;
}
async function macros(cc) {
  try { return (await run(cc, ['-dM', '-E', '-x', 'c', WIN ? 'NUL' : '/dev/null'], { timeout: 20000 })).split(/\r?\n/).map(l => /^#define (__(?:XTENSA|xtensa|XTENSA_\w+|XCHAL_\w+|AVR\w*)\w*) ?(.*)$/.exec(l)).filter(Boolean).map(m => `-D${m[1]}=${m[2]}`); } catch { return []; }
}
/** Compile commands for a PlatformIO environment, from `pio project metadata`. Nothing is written into the project by us. */
async function pioCommands(root, env, say) {
  const pio = await pioPath(); if (!pio) throw new Error('PlatformIO (pio) is not installed.');
  const stamp = crypto.createHash('sha1').update(root + '\0' + env);
  for (const f of ['platformio.ini', `sdkconfig.${env}`, 'sdkconfig.defaults']) try { stamp.update(f + fs.statSync(path.join(root, f)).size + fs.readFileSync(path.join(root, f))); } catch {}
  const dir = path.join(home(), 'lsp', 'cpp', crypto.createHash('sha1').update(root + '\0' + env).digest('hex').slice(0, 16)), key = stamp.digest('hex');
  const metaFile = path.join(dir, 'metadata.json');
  let meta = null; try { const m = JSON.parse(fs.readFileSync(metaFile, 'utf8')); if (m.key === key) meta = m.meta; } catch {}
  if (!meta) {
    say(`Reading the PlatformIO project (${env}). The first time can take a minute…`);
    const out = await run(pio, ['project', 'metadata', '--json-output', '-e', env], { cwd: root, timeout: 900000, env: { ...process.env, PYTHONUTF8: '1' } });
    meta = JSON.parse(out.slice(out.indexOf('{')))[env]; if (!meta) throw new Error(`PlatformIO gave nothing for ${env}.`);
    fs.mkdirSync(dir, { recursive: true });
    // Later sdkconfig is written by that very run: the key is taken again so the next start does not read it twice.
    const again = crypto.createHash('sha1').update(root + '\0' + env);
    for (const f of ['platformio.ini', `sdkconfig.${env}`, 'sdkconfig.defaults']) try { again.update(f + fs.statSync(path.join(root, f)).size + fs.readFileSync(path.join(root, f))); } catch {}
    fs.writeFileSync(metaFile, JSON.stringify({ key: again.digest('hex'), meta }));
  }
  const inc = meta.includes || {}, flag = (kind, list) => [...new Set(list || [])].flatMap(p => [kind, p]);
  const shared = [...targetOf(meta.cc_path), '-nostdlibinc', '-ferror-limit=0', '-Wno-unknown-warning-option', '-Wno-unknown-attributes', '-Wno-ignored-attributes', ...(await macros(meta.cc_path)),
    ...(meta.defines || []).map(d => '-D' + d), ...flag('-I', [...(inc.build || []), ...(inc.compatlib || [])])];
  const system = flag('-isystem', inc.toolchain);
  const entries = sources(root).map(file => {
    const cxx = !/\.c$/i.test(file), flags = expand(cxx ? meta.cxx_flags : meta.cc_flags, root).filter(keepFlag);
    return { directory: root, file, arguments: [cxx ? 'clang++' : 'clang', ...(cxx ? ['-x', 'c++', '-nostdinc++'] : ['-x', 'c']), ...shared, ...flags, ...system, ...(/\.ino$/i.test(file) ? ['-include', 'Arduino.h'] : []), '-c', file] };
  });
  fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify(entries));
  return dir;
}

async function cpp(say, { workspace, root }) {
  const choice = resolveChoice(workspace, root);
  if (choice === 'off') throw Object.assign(new Error('Suggestions are off for this project.'), { off: true });
  const bin = await clangdPath(say);
  const args = ['--background-index=false', '--header-insertion=iwyu', '--pch-storage=memory', '--log=error'];
  if (choice.startsWith('pio:')) args.push(`--compile-commands-dir=${await pioCommands(root, choice.slice(4), say)}`);
  else if (choice.startsWith('db:')) {
    args.push(`--compile-commands-dir=${path.join(root, choice.slice(3))}`);
    // Lets clangd ask the project's own cross compiler for its include folders.
    try { const db = JSON.parse(fs.readFileSync(path.join(root, choice.slice(3), 'compile_commands.json'), 'utf8')); const cc = [...new Set(db.slice(0, 200).map(e => e.arguments?.[0] || /^\s*("[^"]+"|\S+)/.exec(e.command || '')?.[1]?.replace(/"/g, '')).filter(c => c && path.isAbsolute(c)))]; if (cc.length) args.push(`--query-driver=${cc.map(c => c.replace(/\\/g, '/')).join(',')}`); } catch {}
  }
  return [bin, args, {}, choice];
}

const SERVERS = { go: gopls, rust, cpp, typescript, csharp };
module.exports = { SERVERS, rootFor, cOptions, setChoice, resolveChoice, pioCommands, pioEnvs, databases, keepFlag, expand, targetOf };
