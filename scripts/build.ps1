$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force dist | Out-Null
foreach ($target in @('windows/amd64','windows/arm64','darwin/amd64','darwin/arm64','linux/amd64','linux/arm64')) {
  $parts = $target.Split('/'); $env:GOOS = $parts[0]; $env:GOARCH = $parts[1]; $env:CGO_ENABLED = '0'
  $ext = if ($env:GOOS -eq 'windows') { '.exe' } else { '' }
  go build -o "dist/dispatch-$($env:GOOS)-$($env:GOARCH)$ext" ./cmd/dispatch
  if ($LASTEXITCODE -ne 0) { throw "Build failed: $target" }
}
