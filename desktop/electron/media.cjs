// Now playing (Windows): reads the system media session (Spotify app, YouTube or YouTube Music in a browser, any player
// that shows in the Windows media flyout) through a PowerShell WinRT loop. Runs only while the Music scene is open.
const { spawn } = require('node:child_process');

const PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, $t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(5000) | Out-Null; $task.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | ? { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IRandomAccessStream' }
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
`;

const WATCH = PRELUDE + String.raw`
$lastKey = ''
while ($true) {
  try {
    $s = $mgr.GetCurrentSession()
    if (-not $s) { $o = @{ none = $true } }
    else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
      $o = @{ app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; status = [string]$info.PlaybackStatus;
        position = $tl.Position.TotalSeconds; duration = ($tl.EndTime - $tl.StartTime).TotalSeconds; updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds();
        canNext = $info.Controls.IsNextEnabled; canPrev = $info.Controls.IsPreviousEnabled }
      $key = "$($o.app)|$($o.title)|$($o.artist)"
      if ($key -ne $lastKey -and $p.Thumbnail) {
        try {
          $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
          $ns = $asStream.Invoke($null, @($st)); $ms = New-Object System.IO.MemoryStream; $ns.CopyTo($ms); $b = $ms.ToArray(); $ns.Dispose()
          if ($b.Length -gt 0 -and $b.Length -lt 4000000) { $o.cover = 'data:' + $(if ($st.ContentType) { $st.ContentType } else { 'image/png' }) + ';base64,' + [Convert]::ToBase64String($b) }
        } catch {}
      }
      if ($key -ne $lastKey) { $o.track = $true; $lastKey = $key }
    }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  } catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 1000
}
`;

const COMMANDS = { toggle: 'TryTogglePlayPauseAsync', next: 'TrySkipNextAsync', prev: 'TrySkipPreviousAsync' };
const control = cmd => PRELUDE + `$s = $mgr.GetCurrentSession(); if ($s) { Await ($s.${COMMANDS[cmd]}()) ([bool]) | Out-Null }`;
const encoded = script => Buffer.from(script, 'utf16le').toString('base64');
const ps = script => spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(script)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

// One PowerShell loop for the whole app: every project tab with the Music scene open subscribes to it, and it stops
// when the last one leaves. The last track (with its cover) is replayed to a tab that joins later.
const subscribers = new Set();
let child = null, last = null, restart = null;
function publish(u) {
  if (u.track) last = { ...u };
  else if (last && !u.none && !u.error && `${u.app}|${u.title}|${u.artist}` === `${last.app}|${last.title}|${last.artist}`) last = { ...last, ...u, track: true };
  else if (u.none) last = null;
  for (const fn of subscribers) try { fn(u); } catch {}
}
function startLoop() {
  if (child || !subscribers.size) return;
  let buf = '';
  const me = child = ps(WATCH);
  me.stdout.setEncoding('utf8'); // titles like "Gül" or "Şarkı" must not turn into "?"
  me.stdout.on('data', d => {
    if (child !== me) return;
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { publish(JSON.parse(line)); } catch {} }
  });
  // A loop killed by the last tab leaving is already replaced (or not wanted); only a crash restarts.
  me.on('exit', () => { if (child !== me) return; child = null; last = null; if (subscribers.size) restart = setTimeout(() => { restart = null; startLoop(); }, 3000); });
  me.on('error', () => {});
}
/** watch(onUpdate) -> stop(). Each update is the current track (cover only when the track changes), { none } or { error }. */
function watch(onUpdate) {
  if (process.platform !== 'win32') { onUpdate({ unsupported: true }); return () => {}; }
  subscribers.add(onUpdate);
  if (last) try { onUpdate(last); } catch {}
  startLoop();
  return () => {
    if (!subscribers.delete(onUpdate) || subscribers.size) return;
    clearTimeout(restart); restart = null; last = null;
    const c = child; child = null; try { c?.kill(); } catch {}
  };
}
function send(cmd) {
  if (process.platform !== 'win32' || !COMMANDS[cmd]) return Promise.resolve(false);
  return new Promise(resolve => { const c = ps(control(cmd)); c.on('exit', code => resolve(code === 0)); c.on('error', () => resolve(false)); });
}
module.exports = { watch, send, COMMANDS };
