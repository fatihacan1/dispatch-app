#!/usr/bin/env sh
set -eu
mkdir -p dist
for target in windows/amd64 windows/arm64 darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do
  os=${target%/*}; arch=${target#*/}; ext=""; [ "$os" != windows ] || ext=.exe
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -o "dist/dispatch-$os-$arch$ext" ./cmd/dispatch
done
