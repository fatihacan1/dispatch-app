// Local speech to text: whisper.cpp's whisper-server with the large-v3-turbo model, kept warm while dictation is in
// use and stopped after a quiet spell. Installed into %LOCALAPPDATA%\Dispatch\whisper by a pinned, checksummed script.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const HOME = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Dispatch', 'whisper');
// GPU: large-v3-turbo (best Turkish). CPU only (AMD/Intel GPUs, no NVIDIA): small, fast enough to stream on a CPU.
const MODELS = {
  cuda: { file: 'ggml-large-v3-turbo-q5_0.bin', sha: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', label: 'large-v3-turbo', mb: 547 },
  cpu: { file: 'ggml-small-q5_1.bin', sha: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', label: 'small', mb: 181 },
};
// cuda and vulkan (AMD/Intel GPUs) both run the large model; only the CPU build gets the small one.
const modelFor = f => MODELS[f === 'cpu' ? 'cpu' : 'cuda'];
// Vulkan whisper-server built from the same tag (scripts/build-whisper-vulkan.ps1), shipped inside the installer.
const VULKAN_DIR = () => [process.resourcesPath && path.join(process.resourcesPath, 'whisper-vulkan'), path.join(__dirname, '..', 'resources', 'whisper-vulkan')].filter(Boolean).find(d => fs.existsSync(path.join(d, 'whisper-server.exe'))) || '';
const MODEL = () => path.join(HOME(), modelFor(flavor()).file);
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// Pinned release b5454 (whisper.cpp v1.9.5); hashes from the GitHub release and the Hugging Face LFS pointer.
const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/';
const BIN = {
  // The 12.4 build ships cuBLAS; the 11.8 one does not and silently falls back to the CPU. Needs driver 528+.
  cuda: { name: 'whisper-bin-win-cuda-12.4.0-x64.zip', sha: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a', mb: 653 },
  cpu: { name: 'whisper-blas-bin-x64.zip', sha: 'b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3', mb: 21 },
};
const IDLE_MS = 10 * 60 * 1000;

function findServer(dir = path.join(HOME(), 'bin'), depth = 0) {
  let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && /^whisper-server(\.exe)?$/i.test(e.name)) return path.join(dir, e.name);
  if (depth < 3) for (const e of entries) if (e.isDirectory()) { const f = findServer(path.join(dir, e.name), depth + 1); if (f) return f; }
  return null;
}
const flavor = () => { try { return fs.readFileSync(path.join(HOME(), 'flavor.txt'), 'utf8').trim(); } catch { return ''; } };

function status() {
  const exe = findServer(), model = fs.existsSync(MODEL());
  return { installed: !!exe && model, exe: exe || '', model: model ? MODEL() : '', flavor: flavor(), running: !!server && !server.exited, dir: HOME(), modelName: modelFor(flavor()).label };
}

const q = s => s.replace(/'/g, "''");
function installScript() {
  return [
    `$ErrorActionPreference='Stop'; $dir='${q(HOME())}'; New-Item -ItemType Directory -Force $dir | Out-Null`,
    `$cuda=$false; if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { $drv=(nvidia-smi --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1); $cuda=([double]($drv -split '\\.')[0]) -ge 528 }`,
    `if ($cuda) { $name='${BIN.cuda.name}'; $sha='${BIN.cuda.sha}'; $flavor='cuda'; $mf='${MODELS.cuda.file}'; $msha='${MODELS.cuda.sha}'; $mlabel='${MODELS.cuda.label} (${MODELS.cuda.mb} MB)'; Write-Host 'NVIDIA GPU found: CUDA build (${BIN.cuda.mb} MB).' } else { $name='${BIN.cpu.name}'; $sha='${BIN.cpu.sha}'; $flavor='cpu'; $mf='${MODELS.cpu.file}'; $msha='${MODELS.cpu.sha}'; $mlabel='${MODELS.cpu.label} (${MODELS.cpu.mb} MB)'; Write-Host 'No NVIDIA GPU.' }`,
    // AMD/Intel GPU without NVIDIA: the Vulkan build shipped inside Dispatch, and the large model.
    `$vk='${q(VULKAN_DIR())}'; $gpu=(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'Radeon|AMD|Arc' } | Select-Object -First 1).Name; $useVk=(-not $cuda) -and $gpu -and $vk -and (Test-Path (Join-Path $vk 'whisper-server.exe'))`,
    `if ($useVk) { Write-Host "$gpu found: Vulkan build (bundled)."; $flavor='vulkan'; $mf='${MODELS.cuda.file}'; $msha='${MODELS.cuda.sha}'; $mlabel='${MODELS.cuda.label} (${MODELS.cuda.mb} MB)'; $bin=Join-Path $dir 'bin'; if (Test-Path $bin) { Remove-Item $bin -Recurse -Force }; New-Item -ItemType Directory -Force $bin | Out-Null; Copy-Item (Join-Path $vk '*') $bin -Recurse -Force; Set-Content (Join-Path $dir 'flavor.txt') 'vulkan' } else {`,
    `$zip=Join-Path $dir 'bin.download.zip'; curl.exe -L --fail -o $zip ('${RELEASE}' + $name); if ($LASTEXITCODE -ne 0) { throw 'Download failed.' }`,
    `if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $sha) { Remove-Item $zip; throw 'Checksum mismatch, download removed.' }`,
    `$bin=Join-Path $dir 'bin'; if (Test-Path $bin) { Remove-Item $bin -Recurse -Force }; New-Item -ItemType Directory -Force $bin | Out-Null`,
    // Windows' own bsdtar: a GNU tar from Git on PATH reads "C:" as a remote host.
    `& (Join-Path $env:SystemRoot 'System32\\tar.exe') -xf $zip -C $bin; if ($LASTEXITCODE -ne 0) { throw 'Unpacking failed.' }; Remove-Item $zip`,
    `if (-not (Get-ChildItem $bin -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1)) { throw 'whisper-server.exe is missing from the download.' }; Set-Content (Join-Path $dir 'flavor.txt') $flavor`,
    `Write-Host 'Engine installed, checksum verified.' }`,
    `$model=Join-Path $dir $mf; $ok=(Test-Path $model) -and ((Get-FileHash $model -Algorithm SHA256).Hash.ToLower() -eq $msha)`,
    `if (-not $ok) { Write-Host "Downloading the $mlabel model..."; $tmp=$model + '.download'; curl.exe -L --fail -o $tmp ('${MODEL_BASE}' + $mf); if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }; if ((Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower() -ne $msha) { Remove-Item $tmp; throw 'Model checksum mismatch, download removed.' }; Move-Item $tmp $model -Force }`,
    `Write-Host 'Voice typing is ready.'`,
  ].join('; ');
}

function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

let server = null, idle = null, starting = null;
async function ensure(lang) {
  if (server && server.ready && !server.exited && server.lang === lang) { touch(); return server; }
  // A start in progress: wait for it rather than talking to a server that is still loading the model.
  if (starting) { try { await starting; } catch {} if (server && server.ready && !server.exited && server.lang === lang) return server; }
  stop();
  starting = (async () => {
    const exe = findServer(); if (!exe || !fs.existsSync(MODEL())) throw new Error('Voice typing is not installed. Install it under Tools.');
    const port = await freePort();
    const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
    const args = ['-m', MODEL(), '--host', '127.0.0.1', '--port', String(port), '-t', threads, '-l', lang || 'auto', '-nt', '-sns'];
    const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { child, port, lang, exited: false, ready: false, log: '' };
    const keep = d => { entry.log = (entry.log + d).slice(-8000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    child.on('exit', () => { entry.exited = true; if (server === entry) server = null; });
    server = entry;
    // Ready when it answers HTTP (loading the model onto the GPU takes a few seconds).
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (entry.exited) throw new Error('Speech engine stopped while loading: ' + entry.log.split('\n').filter(Boolean).slice(-3).join(' '));
      try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); if (r.status < 500) { entry.ready = true; touch(); return entry; } } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('Speech engine did not start in time.');
  })();
  try { return await starting; } finally { starting = null; }
}
function touch() { clearTimeout(idle); idle = setTimeout(stop, IDLE_MS); }
function stop() { clearTimeout(idle); if (server) { try { server.child.kill(); } catch {} server = null; } }

// Whisper's well-known inventions on silence or noise (subtitle credits from its training data).
const HALLUCINATION = /^(altyaz[Ä±i].*|.*izledi[ÄŸg]iniz i[Ã§c]in te[ÅŸs]ekk[Ã¼u]r.*|thank(s| you) for watching.*|abone ol.*|\[.*\]|\(.*\)|\.+|-)$/i;
function clean(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return HALLUCINATION.test(t) ? '' : t;
}

async function transcribe(wav, lang) {
  const s = await ensure(lang);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0.0');
  const r = await fetch(`http://127.0.0.1:${s.port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Speech engine error ${r.status}`);
  const body = await r.json();
  touch();
  return clean(body.text);
}

module.exports = { status, installScript, transcribe, ensure, stop, clean, HOME };
